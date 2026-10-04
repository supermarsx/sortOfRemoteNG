import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";

const mock = vi.hoisted(() => ({
  disk: null as unknown,
  secrets: new Map<string, string>(),
  save: vi.fn(),
  store: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  invoke: vi.fn(),
  path: vi.fn(),
}));
vi.mock("../../src/utils/storage/appDataJsonStore", () => ({
  AppDataJsonStore: class {
    constructor(
      private options: {
        sanitize: (v: unknown) => { value: unknown; changed: boolean };
      },
    ) {}
    async load() {
      if (!mock.disk) return { value: null, sanitized: false };
      const result = this.options.sanitize(mock.disk);
      return { value: result.value, sanitized: result.changed };
    }
    async save(value: unknown) {
      await mock.save(value);
      mock.disk = JSON.parse(
        JSON.stringify(this.options.sanitize(value).value),
      );
    }
  },
}));
vi.mock("../../src/utils/storage/storage", () => ({
  SecureStorage: {
    vaultStoreSecret: (...args: unknown[]) => mock.store(...args),
    vaultReadSecret: (...args: unknown[]) => mock.read(...args),
    vaultDeleteSecret: (...args: unknown[]) => mock.remove(...args),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mock.invoke(...args),
}));
vi.mock("../../src/utils/ssh/sshTunnelTrust", () => ({
  listenForTunnelTrust: vi.fn(async () => vi.fn()),
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ getSettings: () => ({}) }) },
}));
vi.mock("../../src/utils/network/resolveRuntimeNetworkPath", () => ({
  resolveRuntimeNetworkPath: (...args: unknown[]) => mock.path(...args),
}));

const params = {
  name: "Standalone",
  host: "ssh.example",
  port: 2222,
  username: "alice",
  password: "never-plain-secret",
  localPort: 12001,
  type: "dynamic" as const,
};
const base = {
  id: "base",
  name: "Base",
  protocol: "ssh",
  hostname: "saved.example",
  port: 22,
  username: "saved",
  password: "saved-secret",
} as Connection;
const service = async () =>
  (await import("../../src/utils/ssh/sshTunnelService")).sshTunnelService;
