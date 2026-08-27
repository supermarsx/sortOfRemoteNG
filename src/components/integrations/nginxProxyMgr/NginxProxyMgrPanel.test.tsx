import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NpmConnectionSummary } from "../../../types/nginxProxyMgr";

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

const store = vi.hoisted(() => ({
  isLoading: false,
  instances: [] as unknown[],
  instancesFor: vi.fn(() => [] as unknown[]),
  createInstance: vi.fn(async (input: Record<string, unknown>) => ({
    id: "inst-1",
    ...input,
  })),
  updateInstance: vi.fn(async (id: string, input: Record<string, unknown>) => ({
    id,
    ...input,
  })),
  readSecret: vi.fn(async () => null as string | null),
  readNamedSecret: vi.fn(async () => null as string | null),
}));
vi.mock("../../../hooks/integrations/useIntegrationConfigStore", () => ({
  useIntegrationConfigStore: () => store,
}));

const mgr = vi.hoisted(() => {
  const m = {
    connectionId: null as string | null,
    status: "disconnected" as string,
    summary: null as NpmConnectionSummary | null,
    proxyHosts: [] as unknown[],
    redirectionHosts: [] as unknown[],
    streams: [] as unknown[],
    certificates: [] as unknown[],
    webUiUrl: null as string | null,
    error: null as string | null,
    busy: false,
    isConnected: false,
    isConnecting: false,
    setError: vi.fn(),
    clearError: vi.fn(),
    connect: vi.fn(async (_id: string, _config: unknown) => true),
    disconnect: vi.fn(async () => {}),
    refreshSummary: vi.fn(async () => null),
    refreshToken: vi.fn(async () => null),
    refreshAll: vi.fn(async () => null),
    loadProxyHosts: vi.fn(async () => []),
    toggleProxyHost: vi.fn(async () => {}),
    loadRedirectionHosts: vi.fn(async () => []),
    toggleRedirectionHost: vi.fn(async () => {}),
    loadStreams: vi.fn(async () => []),
    toggleStream: vi.fn(async () => {}),
    loadCertificates: vi.fn(async () => []),
    renewCertificate: vi.fn(async () => null),
    api: {},
    run: vi.fn(),
  };
  return m;
});
vi.mock("../../../hooks/integration/useNginxProxyMgr", () => ({
  useNginxProxyMgr: () => mgr,
}));

const launchNpmWebUi = vi.hoisted(() => vi.fn());
vi.mock("./webUiLaunch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./webUiLaunch")>();
  return { ...actual, launchNpmWebUi };
});

