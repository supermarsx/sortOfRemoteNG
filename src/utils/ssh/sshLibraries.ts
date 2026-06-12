import { debugLog } from '../core/debugLogger';
// SSH Library Abstraction Layer
export interface SSHLibraryConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  timeout?: number;
  /* ── SSH3-only (HTTP/3 over QUIC) ─────────────────────────────────
   * Additive optional fields consumed only by `SSH3Client`. Ignored by
   * the SSH2 / websocket / webssh clients. */
  /** OIDC / OAuth2 / raw-JWT bearer token for SSH3 bearer auth. */
  bearerToken?: string;
  /** Force a specific SSH3 auth method (`password`|`publickey`|`bearer`|`certificate`). */
  ssh3AuthMethod?: string;
  /** Verify the server's TLS 1.3 certificate (default true). */
  verifyServerCert?: boolean;
  /** Path to a custom CA certificate (PEM) for SSH3 server verification. */
  caCertPath?: string;
}

export interface SSHLibraryCallbacks {
  onData: (data: string) => void;
  onConnect: () => void;
  onError: (error: string) => void;
  onClose: () => void;
}

export type SSHLibraryType = 'ssh2' | 'ssh3' | 'simple-ssh' | 'webssh' | 'websocket';

export abstract class BaseSSHClient {
  protected config: SSHLibraryConfig;
  protected callbacks: Partial<SSHLibraryCallbacks> = {};
  protected isConnected = false;

  constructor(config: SSHLibraryConfig) {
    this.config = config;
  }

  onData(callback: (data: string) => void) {
    this.callbacks.onData = callback;
  }

  onConnect(callback: () => void) {
    this.callbacks.onConnect = callback;
  }

  onError(callback: (error: string) => void) {
    this.callbacks.onError = callback;
  }

  onClose(callback: () => void) {
    this.callbacks.onClose = callback;
  }

  abstract connect(): Promise<void>;
  abstract sendData(data: string): void;
  abstract resize(cols: number, rows: number): void;
  abstract disconnect(): void;
}

// The former Node-only SSH client (see t3-e41) was retired; interactive SSH
// shells now route through the Rust `sorng-ssh` backend via `invoke('ssh_*')`
// (`useSSHClient` hook + aggregator). Consumers should migrate to the Tauri
// path or fall through to the 'websocket' / 'webssh' browser clients below.

// SSH2 Library Implementation
export class SSH2Client extends BaseSSHClient {
  private connection: any = null;
  private stream: any = null;