const config = () =>
  mock.invoke.mock.calls.find((c) => c[0] === "connect_ssh")?.[1].config;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mock.disk = null;
  mock.secrets.clear();
  mock.save.mockResolvedValue(undefined);
  mock.store.mockImplementation(async (_service, account, secret) => {
    mock.secrets.set(account, secret);
  });
  mock.read.mockImplementation(async (_service, account) => {
    if (!mock.secrets.has(account))
      throw new Error("[NotFound] credential not found");
    return mock.secrets.get(account);
  });
  mock.remove.mockImplementation(async (_service, account) => {
    if (!mock.secrets.has(account))
      throw new Error("CredDeleteW failed: not found");
    mock.secrets.delete(account);
  });
  mock.invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "connect_ssh") return "session";
    if (cmd === "setup_port_forward") return "forward";
    if (cmd === "get_ssh_port_forward") {
      const requested = [...mock.invoke.mock.calls]
        .reverse()
        .find(
          ([command, input]) =>
            command === "setup_port_forward" &&
            input.sessionId === args.sessionId,
        )![1].config;
      return {
        id: args.forwardId,
        config: { ...requested, local_port: requested.local_port || 42001 },
      };
    }
    if (cmd === "release_vpn_leases") return { errors: [] };
  });
  mock.path.mockResolvedValue({
    transport: {
      jump_hosts: [],
      proxy_config: null,
      proxy_chain: null,
      mixed_chain: null,
      openvpn_config: null,
      vpnPreSteps: [],
    },
    redactionSecrets: [],
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("SSH tunnel bound port ownership", () => {
  it.each(["local", "dynamic"] as const)(
    "lets native reserve distinct ports for concurrent automatic %s tunnels to the same destination",
    async (type) => {
      const s = await service();
      const a = await s.createTunnel({
        ...params,
        localPort: 0,
        type,
        remoteHost: "same.internal",
        remotePort: 3389,
      });
      const b = await s.createTunnel({
        ...params,
        name: "Second",
        localPort: 0,
        type,
        remoteHost: "same.internal",
        remotePort: 3389,
      });
      const pending = new Map<string, ReturnType<typeof deferred<void>>>();
      const ports = new Map<string, number>();
      mock.invoke.mockImplementation(async (cmd, args) => {
        if (cmd === "connect_ssh")
          return `session-${ports.size + pending.size + 1}`;
        if (cmd === "setup_port_forward") {
          expect(args.config.local_port).toBe(0);
          const gate = deferred<void>();
          pending.set(args.sessionId, gate);
          await gate.promise;
          return `forward-${args.sessionId}`;
        }
        if (cmd === "get_ssh_port_forward") {
          expect(args.forwardId).toBe(`forward-${args.sessionId}`);
          const requested = mock.invoke.mock.calls.find(
            ([command, input]) =>
              command === "setup_port_forward" &&
              input.sessionId === args.sessionId,
          )![1].config;
          return {
            id: args.forwardId,
            config: { ...requested, local_port: ports.get(args.sessionId) },
          };
        }
      });
      // Separate calls must overlap while native owns both listener allocations.
      const first = s.connectTunnel(a.id);
      await vi.waitFor(() => expect(pending.size).toBe(1));
      const second = s.connectTunnel(b.id);
      await vi.waitFor(() => expect(pending.size).toBe(2));
      let port = 42000;
      for (const [sessionId, gate] of pending) {
        ports.set(sessionId, ++port);
        gate.resolve();
      }
      const connected = await Promise.all([first, second]);
      expect(connected.map((t) => t.actualLocalPort)).toEqual([42001, 42002]);
      expect(connected.map((t) => t.localPort)).toEqual([0, 0]);
      expect(JSON.stringify(mock.disk)).not.toMatch(
        /actualLocalPort|42001|42002/,
      );
      await s.disconnectAllTunnels();
    },
  );

  it("preserves an explicit local port and never silently retries its collision", async () => {
    const s = await service();
    const a = await s.createTunnel(params);
    const b = await s.createTunnel({ ...params, name: "Second" });
    const original = mock.invoke.getMockImplementation()!;
    let forwards = 0;
    let sessions = 0;
    mock.invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "connect_ssh") return `session-${++sessions}`;
      if (cmd === "setup_port_forward") {
        expect(args.config.local_port).toBe(params.localPort);
        if (++forwards === 2)
          throw new Error("Address already in use (os error 10048)");
      }
      return original(cmd, args);
    });
    expect((await s.connectTunnel(a.id)).actualLocalPort).toBe(
      params.localPort,
    );
    await expect(s.connectTunnel(b.id)).rejects.toThrow("10048");
    expect(forwards).toBe(2);
    expect(s.getTunnel(a.id)?.status).toBe("connected");
    expect(s.getTunnel(b.id)?.sshSessionId).toBeUndefined();
    expect(mock.invoke).toHaveBeenCalledWith("disconnect_ssh", {
      sessionId: "session-2",
    });
    expect(mock.invoke).not.toHaveBeenCalledWith("disconnect_ssh", {
      sessionId: "session-1",
    });
    expect(
      mock.invoke.mock.calls.filter(([cmd]) => cmd === "get_ssh_port_forward"),
    ).toHaveLength(1);
    await s.disconnectTunnel(a.id);
  });

  it("keeps a remote forward's local destination port, rather than allocating a listener", async () => {
    const s = await service();
    const t = await s.createTunnel({
      ...params,
      type: "remote",
      remoteHost: "127.0.0.1",
      remotePort: 44000,
    });
    expect((await s.connectTunnel(t.id)).actualLocalPort).toBe(
      params.localPort,
    );
    expect(mock.invoke).toHaveBeenCalledWith("setup_port_forward", {
      sessionId: "session",
      config: expect.objectContaining({
        direction: "Remote",
        local_port: params.localPort,
        remote_port: 44000,
      }),
    });
    expect(mock.invoke).toHaveBeenCalledWith("get_ssh_port_forward", {
      sessionId: "session",
      forwardId: "forward",
    });
    await s.disconnectTunnel(t.id);
  });

  it("rejects an automatic remote local destination before opening SSH", async () => {
    const s = await service();
    await expect(
      s.createTunnel({
        ...params,
        type: "remote",
        localPort: 0,
        remoteHost: "127.0.0.1",
        remotePort: 44000,
      }),
    ).rejects.toThrow("local destination port");
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    { id: "unrelated", config: {} },
    { id: "forward" },
    ...[0, 65536, 1.5, "42001"].map((local_port) => ({
      id: "forward",
      config: {
        local_port,
        direction: "Dynamic",
        local_host: "127.0.0.1",
        remote_host: "127.0.0.1",
        remote_port: 0,
        allow_non_loopback_bind: false,
      },
    })),
  ])(
    "fails closed and disconnects for invalid bound-port metadata %#",
    async (metadata) => {
      const s = await service();
      const t = await s.createTunnel({ ...params, localPort: 0 });
      const original = mock.invoke.getMockImplementation()!;
      mock.invoke.mockImplementation(async (cmd, args) =>
        cmd === "get_ssh_port_forward" ? metadata : original(cmd, args),
      );
      await expect(s.connectTunnel(t.id)).rejects.toThrow("bound port");
      expect(mock.invoke).toHaveBeenCalledWith("disconnect_ssh", {
        sessionId: "session",
      });
      expect(s.getTunnel(t.id)).toMatchObject({
        status: "error",
        needsCleanup: false,
      });
      expect(s.getTunnel(t.id)?.actualLocalPort).toBeUndefined();
      expect(s.getTunnel(t.id)?.portForwardId).toBeUndefined();
    },
  );

  it("retains the returned forward ID and waits for cleanup when metadata lookup rejects", async () => {
    const s = await service();
    const t = await s.createTunnel({ ...params, localPort: 0 });
    const cleanup = deferred<void>();
    const original = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "get_ssh_port_forward") {
        expect(s.getTunnel(t.id)?.portForwardId).toBe("forward");
        throw new Error(`Metadata failed: ${params.password}`);
      }
      if (cmd === "disconnect_ssh") return cleanup.promise;
      return original(cmd, args);
    });
    let finished = false;
    const connected = s.connectTunnel(t.id);
    const rejected = expect(connected).rejects.toThrow(
      "Metadata failed: [redacted]",
    );
    void connected.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    await vi.waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("disconnect_ssh", {
        sessionId: "session",
      }),
    );
    expect(finished).toBe(false);
    expect(s.getTunnel(t.id)?.portForwardId).toBe("forward");
    cleanup.resolve();
    await rejected;
    expect(s.getTunnel(t.id)?.sshSessionId).toBeUndefined();
  });

  it.each(["setup_port_forward", "get_ssh_port_forward"])(
    "cancels during %s and awaits cleanup without publishing a connected tunnel",
    async (phase) => {
      const s = await service();
      const t = await s.createTunnel({ ...params, localPort: 0 });
      const gate = deferred<void>();
      const entered = deferred<void>();
      const cleanup = deferred<void>();
      const original = mock.invoke.getMockImplementation()!;
      mock.invoke.mockImplementation(async (cmd, args) => {
        if (cmd === phase) {
          entered.resolve();
          await gate.promise;
        }
        if (cmd === "disconnect_ssh") return cleanup.promise;
        return original(cmd, args);
      });
      let connectedFinished = false;
      const connected = s.connectTunnel(t.id);
      const rejected = expect(connected).rejects.toThrow("cancelled");
      void connected.then(
        () => {
          connectedFinished = true;
        },
        () => {
          connectedFinished = true;
        },
      );
      await entered.promise;
      const disconnected = s.disconnectTunnel(t.id);
      gate.resolve();
      await vi.waitFor(() =>
        expect(mock.invoke).toHaveBeenCalledWith("disconnect_ssh", {
          sessionId: "session",
        }),
      );
      expect(connectedFinished).toBe(false);
      expect(s.getTunnel(t.id)?.portForwardId).toBe("forward");
      expect(s.getTunnel(t.id)?.status).not.toBe("connected");
      cleanup.resolve();
      await rejected;
      await disconnected;
      expect(s.getTunnel(t.id)?.status).toBe("disconnected");
      expect(s.getTunnel(t.id)?.actualLocalPort).toBeUndefined();
      expect(s.getTunnel(t.id)?.portForwardId).toBeUndefined();
    },
  );

  it.each(["owner", "vault"])(
    "rechecks %s after the metadata read and retains cleanup handles on failure",
    async (guard) => {
      const s = await service();
      const t = await s.createTunnel({
        name: "Saved",
        sshConnectionId: "base",
        type: "dynamic",
      });
      let revoked = false;
      const assertAccess = () => {
        if (revoked) throw new Error("Access revoked");
      };
      const vault = {
        facets: { username: "fixture", password: "synthetic" },
        assertCurrent: guard === "vault" ? assertAccess : vi.fn(),
      };
      const original = mock.invoke.getMockImplementation()!;
      mock.invoke.mockImplementation(async (cmd, args) => {
        if (cmd === "get_ssh_port_forward") revoked = true;
        if (cmd === "disconnect_ssh") throw new Error("cleanup unavailable");
        return original(cmd, args);
      });
      await expect(
        s.connectTunnel(t.id, base, {
          assertCurrent: guard === "owner" ? assertAccess : undefined,
          vault,
        }),
      ).rejects.toThrow("Access revoked");
      expect(s.getTunnel(t.id)).toMatchObject({
        needsCleanup: true,
        sshSessionId: "session",
        portForwardId: "forward",
        status: "error",
      });
      expect(vault.facets).toEqual({});
      mock.invoke.mockImplementation(original);
      await s.disconnectTunnel(t.id);
      expect(s.getTunnel(t.id)?.needsCleanup).toBe(false);
    },
  );

  it.each([
    { id: "different-forward" },
    { config: { direction: "Remote" } },
    { config: { local_port: 42002 } },
    { config: { local_host: "0.0.0.0" } },
    { config: { remote_host: "different.internal" } },
    { config: { remote_port: 3388 } },
    { config: { allow_non_loopback_bind: true } },
  ])(
    "rejects metadata that disagrees with the explicit requested forward %#",
    async (changed) => {
      const s = await service();
      const t = await s.createTunnel({
        ...params,
        type: "local",
        remoteHost: "target.internal",
        remotePort: 3389,
      });
      const original = mock.invoke.getMockImplementation()!;
      mock.invoke.mockImplementation(async (cmd, args) => {
        const result = await original(cmd, args);
        if (cmd !== "get_ssh_port_forward") return result;
        return {
          ...result,
          ...changed,
          config: { ...result.config, ...changed.config },
        };
      });
      await expect(s.connectTunnel(t.id)).rejects.toThrow("bound port");
      expect(mock.invoke).toHaveBeenCalledWith("disconnect_ssh", {
        sessionId: "session",
      });
      expect(s.getTunnel(t.id)?.actualLocalPort).toBeUndefined();
    },
  );
});