// The TLS modal is heavy; stub it with a minimal ack/cancel surface.
vi.mock("../../security/InsecureTlsWarningModal", () => ({
  InsecureTlsWarningModal: ({
    isOpen,
    onAcknowledge,
    onCancel,
  }: {
    isOpen: boolean;
    onAcknowledge: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div data-testid="tls-modal">
        <button onClick={onAcknowledge}>ack</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    ) : null,
}));

import NginxProxyMgrPanel from "./NginxProxyMgrPanel";
import { nginxProxyMgrDescriptor } from "./descriptor";

function setDisconnected() {
  mgr.isConnected = false;
  mgr.isConnecting = false;
  mgr.status = "disconnected";
  mgr.summary = null;
  mgr.webUiUrl = null;
  mgr.error = null;
  mgr.proxyHosts = [];
  mgr.redirectionHosts = [];
  mgr.streams = [];
  mgr.certificates = [];
}

function setConnected() {
  mgr.isConnected = true;
  mgr.status = "connected";
  mgr.connectionId = "inst-1";
  mgr.summary = {
    api_url: "http://npm.local:81",
    user: "admin@example.com",
    version: "2.11.3",
    auth_mode: "password",
    token_expires_at: "2026-08-27T00:00:00Z",
  };
  mgr.webUiUrl = "http://npm.local:81";
}

function fillPasswordForm() {
  fireEvent.change(screen.getByTestId("npm-api-url"), {
    target: { value: "http://npm.local:81" },
  });
  fireEvent.change(screen.getByTestId("npm-email"), {
    target: { value: "admin@example.com" },
  });
  fireEvent.change(screen.getByTestId("npm-password"), {
    target: { value: "pw" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setDisconnected();
  store.instancesFor.mockReturnValue([]);
});

describe("nginxProxyMgrDescriptor", () => {
  it("is filed under web-server and lazy-loads the panel", async () => {
    expect(nginxProxyMgrDescriptor.key).toBe("nginxProxyMgr");
    expect(nginxProxyMgrDescriptor.category).toBe("web-server");
    const mod = await nginxProxyMgrDescriptor.importPanel();
    expect(mod.default).toBe(NginxProxyMgrPanel);
  });
});

describe("NginxProxyMgrPanel — connect form", () => {
  it("renders the form with password mode by default and no token field", () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    expect(screen.getByTestId("npm-connection-form")).toBeInTheDocument();
    expect(screen.getByTestId("npm-auth-mode-password")).toBeChecked();
    expect(screen.getByTestId("npm-email")).toBeInTheDocument();
    expect(screen.getByTestId("npm-password")).toBeInTheDocument();
    expect(screen.queryByTestId("npm-token")).toBeNull();
    expect(screen.getByTestId("npm-connect-btn")).toBeDisabled();
  });

  it("switching to token mode hides email/password and shows the token field", () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("npm-auth-mode-token"));
    expect(screen.getByTestId("npm-token")).toBeInTheDocument();
    expect(screen.queryByTestId("npm-email")).toBeNull();
    expect(screen.queryByTestId("npm-password")).toBeNull();
  });

  it("connects with a snake_case password config and persists non-secret fields", async () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    fillPasswordForm();
    fireEvent.change(screen.getByTestId("npm-timeout"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByTestId("npm-connect-btn"));

    await waitFor(() => expect(mgr.connect).toHaveBeenCalledTimes(1));
    expect(mgr.connect).toHaveBeenCalledWith("inst-1", {
      api_url: "http://npm.local:81",
      email: "admin@example.com",
      password: "pw",
      skip_tls_verify: false,
      acknowledge_invalid_cert_risk: false,
      timeout_secs: 15,
    });

    expect(store.createInstance).toHaveBeenCalledTimes(1);
    const input = store.createInstance.mock.calls[0][0] as unknown as {
      integrationKey: string;
      fields: Record<string, string>;
      secret?: string;
      secrets?: Record<string, string | undefined>;
    };
    expect(input.integrationKey).toBe("nginxProxyMgr");
    expect(input.fields).toEqual({
      apiUrl: "http://npm.local:81",
      email: "admin@example.com",
      authMode: "password",
      skipTlsVerify: "false",
      timeoutSecs: "15",
    });
    expect(JSON.stringify(input.fields)).not.toContain("pw");
    expect(input.secret).toBe("pw");
    expect(input.secrets).toEqual({ password: "pw", authToken: undefined });
  });

  it("connects with token only in token mode (no email/password on the wire)", async () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("npm-api-url"), {
      target: { value: "http://npm.local:81" },
    });
    fireEvent.click(screen.getByTestId("npm-auth-mode-token"));
    fireEvent.change(screen.getByTestId("npm-token"), {
      target: { value: "jwt-abc" },
    });
    fireEvent.click(screen.getByTestId("npm-connect-btn"));

    await waitFor(() => expect(mgr.connect).toHaveBeenCalledTimes(1));
    const config = mgr.connect.mock.calls[0][1] as Record<string, unknown>;
    expect(config).toMatchObject({
      api_url: "http://npm.local:81",
      token: "jwt-abc",
    });
    expect(config).not.toHaveProperty("email");
    expect(config).not.toHaveProperty("password");
    const input = store.createInstance.mock.calls[0][0] as unknown as {
      fields: Record<string, string>;
      secrets?: Record<string, string | undefined>;
    };
    expect(input.fields.authMode).toBe("token");
    expect(JSON.stringify(input.fields)).not.toContain("jwt-abc");
    expect(input.secrets).toEqual({
      authToken: "jwt-abc",
      password: undefined,
    });
  });

  it("requires the insecure-TLS acknowledgement for https + skip, then connects with the ack", async () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    fillPasswordForm();
    fireEvent.change(screen.getByTestId("npm-api-url"), {
      target: { value: "https://npm.local" },
    });
    fireEvent.click(screen.getByTestId("npm-tls-skip"));
    fireEvent.click(screen.getByTestId("npm-connect-btn"));

    // Connect is gated on the modal — nothing sent yet.
    expect(mgr.connect).not.toHaveBeenCalled();
    expect(screen.getByTestId("tls-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("ack"));
    await waitFor(() => expect(mgr.connect).toHaveBeenCalledTimes(1));
    expect(mgr.connect.mock.calls[0][1]).toMatchObject({
      api_url: "https://npm.local",
      skip_tls_verify: true,
      acknowledge_invalid_cert_risk: true,
    });
  });

  it("does not prompt for the ack on plain http even with the toggle on", async () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    fillPasswordForm();
    fireEvent.click(screen.getByTestId("npm-tls-skip"));
    fireEvent.click(screen.getByTestId("npm-connect-btn"));
    await waitFor(() => expect(mgr.connect).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("tls-modal")).toBeNull();
    expect(mgr.connect.mock.calls[0][1]).toMatchObject({
      skip_tls_verify: true,
      acknowledge_invalid_cert_risk: false,
    });
  });

  it("hydrates from a persisted instance incl. IntegrationPanelHost's bearer mapping", async () => {
    store.instancesFor.mockReturnValue([
      {
        id: "inst-9",
        integrationKey: "nginxProxyMgr",
        name: "Home NPM",
        host: "http://10.0.0.9:81",
        fields: { baseUrl: "http://10.0.0.9:81", authMode: "bearer" },
        credentialRefIds: { authToken: "ref-1" },
        createdAt: "",
        updatedAt: "",
      },
    ]);
    store.readNamedSecret.mockResolvedValueOnce("stored-jwt");
    render(
      <NginxProxyMgrPanel isOpen onClose={() => {}} instanceId="inst-9" />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("npm-token")).toHaveValue("stored-jwt"),
    );
    expect(screen.getByTestId("npm-api-url")).toHaveValue("http://10.0.0.9:81");
    expect(screen.getByTestId("npm-auth-mode-token")).toBeChecked();
    expect(store.readNamedSecret).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inst-9" }),
      "authToken",
    );
  });

  it("surfaces the hook error", () => {
    mgr.error = "tls_untrusted: certificate not trusted";
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    expect(screen.getByTestId("npm-error")).toHaveTextContent("tls_untrusted");
  });
});

