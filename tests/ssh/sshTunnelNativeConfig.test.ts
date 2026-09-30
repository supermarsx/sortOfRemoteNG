import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { ResolvedChainConfig } from "../../src/utils/ssh/resolveChainConfig";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  assertPath: vi.fn(),
  settings: {} as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {},
  onCurrentDatabaseChange: vi.fn(),
}));
vi.mock("../../src/utils/security/runtimeCredentialVault", () => ({
  resolveRuntimeVaultCredential: vi.fn(),
}));
vi.mock("../../src/utils/ssh/sshTunnelTrust", () => ({
  listenForTunnelTrust: mocks.listen,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => mocks.settings }),
  },
}));
vi.mock("../../src/utils/storage/appDataJsonStore", () => ({
  AppDataJsonStore: class {
    async load() {
      return { value: [], sanitized: false };
    }
    async save() {}
  },
}));
vi.mock("../../src/utils/storage/storage", () => ({ SecureStorage: {} }));
vi.mock("../../src/utils/network/resolveRuntimeNetworkPath", () => ({
  resolveRuntimeNetworkPath: async () => ({
    transport,
    redactionSecrets: [],
    assertCurrent: mocks.assertPath,
  }),
}));

import {
  buildSshTunnelNativeConfig,
  connectSshTunnelTransport,
} from "../../src/utils/ssh/sshTunnelRuntime";
import { sshTunnelService } from "../../src/utils/ssh/sshTunnelService";

const endpoint = {
  host: "bastion.example",
  port: 2222,
  username: "alice",
  password: "synthetic-password",
};
const transport: ResolvedChainConfig = {
  jump_hosts: [],
  proxy_config: null,
  proxy_chain: null,
  mixed_chain: null,
  openvpn_config: null,
  vpnPreSteps: [],
};
const serialized = (value: unknown) => JSON.parse(JSON.stringify(value));
const expected = {
  host: "bastion.example",
  port: 2222,
  username: "alice",
  password: "synthetic-password",
  private_key_path: null,
  private_key_content: null,
  private_key_passphrase: null,
  allow_agent_auth: true,
  totp_secret: null,
  totp_options: null,
  keyboard_interactive_responses: [],
  agent_forwarding: false,
  jump_hosts: [],
  proxy_config: null,
  proxy_chain: null,
  mixed_chain: null,
  openvpn_config: null,
  connect_timeout: 30,
  keep_alive_interval: 30,
  strict_host_key_checking: true,
  accept_new_host_keys: false,
  also_write_known_hosts: true,
  known_hosts_path: null,
  tcp_no_delay: true,
  tcp_keepalive: true,
  keepalive_probes: 3,
  ip_protocol: "auto",
  compression: false,
  compression_level: 6,
  ssh_version: "auto",
  preferred_ciphers: [],
  preferred_macs: [],
  preferred_kex: [],
  preferred_host_key_algorithms: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = {};
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "connect_ssh"
      ? "native-session"
      : command === "setup_port_forward"
        ? "native-forward"
        : undefined,
  );
});