  async connect(): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        this.callbacks.onError?.('SSH2Client is not supported in the browser');
        return;
      }
      // Resolve ssh2 at runtime only so browser builds do not try to bundle or
      // type-resolve this Node-only dependency.
      const { Client } = (await Function(
        'return import("ssh2")',
      )()) as { Client: new () => any };
      this.connection = new Client();

      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: this.config.timeout || 20000,
      };

      if (this.config.privateKey) {
        connectionConfig.privateKey = this.config.privateKey;
        if (this.config.passphrase) {
          connectionConfig.passphrase = this.config.passphrase;
        }
      } else if (this.config.password) {
        connectionConfig.password = this.config.password;
      }

      this.connection.on('ready', () => {
        this.connection.shell((err: Error, stream: any) => {
          if (err) {
            this.callbacks.onError?.(err.message);
            return;
          }

          this.stream = stream;
          
          stream.on('data', (data: Buffer) => {
            this.callbacks.onData?.(data.toString());
          });

          stream.on('close', () => {
            this.isConnected = false;
            this.callbacks.onClose?.();
          });

          stream.on('error', (error: Error) => {
            this.callbacks.onError?.(error.message);
          });

          this.isConnected = true;
          this.callbacks.onConnect?.();
        });
      });

      this.connection.on('error', (error: Error) => {
        this.callbacks.onError?.(error.message);
      });

      this.connection.connect(connectionConfig);
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'SSH2 connection failed');
    }
  }

  sendData(data: string): void {
    if (this.stream && this.isConnected) {
      this.stream.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.stream && this.isConnected) {
      this.stream.setWindow(rows, cols);
    }
  }

  disconnect(): void {
    if (this.stream) {
      this.stream.end();
    }
    if (this.connection) {
      this.connection.end();
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}

// NOTE: the legacy SimpleSSHClient (browser npm SSH adapter) was retired in
// t3-e20. The `sorng-ssh` Rust backend (invoke commands `connect_ssh`,
// `start_shell`, `send_ssh_input`, `resize_ssh_shell`, `disconnect_ssh`, …)
// is the sole SSH path. `NodeSSHClient` remains for Node-only tooling.

/* ── SSH3 event payloads (must match the Rust `Ssh3Shell*` serde shapes in
 *    `sorng-ssh/src/ssh3/mod.rs`; emitted by the session pump in session.rs) ── */
interface Ssh3OutputEvent { session_id: string; channel_id: string; data: string }
interface Ssh3ErrorEvent { session_id: string; channel_id: string; message: string }
interface Ssh3ClosedEvent { session_id: string; channel_id: string }

/**
 * SSH3 client — SSH semantics over HTTP/3 (QUIC).
 *
 * Unlike the historical placeholder (which silently delegated to SSH2), this
 * drives the REAL `ssh3_*` Tauri commands implemented by the native `sorng-ssh`
 * QUIC/H3 backend:
 *   connect → `connect_ssh3` (real QUIC+H3 dial + HTTP `Authorization` auth)
 *   shell   → `start_ssh3_shell` (interactive PTY over a QUIC bidi stream)
 *   input   → `send_ssh3_input`
 *   resize  → `resize_ssh3_shell`
 *   close   → `disconnect_ssh3`
 * and renders server output via the emitted `ssh3-output` / `ssh3-error` /
 * `ssh3-shell-closed` events (mirroring the classic SSH `ssh-output` path).
 *
 * HONESTY NOTE: real-server interop is currently blocked on emitting the
 * extended-CONNECT `:protocol = ssh3` pseudo-header, which the pinned `h3`
 * 0.0.8 crate cannot do (its `ext::Protocol` is a closed enum — see
 * `.orchestration/logs/t23-e6.md`). This client therefore attempts a genuine
 * connection but, against a real upstream `ssh3` server, will fail at the
 * CONNECT/auth step until the h3 patch lands. It does NOT fake success: any
 * backend error is surfaced through `onError`.
 *
 * Requires the Tauri runtime (the `ssh3_*` commands live in the Rust backend);
 * in a plain browser context there is no QUIC stack, so connect reports an
 * actionable error rather than silently degrading to SSH2.
 */
export class SSH3Client extends BaseSSHClient {
  private sessionId: string | null = null;
  private channelId: string | null = null;
  private unlisteners: Array<() => void> = [];

  async connect(): Promise<void> {
    try {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
        throw new Error(
          'SSH3 requires the desktop (Tauri) runtime — its QUIC/HTTP-3 transport is not available in a plain browser.',
        );
      }

      debugLog('SSH3: connecting over HTTP/3 (QUIC) via the native backend');
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // Real QUIC/H3 dial + HTTP Authorization auth. The serde shape mirrors
      // `Ssh3ConnectionConfig` (camelCase fields are mapped by Tauri).
      const ssh3Config: Record<string, unknown> = {
        host: this.config.host,
        port: this.config.port || 443,
        username: this.config.username,
        password: this.config.password ?? null,
        private_key_path: this.config.privateKey ?? null,
        private_key_passphrase: this.config.passphrase ?? null,
        bearer_token: this.config.bearerToken ?? null,
        auth_method: this.config.ssh3AuthMethod ?? null,
        verify_server_cert: this.config.verifyServerCert ?? true,
        ca_cert_path: this.config.caCertPath ?? null,
        connect_timeout: this.config.timeout ?? 30,
      };

      const sessionId = await invoke<string>('connect_ssh3', { config: ssh3Config });
      this.sessionId = sessionId;

      // Subscribe to the shell event stream BEFORE starting the shell so no
      // early output is missed. Events carry both session_id and channel_id.
      this.unlisteners.push(
        await listen<Ssh3OutputEvent>('ssh3-output', (event) => {
          if (event.payload.session_id !== this.sessionId) return;
          this.callbacks.onData?.(event.payload.data);
        }),
      );
      this.unlisteners.push(
        await listen<Ssh3ErrorEvent>('ssh3-error', (event) => {
          if (event.payload.session_id !== this.sessionId) return;
          this.callbacks.onError?.(event.payload.message);
        }),
      );
      this.unlisteners.push(
        await listen<Ssh3ClosedEvent>('ssh3-shell-closed', (event) => {
          if (event.payload.session_id !== this.sessionId) return;
          this.isConnected = false;
          this.callbacks.onClose?.();
        }),
      );

      // Open the interactive PTY shell over the authenticated session.
      const channelId = await invoke<string>('start_ssh3_shell', { sessionId });
      this.channelId = channelId;
      this.isConnected = true;
      this.callbacks.onConnect?.();
      debugLog('SSH3: interactive shell established', { sessionId, channelId });
    } catch (error) {
      debugLog('SSH3: connection failed', error);
      await this.teardownListeners();
      // Best-effort backend cleanup if the session was created before failure.
      await this.disconnectBackend();
      this.callbacks.onError?.(
        error instanceof Error ? error.message : 'SSH3 connection failed',
      );
    }
  }

  sendData(data: string): void {
    if (!this.isConnected || !this.sessionId || !this.channelId) return;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('send_ssh3_input', {
          sessionId: this.sessionId,
          channelId: this.channelId,
          data,
        });
      } catch (err) {
        this.callbacks.onError?.(
          err instanceof Error ? err.message : 'SSH3: failed to send input',
        );
      }
    })();
  }

  resize(cols: number, rows: number): void {
    if (!this.isConnected || !this.sessionId || !this.channelId) return;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('resize_ssh3_shell', {
          sessionId: this.sessionId,
          channelId: this.channelId,
          cols,
          rows,
        });
      } catch {
        /* resize is best-effort; ignore transient errors */
      }
    })();
  }

  disconnect(): void {
    this.isConnected = false;
    void this.teardownListeners();
    void this.disconnectBackend();
    this.callbacks.onClose?.();
  }

  private async teardownListeners(): Promise<void> {
    for (const un of this.unlisteners) {
      try { un(); } catch { /* ignore */ }
    }
    this.unlisteners = [];
  }

  private async disconnectBackend(): Promise<void> {
    if (!this.sessionId) return;
    const sid = this.sessionId;
    this.sessionId = null;
    this.channelId = null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('disconnect_ssh3', { sessionId: sid });
    } catch {
      /* best-effort teardown */
    }
  }
}