describe("SSH tunnel secure standalone persistence and runtime", () => {
  it("preserves the active password when deletion intent cannot be saved", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    mock.save.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(s.deleteTunnel(t.id)).rejects.toThrow("disk unavailable");
    expect(mock.remove).not.toHaveBeenCalled();
    expect(mock.secrets.has(t.credentialRef!)).toBe(true);
  });

  it("blocks connecting while deletion intent is being saved and releases the guard on failure", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    let reject!: (error: Error) => void;
    mock.save.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const deletion = s.deleteTunnel(t.id);
    const failed = expect(deletion).rejects.toThrow("disk unavailable");
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    await expect(s.connectTunnel(t.id)).rejects.toThrow("deletion is pending");
    expect(mock.invoke).not.toHaveBeenCalled();
    reject(new Error("disk unavailable"));
    await failed;
    await s.connectTunnel(t.id);
    expect(config().password).toBe(params.password);
  });

  it("reloads a deletion marker after final removal persistence fails and retries cleanup", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    mock.save
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("final save failed"));
    await expect(s.deleteTunnel(t.id)).rejects.toThrow("final save failed");
    vi.resetModules();
    const reloaded = await service();
    await expect(reloaded.connectTunnel(t.id)).rejects.toThrow(
      "deletion is pending",
    );
    expect(mock.invoke).not.toHaveBeenCalled();
    await reloaded.deleteTunnel(t.id);
    expect(mock.disk).toEqual([]);
    expect(mock.secrets.size).toBe(0);
  });

  it("retains a failed create rollback reference across reload for deletion", async () => {
    const s = await service();
    mock.save.mockRejectedValueOnce(new Error("disk unavailable"));
    mock.remove.mockRejectedValueOnce(new Error("vault locked"));
    await expect(s.createTunnel(params)).rejects.toThrow("cleanup is pending");
    expect(JSON.stringify(mock.disk)).not.toContain(params.password);
    vi.resetModules();
    const reloaded = await service();
    await reloaded.ready();
    const recovery = reloaded.getTunnels()[0];
    expect(recovery.pendingCredentialRefs).toEqual([...mock.secrets.keys()]);
    await expect(reloaded.connectTunnel(recovery.id)).rejects.toThrow(
      "deletion is pending",
    );
    await reloaded.deleteTunnel(recovery.id);
    expect(mock.secrets.size).toBe(0);
  });

  it("retains the original password and journals a failed update rollback", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    mock.save.mockRejectedValueOnce(new Error("disk unavailable"));
    mock.remove.mockRejectedValueOnce(new Error("vault locked"));
    await expect(
      s.updateTunnel(t.id, { password: "replacement" }),
    ).rejects.toThrow("cleanup is pending");
    vi.resetModules();
    const reloaded = await service();
    await reloaded.ready();
    expect(reloaded.getTunnel(t.id)?.credentialRef).toBe(t.credentialRef);
    await reloaded.updateTunnel(t.id, { name: "Retry" });
    expect([...mock.secrets.keys()]).toEqual([t.credentialRef]);
    await reloaded.connectTunnel(t.id);
    expect(config().password).toBe(params.password);
  });

  it("retains an in-memory recovery reference when both storage writes and rollback fail", async () => {
    const s = await service();
    mock.save.mockRejectedValue(new Error("disk unavailable"));
    mock.remove.mockRejectedValueOnce(new Error("vault locked"));
    await expect(s.createTunnel(params)).rejects.toThrow("Keep the app open");
    const recovery = s.getTunnels()[0];
    expect(recovery.pendingCredentialRefs).toEqual([...mock.secrets.keys()]);
    expect(JSON.stringify(recovery)).not.toContain(params.password);
    mock.save.mockResolvedValue(undefined);
    await s.deleteTunnel(recovery.id);
    expect(mock.secrets.size).toBe(0);
  });

  it("does not treat an unavailable vault as confirmation that cleanup is finished", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    mock.remove.mockRejectedValueOnce(new Error("access denied"));
    mock.read.mockRejectedValueOnce(new Error("vault locked"));
    await expect(s.deleteTunnel(t.id)).rejects.toThrow(
      "remove the old SSH tunnel password",
    );
    expect(s.getTunnel(t.id)?.pendingDeletion).toBe(true);
    expect(mock.secrets.has(t.credentialRef!)).toBe(true);
    await s.deleteTunnel(t.id);
    expect(mock.disk).toEqual([]);
  });
  it("does not silently bypass legacy SSH transport overrides", async () => {
    const s = await service();
    const t = await s.createTunnel({
      name: "Saved",
      sshConnectionId: "base",
      type: "dynamic",
    });
    await expect(
      s.connectTunnel(t.id, {
        ...base,
        sshConnectionConfigOverride: {
          enableJumpHost: true,
          jumpHostConnectionId: "jump",
        },
      }),
    ).rejects.toThrow("configured route was not bypassed");
    expect(mock.invoke).not.toHaveBeenCalledWith(
      "connect_ssh",
      expect.anything(),
    );
  });
  it("retains retired vault references durably when cleanup fails, then retries on save", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    const old = t.credentialRef;
    mock.remove.mockRejectedValueOnce(new Error("vault locked"));
    await expect(
      s.updateTunnel(t.id, { password: "replacement" }),
    ).rejects.toThrow("remove the old SSH tunnel password");
    expect(
      (mock.disk as Array<{ pendingCredentialRefs: string[] }>)[0]
        .pendingCredentialRefs,
    ).toEqual([old]);
    expect(mock.secrets.size).toBe(2);
    await s.updateTunnel(t.id, { name: "Retry cleanup" });
    expect(mock.secrets.size).toBe(1);
    expect(
      (mock.disk as Array<{ pendingCredentialRefs: string[] }>)[0]
        .pendingCredentialRefs,
    ).toEqual([]);
  });

  it("keeps a deleted tunnel's credential reference available when vault deletion fails", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    mock.remove.mockRejectedValueOnce(new Error("vault locked"));
    await expect(s.deleteTunnel(t.id)).rejects.toThrow(
      "remove the old SSH tunnel password",
    );
    expect(s.getTunnel(t.id)?.credentialRef).toBe(t.credentialRef);
    await s.deleteTunnel(t.id);
    expect(s.getTunnel(t.id)).toBeUndefined();
  });

  it("cancels a pending native connect and cleans its returned actor before forwarding", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    let release!: (id: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mock.invoke.mockImplementation((cmd) => {
      if (cmd === "connect_ssh") {
        entered();
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const connected = s.connectTunnel(t.id);
    const rejected = expect(connected).rejects.toThrow("cancelled");
    await started;
    const disconnected = s.disconnectTunnel(t.id);
    release("pending-session");
    await rejected;
    await disconnected;
    expect(mock.invoke).toHaveBeenCalledWith("disconnect_ssh", {
      sessionId: "pending-session",
    });
    expect(mock.invoke).not.toHaveBeenCalledWith(
      "setup_port_forward",
      expect.anything(),
    );
    expect(s.getTunnel(t.id)?.status).toBe("disconnected");
  });

  it("bulk disconnect attempts every tunnel and retains failed cleanup handles", async () => {
    const s = await service();
    const a = await s.createTunnel(params);
    const b = await s.createTunnel({ ...params, name: "Other" });
    await s.connectTunnel(a.id);
    await s.connectTunnel(b.id);
    mock.invoke.mockRejectedValueOnce(new Error("cleanup unavailable"));
    await expect(s.disconnectAllTunnels()).rejects.toThrow("Some SSH tunnels");
    expect(s.getTunnel(a.id)).toMatchObject({
      needsCleanup: true,
      sshSessionId: "session",
    });
    expect(s.getTunnel(b.id)?.status).toBe("disconnected");
    await s.disconnectTunnel(a.id);
    expect(s.getTunnel(a.id)?.needsCleanup).toBe(false);
  });
  it("stores only an opaque reference, reloads and connects standalone with the OS-vault password", async () => {
    const first = await service();
    const tunnel = await first.createTunnel(params);
    expect(JSON.stringify(mock.disk)).not.toContain(params.password);
    expect(JSON.stringify(first.getTunnels())).not.toContain(params.password);
    expect(mock.store).toHaveBeenCalledOnce();
    vi.resetModules();
    const reloaded = await service();
    await reloaded.connectTunnel(tunnel.id);
    expect(config()).toMatchObject({
      host: params.host,
      port: 2222,
      username: "alice",
      password: params.password,
      strict_host_key_checking: true,
      allow_agent_auth: false,
    });
    await reloaded.deleteTunnel(tunnel.id);
    expect(mock.secrets.size).toBe(0);
  });

  it("fails saving safely when the OS vault is unavailable, without writing metadata or exposing provider errors", async () => {
    mock.store.mockRejectedValue(new Error(params.password));
    const s = await service();
    await expect(s.createTunnel(params)).rejects.toThrow("OS credential vault");
    expect(mock.save).not.toHaveBeenCalled();
    expect(s.getTunnels()).toEqual([]);
  });

  it("rolls back newly written credentials if metadata persistence fails", async () => {
    mock.save.mockRejectedValue(new Error("disk unavailable"));
    const s = await service();
    await expect(s.createTunnel(params)).rejects.toThrow("disk unavailable");
    expect(mock.secrets.size).toBe(0);
    expect(s.getTunnels()).toEqual([]);
  });

  it("retains the password for a name edit, rotates it explicitly, and removes it on switching to a saved base", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    await s.updateTunnel(t.id, { name: "Renamed" });
    expect(mock.store).toHaveBeenCalledOnce();
    await s.updateTunnel(t.id, { password: "replacement" });
    expect(mock.secrets.size).toBe(1);
    expect(JSON.stringify(mock.disk)).not.toContain("replacement");
    await s.updateTunnel(t.id, { sshConnectionId: "base" });
    expect(mock.secrets.size).toBe(0);
    expect(s.getTunnel(t.id)?.host).toBeUndefined();
  });

  it("requires re-entry after changing the sealed destination and prevents metadata tampering from sending the password elsewhere", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    await expect(
      s.updateTunnel(t.id, { host: "other.example" }),
    ).rejects.toThrow("destination changed");
    (mock.disk as Array<{ host: string }>)[0].host = "attacker.example";
    vi.resetModules();
    await expect((await service()).connectTunnel(t.id)).rejects.toThrow(
      "destination changed",
    );
    expect(mock.invoke).not.toHaveBeenCalledWith(
      "connect_ssh",
      expect.anything(),
    );
  });

  it("does not connect or fall back when a stored password cannot be retrieved", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    mock.read.mockRejectedValue(new Error(params.password));
    await expect(s.connectTunnel(t.id)).rejects.toThrow(
      "Unlock the OS credential vault",
    );
    expect(s.getTunnel(t.id)?.error).not.toContain(params.password);
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("uses resolved vault auth, preserves routed transport, and never falls back to local secrets", async () => {
    const s = await service();
    const t = await s.createTunnel({
      name: "Saved",
      sshConnectionId: "base",
      type: "dynamic",
    });
    const connection = {
      ...base,
      credentialSource: {
        kind: "vault",
        credentialId: "12345678-1234-4234-8234-123456789012",
      },
    } as Connection;
    await expect(s.connectTunnel(t.id, connection)).rejects.toThrow(
      "No local credential fallback",
    );
    expect(mock.invoke).not.toHaveBeenCalled();
    mock.path.mockResolvedValue({
      transport: {
        jump_hosts: [{ host: "jump" }],
        proxy_config: { host: "proxy" },
        proxy_chain: null,
        mixed_chain: null,
        openvpn_config: null,
        vpnPreSteps: [{ vpnType: "wireguard", connectionId: "vpn" }],
      },
      redactionSecrets: [],
    });
    const vault = {
      facets: { username: "vault-user", password: "vault-secret" },
      assertCurrent: vi.fn(),
    };
    await s.connectTunnel(t.id, connection, { vault });
    expect(config()).toMatchObject({
      username: "vault-user",
      password: "vault-secret",
      jump_hosts: [{ host: "jump" }],
      proxy_config: { host: "proxy" },
      allow_agent_auth: false,
    });
    expect(vault.facets).toEqual({});
    await s.disconnectTunnel(t.id);
    const commands = mock.invoke.mock.calls.map((c) => c[0]);
    expect(commands.indexOf("acquire_vpn_leases")).toBeLessThan(
      commands.indexOf("connect_ssh"),
    );
    expect(commands.indexOf("disconnect_ssh")).toBeLessThan(
      commands.indexOf("release_vpn_leases"),
    );
  });

  it("closes a partially opened SSH session if forwarding fails and redacts errors", async () => {
    const s = await service();
    const t = await s.createTunnel(params);
    mock.invoke.mockImplementation(async (cmd) => {
      if (cmd === "connect_ssh") return "session";
      if (cmd === "setup_port_forward")
        throw new Error(`backend echoed ${params.password}`);
    });
    await expect(s.connectTunnel(t.id)).rejects.toThrow("[redacted]");
    expect(mock.invoke).toHaveBeenCalledWith("disconnect_ssh", {
      sessionId: "session",
    });
    expect(s.getTunnel(t.id)?.sshSessionId).toBeUndefined();
  });

  it("rechecks access after forwarding and cleans up on database revocation", async () => {
    const s = await service();
    const t = await s.createTunnel({
      name: "Saved",
      sshConnectionId: "base",
      type: "dynamic",
    });
    let locked = false;
    mock.invoke.mockImplementation(async (cmd) => {
      if (cmd === "connect_ssh") return "session";
      if (cmd === "setup_port_forward") {
        locked = true;
        return "forward";
      }
    });
    await expect(
      s.connectTunnel(t.id, base, {
        assertCurrent: () => {
          if (locked) throw new Error("Database locked");
        },
      }),
    ).rejects.toThrow("Database locked");
    expect(mock.invoke).toHaveBeenCalledWith("disconnect_ssh", {
      sessionId: "session",
    });
    expect(s.getTunnel(t.id)?.status).toBe("error");
  });

  it("rejects unsupported or missing network paths without connecting directly", async () => {
    const s = await service();
    const t = await s.createTunnel({
      name: "Saved",
      sshConnectionId: "base",
      type: "dynamic",
    });
    mock.path.mockRejectedValue(new Error("Network path blocked"));
    await expect(s.connectTunnel(t.id, base)).rejects.toThrow(
      "Network path blocked",
    );
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});