describe("native SSH tunnel JSON contract", () => {
  it("serializes a complete RDP bastion payload with host-key enforcement and native agent fallback", () => {
    expect(serialized(buildSshTunnelNativeConfig(endpoint, transport))).toEqual(
      expected,
    );
  });

  it("covers every required non-defaulted native field after actual JSON serialization", () => {
    const source = readFileSync(
      "src-tauri/crates/sorng-ssh/src/ssh/types.rs",
      "utf8",
    );
    const body = source
      .split("pub struct SshConnectionConfig {")[1]
      .split("\n}")[0];
    let annotations = "";
    const required: string[] = [];
    for (const line of body.split("\n")) {
      if (line.trim().startsWith("#[")) annotations += line;
      const field = line.match(/^\s*pub (\w+): (.+),\s*$/);
      if (!field) continue;
      if (!annotations.includes("default") && !field[2].startsWith("Option<"))
        required.push(field[1]);
      annotations = "";
    }
    expect(required).toEqual([
      "host",
      "port",
      "username",
      "jump_hosts",
      "strict_host_key_checking",
    ]);
    const payload = serialized(
      buildSshTunnelNativeConfig(endpoint, transport, {
        sshConfig: { strictHostKeyChecking: undefined },
      }),
    );
    required.forEach((key) => expect(payload).toHaveProperty(key));
    expect(payload.strict_host_key_checking).toBe(true);
  });

  it.each([{}, { strictHostKeyChecking: undefined }, { connectTimeout: 12 }])(
    "keeps required security booleans with partial persisted settings %j",
    (sshConfig) => {
      expect(
        serialized(
          buildSshTunnelNativeConfig(endpoint, transport, { sshConfig }),
        ).strict_host_key_checking,
      ).toBe(true);
    },
  );

  it("does not let legacy toggles disable strict Trust Center policy", () => {
    const config = buildSshTunnelNativeConfig(endpoint, transport, {
      sshConfig: { strictHostKeyChecking: false },
      ignoreSshSecurityErrors: true,
      trustPolicy: "strict",
    });
    expect(serialized(config).strict_host_key_checking).toBe(true);
    expect(config.accept_new_host_keys).toBe(false);
  });

  it("preserves explicitly selected saved-tunnel key material and disabled agent fallback", () => {
    const config = buildSshTunnelNativeConfig(
      {
        ...endpoint,
        password: null,
        private_key_content: "synthetic-key",
        private_key_passphrase: "synthetic-passphrase",
        allow_agent_auth: false,
      },
      transport,
    );
    expect(serialized(config)).toMatchObject({
      password: null,
      private_key_path: null,
      private_key_content: "synthetic-key",
      private_key_passphrase: "synthetic-passphrase",
      allow_agent_auth: false,
      strict_host_key_checking: true,
    });
  });

  it("uses the same serialized config in the RDP/shared handshake with listener ordering and cleanup", async () => {
    const assertCurrent = vi.fn();
    await expect(
      connectSshTunnelTransport(endpoint, transport, {
        trustPolicy: "always-ask",
        assertCurrent,
      }),
    ).resolves.toBe("native-session");
    expect(
      serialized(
        mocks.invoke.mock.calls.find(
          ([command]) => command === "connect_ssh",
        )?.[1],
      ),
    ).toEqual({ config: expected });
    expect(mocks.listen).toHaveBeenCalledWith(
      endpoint.host,
      2222,
      "alice",
      undefined,
      "always-ask",
      expect.any(Function),
    );
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invoke.mock.invocationCallOrder[0],
    );
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(assertCurrent).toHaveBeenCalledTimes(4);
  });

  it("stops before native disclosure when trust-listener registration fails", async () => {
    mocks.listen.mockRejectedValueOnce(new Error("trust unavailable"));
    await expect(
      connectSshTunnelTransport(endpoint, transport),
    ).rejects.toThrow("trust unavailable");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("cleans the listener when native host-key verification rejects", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("host key rejected"));
    await expect(
      connectSshTunnelTransport(endpoint, transport),
    ).rejects.toThrow("host key rejected");
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("disconnects a completed handshake if the route became stale", async () => {
    const assertCurrent = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("source changed");
      });
    await expect(
      connectSshTunnelTransport(endpoint, transport, { assertCurrent }),
    ).rejects.toThrow("source changed");
    expect(mocks.invoke).toHaveBeenLastCalledWith("disconnect_ssh", {
      sessionId: "native-session",
    });
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("saved tunnel callers send the shared complete payload with agent fallback still disabled", async () => {
    mocks.settings = {
      sshConnection: { connectTimeout: 41 },
      sshTrustPolicy: "strict",
    };
    const connection = {
      id: "source",
      protocol: "ssh",
      hostname: endpoint.host,
      port: endpoint.port,
      username: endpoint.username,
      password: endpoint.password,
    } as Connection;
    const tunnel = await sshTunnelService.createTunnel({
      name: "RDP local forward",
      sshConnectionId: connection.id,
      localPort: 13389,
      remoteHost: "rdp.internal",
      remotePort: 3389,
    });
    try {
      await sshTunnelService.connectTunnel(tunnel.id, connection);
      expect(
        serialized(
          mocks.invoke.mock.calls.find(
            ([command]) => command === "connect_ssh",
          )?.[1],
        ),
      ).toEqual({
        config: { ...expected, allow_agent_auth: false, connect_timeout: 41 },
      });
      expect(mocks.assertPath).toHaveBeenCalled();
      expect(mocks.listen).toHaveBeenCalledWith(
        endpoint.host,
        2222,
        "alice",
        connection.id,
        "strict",
        expect.any(Function),
      );
    } finally {
      await sshTunnelService.deleteTunnel(tunnel.id);
    }
  });

  it("RDP consumes the shared handshake instead of constructing an incomplete native config", () => {
    const source = readFileSync("src/hooks/rdp/useRDPClient.ts", "utf8");
    const tunnel = source.slice(
      source.indexOf("const establishRdpTunnel"),
      source.indexOf("const establishRdpTunnel") + 7000,
    );
    expect(tunnel).toContain("connectSshTunnelTransport(bastion, resolved");
    expect(tunnel).toContain("strictHostKeyChecking: true");
    expect(tunnel).not.toContain('invoke<string>("connect_ssh"');
    expect(tunnel).not.toContain("private_key_path:");
  });
});