// WebSocket SSH Implementation (fallback)
export class WebSocketSSHClient extends BaseSSHClient {
  private websocket: WebSocket | null = null;

  async connect(): Promise<void> {
    try {
      // Connect to WebSocket SSH proxy
      const wsUrl = `ws://${this.config.host}:${this.config.port || 22}`;
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        // Send authentication
        const authData = {
          type: 'auth',
          username: this.config.username,
          password: this.config.password,
          privateKey: this.config.privateKey,
          passphrase: this.config.passphrase,
        };
        this.websocket?.send(JSON.stringify(authData));
      };

      this.websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'auth_success') {
          this.isConnected = true;
          this.callbacks.onConnect?.();
        } else if (data.type === 'auth_error') {
          this.callbacks.onError?.(data.message);
        } else if (data.type === 'data') {
          this.callbacks.onData?.(data.content);
        }
      };

      this.websocket.onerror = () => {
        this.callbacks.onError?.('WebSocket connection failed');
      };

      this.websocket.onclose = () => {
        this.isConnected = false;
        this.callbacks.onClose?.();
      };
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'WebSocket SSH connection failed');
    }
  }

  sendData(data: string): void {
    if (this.websocket && this.isConnected) {
      this.websocket.send(JSON.stringify({
        type: 'input',
        data: data,
      }));
    }
  }

  resize(cols: number, rows: number): void {
    if (this.websocket && this.isConnected) {
      this.websocket.send(JSON.stringify({
        type: 'resize',
        cols: cols,
        rows: rows,
      }));
    }
  }

  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
    }
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}

// WebSSH2 Frontend Implementation
export class WebSSHClientFrontend extends BaseSSHClient {
  private terminal: any = null;

  async connect(): Promise<void> {
    try {
      if (typeof window === 'undefined') {
        this.callbacks.onError?.('WebSSHClientFrontend is only supported in the browser');
        return;
      }

      const { WebSSHTerminal } = await import('webssh2-frontend');
      const container = document.createElement('div');
      document.body.appendChild(container);

      this.terminal = new WebSSHTerminal(container, {
        socketUrl: `http://${this.config.host}:${this.config.port || 22}`,
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        privateKey: this.config.privateKey,
        onConnected: () => {
          this.isConnected = true;
          this.callbacks.onConnect?.();
        },
        onDisconnected: () => {
          this.isConnected = false;
          this.callbacks.onClose?.();
        },
        onError: (err: string) => {
          this.callbacks.onError?.(err);
        },
        onData: (data: string) => {
          this.callbacks.onData?.(data);
        }
      });

      this.terminal.connect();
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'WebSSH connection failed');
    }
  }

  sendData(data: string): void {
    this.terminal?.sendData(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal?.resize(cols, rows);
  }

  disconnect(): void {
    this.terminal?.disconnect();
    this.isConnected = false;
    this.callbacks.onClose?.();
  }
}

// SSH Library Factory
export class SSHLibraryFactory {
  static createClient(type: SSHLibraryType, config: SSHLibraryConfig): BaseSSHClient {
    // SSH3 drives the native Tauri `ssh3_*` backend and self-guards on the
    // desktop runtime (reporting an actionable error in a plain browser), so it
    // must NOT be coerced to the browser `webssh` fallback like the Node-only
    // clients below.
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser && type !== 'webssh' && type !== 'ssh3') {
      console.warn(`SSH library "${type}" is not supported in the browser, falling back to webssh`);
      type = 'webssh';
    }
    switch (type) {
      case 'ssh2':
        return new SSH2Client(config);
      case 'ssh3':
        return new SSH3Client(config);
      case 'webssh':
        return new WebSSHClientFrontend(config);
      case 'websocket':
      default:
        return new WebSocketSSHClient(config);
    }
  }
}
