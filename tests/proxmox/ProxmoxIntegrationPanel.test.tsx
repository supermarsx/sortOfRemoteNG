// t67-e4 — ProxmoxIntegrationPanel adapter: vault hydration, auto-connect,
// API-token detection, TFA second step, TOFU probe, web-UI launch, take-over.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import ProxmoxIntegrationPanel, {
  hydrateProxmoxInstance,
  parseHostPort,
} from "../../src/components/integrations/proxmox/ProxmoxIntegrationPanel";
import { PROXMOX_OPEN_WEB_UI_EVENT } from "../../src/components/integrations/proxmox/webUiLaunch";
import {
  resetIntegrationConfigStoreForTests,
  type IntegrationInstance,
} from "../../src/hooks/integrations/useIntegrationConfigStore";
import { clearRuntimeConnectionsForTests } from "../../src/utils/session/runtimeConnectionRegistry";

const PIN =
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

let persisted: string | null;
let vault: Record<string, string>;
let connectedState: { host: string; port: number } | null;
let connectOutcome: () => unknown;
let calls: () => Array<[string, Record<string, unknown> | undefined]>;

function seedInstance(
  overrides: Partial<IntegrationInstance> = {},
): IntegrationInstance {
  const inst: IntegrationInstance = {
    id: "pve-1",
    integrationKey: "proxmox",
    name: "Lab PVE",
    host: "pve.lab:8006",
    credentialRefId: "ref-primary",
    credentialRefIds: { password: "ref-pw", totpSecret: "ref-totp" },
    fields: {
      username: "root@pam",
      authMode: "password",
      tlsVerify: "false",
      fingerprint: PIN,
      timeoutSecs: "45",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  persisted = JSON.stringify([inst]);
  return inst;
}

beforeEach(() => {
  persisted = null;
  vault = { "ref-pw": "secret123", "ref-primary": "secret123" };
  connectedState = null;
  connectOutcome = () => ({
    state: "connected",
    username: "root@pam",
    message: "Connected to pve.lab",
  });
  invokeMock.mockReset();
  resetIntegrationConfigStoreForTests();
  clearRuntimeConnectionsForTests();
  calls = () =>
    invokeMock.mock.calls as Array<
      [string, Record<string, unknown> | undefined]
    >;
  invokeMock.mockImplementation(
    (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "read_app_data":
          return Promise.resolve(persisted);
        case "compare_and_swap_app_data": {
          const req = args as { expected: string | null; replacement: string };
          if (req.expected !== persisted) return Promise.resolve(false);
          persisted = req.replacement;
          return Promise.resolve(true);
        }
        case "vault_read_secret": {
          const account = (args as { account: string }).account;
          return account in vault
            ? Promise.resolve(vault[account])
            : Promise.reject(new Error("no such secret"));
        }
        case "vault_store_secret":
        case "vault_delete_secret":
          return Promise.resolve(undefined);
        case "proxmox_is_connected":
          return Promise.resolve(connectedState !== null);
        case "proxmox_get_config":
          return Promise.resolve(
            connectedState
              ? { ...connectedState, username: "x", insecure: false }
              : null,
          );
        case "proxmox_disconnect":
          connectedState = null;
          return Promise.resolve(undefined);
        case "proxmox_connect_ex": {
          const a = args as { host: string; port: number };
          connectedState = { host: a.host, port: a.port };
          return Promise.resolve(connectOutcome());
        }
        case "proxmox_submit_tfa":
          return Promise.resolve({
            state: "connected",
            username: "root@pam",
            message: "Connected",
          });
        case "proxmox_probe_certificate":
          return Promise.resolve({
            sha256: PIN,
            subject: "CN=pve.lab",
            issuer: "CN=pve.lab",
            notBefore: "2026-01-01T00:00:00Z",
            notAfter: "2036-01-01T00:00:00Z",
            selfSigned: true,
            subjectAltNames: ["pve.lab"],
          });
        case "proxmox_get_version":
          return Promise.resolve({
            version: "8.2",
            release: "8.2-1",
            repoid: "abc",
          });
        case "proxmox_list_nodes":
          return Promise.resolve([{ node: "pve-mock", status: "online" }]);
        case "proxmox_list_qemu_vms":
        case "proxmox_list_lxc_containers":
        case "proxmox_list_storage":
        case "proxmox_get_cluster_status":
        case "proxmox_list_cluster_resources":
        case "proxmox_list_tasks":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    },
  );
  (
    globalThis as unknown as {
      __TAURI__?: { core: { invoke: typeof invokeMock } };
    }
  ).__TAURI__ = {
    core: {
      invoke: ((cmd: string, args?: Record<string, unknown>) =>
        invokeMock(cmd, args)) as unknown as typeof invokeMock,
    },
  };
});

afterEach(() => {
  cleanup();
});

const connectCalls = () =>
  calls().filter(([cmd]) => cmd === "proxmox_connect_ex");

describe("parseHostPort / hydrateProxmoxInstance", () => {
  it("splits host:port and brackets IPv6", () => {
    expect(parseHostPort("pve.lab:8007")).toEqual({
      host: "pve.lab",
      port: 8007,
    });
    expect(parseHostPort("https://pve.lab/")).toEqual({
      host: "pve.lab",
      port: 8006,
    });
    expect(parseHostPort("[::1]:9006")).toEqual({ host: "::1", port: 9006 });
    expect(parseHostPort("[fe80::1]")).toEqual({ host: "fe80::1", port: 8006 });
    expect(parseHostPort(undefined, 1234)).toEqual({ host: "", port: 1234 });
  });

  it("detects API-token mode from user@realm!name and uses apiKey secret", () => {
    const inst = seedInstance({
      credentialRefIds: { apiKey: "ref-key" },
      fields: { username: "automation@pve!ci", tlsVerify: "true" },
    });
    const { initial } = hydrateProxmoxInstance(inst, {
      apiKey: "tok-secret",
      primary: "ignored",
    });
    expect(initial.useApiToken).toBe(true);
    expect(initial.tokenId).toBe("automation@pve!ci");
    expect(initial.tokenSecret).toBe("tok-secret");
    expect(initial.password).toBeUndefined();
    expect(initial.insecure).toBe(false);
  });

  it("maps password mode with realm, pin, timeout and totp secret", () => {
    const inst = seedInstance({
      fields: {
        username: "ops",
        realm: "pve",
        tlsVerify: "false",
        fingerprint: PIN,
        timeout: "20",
      },
    });
    const { initial } = hydrateProxmoxInstance(inst, {
      password: "pw",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
    expect(initial).toMatchObject({
      host: "pve.lab",
      port: 8006,
      username: "ops",
      realm: "pve",
      password: "pw",
      totpSecret: "JBSWY3DPEHPK3PXP",
      insecure: true,
      fingerprint: PIN,
      timeoutSecs: 20,
      useApiToken: false,
    });
  });
});

describe("ProxmoxIntegrationPanel", () => {
  it("hydrates from the saved instance + vault and auto-connects once", async () => {
    seedInstance();
    render(
      <React.StrictMode>
        <ProxmoxIntegrationPanel isOpen onClose={() => {}} instanceId="pve-1" />
      </React.StrictMode>,
    );

    await screen.findByTestId("proxmox-tab-dashboard");
    expect(connectCalls()).toHaveLength(1);
    expect(connectCalls()[0][1]).toMatchObject({
      host: "pve.lab",
      port: 8006,
      username: "root@pam",
      password: "secret123",
      insecure: true,
      fingerprint: PIN,
      acknowledgeInvalidCertRisk: true,
      timeoutSecs: 45,
    });
    // Embedded layout: instance name in the header, no modal.
    expect(screen.getByTestId("proxmox-embedded")).toBeInTheDocument();
    expect(screen.getByText("Lab PVE")).toBeInTheDocument();
    // Secrets never go back into the persisted instance record.
    expect(persisted).not.toContain("secret123");
  });

  it("uses the API token from the vault when the username carries a token name", async () => {
    seedInstance({
      credentialRefId: "ref-key",
      credentialRefIds: { apiKey: "ref-key" },
      fields: { username: "automation@pve!ci", tlsVerify: "true" },
    });
    vault = { "ref-key": "tok-secret" };
    render(
      <ProxmoxIntegrationPanel isOpen onClose={() => {}} instanceId="pve-1" />,
    );
    await screen.findByTestId("proxmox-tab-dashboard");
    expect(connectCalls()[0][1]).toMatchObject({
      tokenId: "automation@pve!ci",
      tokenSecret: "tok-secret",
      insecure: false,
    });
    expect(connectCalls()[0][1]?.password).toBeUndefined();
  });

  it("walks the TFA second step and persists non-secret fields after connect", async () => {
    seedInstance({
      fields: { username: "root@pam", tlsVerify: "true" },
      credentialRefIds: { password: "ref-pw" },
    });
    connectOutcome = () => ({
      state: "tfaRequired",
      username: "root@pam",
      tfaTypes: ["totp", "recovery"],
    });
    render(
      <ProxmoxIntegrationPanel isOpen onClose={() => {}} instanceId="pve-1" />,
    );
    const code = await screen.findByTestId("proxmox-tfa-code");
    expect(screen.getByTestId("proxmox-tfa-submit")).toBeDisabled();
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("proxmox-tfa-submit"));

    await screen.findByTestId("proxmox-tab-dashboard");
    expect(invokeMock).toHaveBeenCalledWith("proxmox_submit_tfa", {
      code: "123456",
      kind: "totp",
    });
    await waitFor(() => {
      const saved = JSON.parse(persisted ?? "[]") as IntegrationInstance[];
      expect(saved[0].fields).toMatchObject({
        username: "root@pam",
        insecure: "false",
        realm: "",
      });
    });
  });

  it("passes the vault TOTP secret so the crate auto-completes TFA", async () => {
    seedInstance();
    vault["ref-totp"] = "JBSWY3DPEHPK3PXP";
    render(
      <ProxmoxIntegrationPanel isOpen onClose={() => {}} instanceId="pve-1" />,
    );
    await screen.findByTestId("proxmox-tab-dashboard");
    expect(connectCalls()[0][1]).toMatchObject({
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
  });

  it("does not auto-connect an insecure instance without a pin; probe → accept → connect with the pin", async () => {
    seedInstance({
      fields: { username: "root@pam", tlsVerify: "false" },
    });
    render(
      <ProxmoxIntegrationPanel isOpen onClose={() => {}} instanceId="pve-1" />,
    );
    await screen.findByTestId("proxmox-connection-form");
    expect(connectCalls()).toHaveLength(0);
    expect(screen.getByTestId("proxmox-connect-btn")).toBeDisabled();

    fireEvent.click(screen.getByTestId("proxmox-probe-cert-btn"));
    await screen.findByTestId("proxmox-cert-probe");
    expect(invokeMock).toHaveBeenCalledWith("proxmox_probe_certificate", {
      host: "pve.lab",
      port: 8006,
    });
    expect(screen.getByText(PIN)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("proxmox-cert-accept-btn"));
    expect(
      (screen.getByTestId("proxmox-fingerprint") as HTMLInputElement).value,
    ).toBe(PIN);

    fireEvent.click(screen.getByTestId("proxmox-connect-btn"));
    // Accepting the probe is the consent — no generic warning modal.
    expect(screen.queryByTestId("insecure-tls-warning-modal")).toBeNull();
    await screen.findByTestId("proxmox-tab-dashboard");
    expect(connectCalls()[0][1]).toMatchObject({
      insecure: true,
      fingerprint: PIN,
      acknowledgeInvalidCertRisk: true,
    });
    await waitFor(() => {
      const saved = JSON.parse(persisted ?? "[]") as IntegrationInstance[];
      expect(saved[0].fields?.fingerprint).toBe(PIN);
      expect(saved[0].fields?.insecure).toBe("true");
    });
  });

  it("launches the web UI as an ephemeral auto-login https connection", async () => {
    seedInstance();
    const seen: CustomEvent[] = [];
    const listener = (e: Event) => seen.push(e as CustomEvent);
    window.addEventListener(PROXMOX_OPEN_WEB_UI_EVENT, listener);
    try {
      render(
        <ProxmoxIntegrationPanel
          isOpen
          onClose={() => {}}
          instanceId="pve-1"
        />,
      );
      await screen.findByTestId("proxmox-tab-dashboard");
      fireEvent.click(screen.getByTestId("proxmox-open-web-ui"));
      expect(seen).toHaveLength(1);
      expect(seen[0].detail.source).toBe("proxmox");
      expect(seen[0].detail.connection).toMatchObject({
        protocol: "https",
        hostname: "pve.lab",
        port: 8006,
        username: "root@pam",
        password: "secret123",
        httpAutoLogin: true,
        httpVerifySsl: false,
      });
      fireEvent.click(screen.getByTestId("proxmox-open-web-ui-external"));
      expect(invokeMock).toHaveBeenCalledWith("open_url_external", {
        url: "https://pve.lab:8006/",
      });
    } finally {
      window.removeEventListener(PROXMOX_OPEN_WEB_UI_EVENT, listener);
    }
  });

  it("never carries a password into the web UI in API-token mode", async () => {
    seedInstance({
      credentialRefId: "ref-key",
      credentialRefIds: { apiKey: "ref-key" },
      fields: { username: "automation@pve!ci", tlsVerify: "true" },
    });
    vault = { "ref-key": "tok-secret" };
    const seen: CustomEvent[] = [];
    const listener = (e: Event) => seen.push(e as CustomEvent);
    window.addEventListener(PROXMOX_OPEN_WEB_UI_EVENT, listener);
    try {
      render(
        <ProxmoxIntegrationPanel
          isOpen
          onClose={() => {}}
          instanceId="pve-1"
        />,
      );
      await screen.findByTestId("proxmox-tab-dashboard");
      fireEvent.click(screen.getByTestId("proxmox-open-web-ui"));
      expect(seen[0].detail.connection.httpAutoLogin).toBe(false);
      expect(seen[0].detail.connection.password).toBeUndefined();
      expect(seen[0].detail.connection.username).toBeUndefined();
      expect(seen[0].detail.connection.httpVerifySsl).toBeUndefined();
    } finally {
      window.removeEventListener(PROXMOX_OPEN_WEB_UI_EVENT, listener);
    }
  });

  it("guards the global client bound to another host and lets the user take over", async () => {
    seedInstance();
    connectedState = { host: "other.lab", port: 8006 };
    render(
      <ProxmoxIntegrationPanel isOpen onClose={() => {}} instanceId="pve-1" />,
    );
    await screen.findByTestId("proxmox-busy-elsewhere");
    expect(connectCalls()).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByTestId("proxmox-takeover-btn"));
    });
    await screen.findByTestId("proxmox-tab-dashboard");
    const order = calls().map(([cmd]) => cmd);
    expect(order.indexOf("proxmox_disconnect")).toBeGreaterThan(-1);
    expect(order.indexOf("proxmox_disconnect")).toBeLessThan(
      order.indexOf("proxmox_connect_ex"),
    );
    expect(connectCalls()).toHaveLength(1);
  });

  it("renders nothing when closed", () => {
    seedInstance();
    const { container } = render(
      <ProxmoxIntegrationPanel
        isOpen={false}
        onClose={() => {}}
        instanceId="pve-1"
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