describe("NginxProxyMgrPanel — connected", () => {
  beforeEach(() => {
    setConnected();
    mgr.proxyHosts = [
      {
        id: 7,
        domain_names: ["a.example.com", "b.example.com"],
        forward_host: "10.0.0.2",
        forward_port: 8080,
        forward_scheme: "http",
        enabled: 1,
      },
      {
        id: 8,
        domain_names: ["c.example.com"],
        forward_host: "10.0.0.3",
        forward_port: 443,
        forward_scheme: "https",
        enabled: false,
      },
    ];
    mgr.redirectionHosts = [
      {
        id: 3,
        domain_names: ["old.example.com"],
        forward_http_code: 301,
        forward_domain_name: "new.example.com",
        forward_scheme: "https",
        enabled: true,
      },
    ];
    mgr.streams = [
      {
        id: 5,
        incoming_port: 2222,
        forwarding_host: "10.0.0.4",
        forwarding_port: 22,
        tcp_forwarding: 1,
        udp_forwarding: 0,
        enabled: 1,
      },
    ];
    mgr.certificates = [
      {
        id: 11,
        provider: "letsencrypt",
        nice_name: "wild",
        domain_names: ["*.example.com"],
        expires_on: "2026-11-01 00:00:00",
      },
      {
        id: 12,
        provider: "other",
        nice_name: "custom",
        domain_names: ["x.example.com"],
        expires_on: null,
      },
    ];
  });

  it("shows the status bar and wires the refresh-token button", async () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    const status = screen.getByTestId("npm-status");
    expect(status).toHaveTextContent("2.11.3");
    expect(status).toHaveTextContent("admin@example.com");
    expect(status).toHaveTextContent("2026-08-27T00:00:00Z");
    fireEvent.click(screen.getByTestId("npm-refresh-token-btn"));
    await waitFor(() => expect(mgr.refreshToken).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("npm-disconnect-btn"));
    await waitFor(() => expect(mgr.disconnect).toHaveBeenCalledTimes(1));
  });

  it("renders proxy host rows (0/1 ints honoured) and toggles enable/disable", async () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);
    await waitFor(() => expect(mgr.loadProxyHosts).toHaveBeenCalled());
    const rows = screen.getAllByTestId("npm-proxy-host-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("a.example.com, b.example.com");
    expect(rows[0]).toHaveTextContent("http://10.0.0.2:8080");
    const toggles = screen.getAllByTestId("npm-proxy-host-toggle");
    expect(toggles[0]).toHaveTextContent("Disable");
    expect(toggles[1]).toHaveTextContent("Enable");
    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);
    await waitFor(() => expect(mgr.toggleProxyHost).toHaveBeenCalledTimes(2));
    expect(mgr.toggleProxyHost).toHaveBeenNthCalledWith(1, 7, false);
    expect(mgr.toggleProxyHost).toHaveBeenNthCalledWith(2, 8, true);
  });

  it("switches tabs: redirections, streams and certificates", async () => {
    render(<NginxProxyMgrPanel isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("npm-tab-redirections"));
    await waitFor(() => expect(mgr.loadRedirectionHosts).toHaveBeenCalled());
    expect(screen.getByTestId("npm-redirection-row")).toHaveTextContent(
      "301 → https://new.example.com",
    );
    fireEvent.click(screen.getByTestId("npm-redirection-toggle"));
    await waitFor(() =>
      expect(mgr.toggleRedirectionHost).toHaveBeenCalledWith(3, false),
    );

    fireEvent.click(screen.getByTestId("npm-tab-streams"));
    await waitFor(() => expect(mgr.loadStreams).toHaveBeenCalled());
    expect(screen.getByTestId("npm-stream-row")).toHaveTextContent("TCP");
    expect(screen.getByTestId("npm-stream-row")).not.toHaveTextContent("UDP");
    fireEvent.click(screen.getByTestId("npm-stream-toggle"));
    await waitFor(() =>
      expect(mgr.toggleStream).toHaveBeenCalledWith(5, false),
    );

    fireEvent.click(screen.getByTestId("npm-tab-certificates"));
    await waitFor(() => expect(mgr.loadCertificates).toHaveBeenCalled());
    expect(screen.getAllByTestId("npm-certificate-row")).toHaveLength(2);
    // Only Let's Encrypt certs get a Renew button.
    expect(screen.getAllByTestId("npm-certificate-renew")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("npm-certificate-renew"));
    await waitFor(() => expect(mgr.renewCertificate).toHaveBeenCalledWith(11));
  });

  it("Open web UI (auto-login) launches with the saved email/password in password mode", () => {
    store.instancesFor.mockReturnValue([
      {
        id: "inst-1",
        integrationKey: "nginxProxyMgr",
        name: "Lab",
        fields: {
          apiUrl: "http://npm.local:81",
          authMode: "password",
          email: "admin@example.com",
        },
        credentialRefId: "ref",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    store.readNamedSecret.mockResolvedValueOnce("pw");
    render(
      <NginxProxyMgrPanel isOpen onClose={() => {}} instanceId="inst-1" />,
    );
    return waitFor(() => {
      fireEvent.click(screen.getByTestId("npm-open-web-ui"));
      expect(launchNpmWebUi).toHaveBeenLastCalledWith({
        baseUrl: "http://npm.local:81",
        authMode: "password",
        email: "admin@example.com",
        password: "pw",
        skipTlsVerify: false,
        name: "Lab",
      });
    });
  });

  it("Open web UI never passes credentials in token mode", async () => {
    store.instancesFor.mockReturnValue([
      {
        id: "inst-1",
        integrationKey: "nginxProxyMgr",
        name: "Lab",
        fields: { apiUrl: "http://npm.local:81", authMode: "token" },
        credentialRefIds: { authToken: "ref" },
        createdAt: "",
        updatedAt: "",
      },
    ]);
    store.readNamedSecret.mockResolvedValueOnce("jwt");
    render(
      <NginxProxyMgrPanel isOpen onClose={() => {}} instanceId="inst-1" />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("npm-open-web-ui")).toHaveTextContent(
        /^Open web UI$/,
      ),
    );
    fireEvent.click(screen.getByTestId("npm-open-web-ui"));
    expect(launchNpmWebUi).toHaveBeenCalledTimes(1);
    const arg = launchNpmWebUi.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.authMode).toBe("token");
    expect(arg.email).toBeUndefined();
    expect(arg.password).toBeUndefined();
    expect(JSON.stringify(arg)).not.toContain("jwt");
  });
});
