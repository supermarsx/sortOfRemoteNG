/**
 * Hook contract tests for `useNginxProxyMgr` / `npmApi`. The Tauri command
 * surface is mocked so every wrapper's command name + argument shape (camelCase
 * args, snake_case config/request passthrough), the connect/disconnect
 * lifecycle, token refresh / expiry surfacing, and error mapping are verified
 * deterministically without a backend.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const proxyUrlMock = vi.fn<() => string | undefined>(() => undefined);
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  withGlobalHttpProxy: <T extends object>(config: T, style: string) => {
    const url = proxyUrlMock();
    if (!url) return config;
    return { ...config, [style === "camel" ? "proxyUrl" : "proxy_url"]: url };
  },
}));

import {
  npmApi,
  useNginxProxyMgr,
} from "../../src/hooks/integration/useNginxProxyMgr";
import type {
  NpmCertificate,
  NpmConnectionConfig,
  NpmConnectionSummary,
  NpmProxyHost,
  NpmRedirectionHost,
  NpmStream,
} from "../../src/types/nginxProxyMgr";

const summary: NpmConnectionSummary = {
  api_url: "http://npm.local:81",
  user: "admin@example.com",
  roles: ["admin"],
  version: "2.11.3",
  auth_mode: "password",
  token_expires_at: "2026-08-27T10:00:00.000Z",
};

const proxyHosts: NpmProxyHost[] = [
  {
    id: 3,
    domain_names: ["app.example.com"],
    forward_host: "10.0.0.5",
    forward_port: 8080,
    forward_scheme: "http",
    enabled: true,
    ssl_forced: false,
  },
  {
    id: 4,
    domain_names: ["old.example.com"],
    forward_host: "10.0.0.6",
    forward_port: 80,
    forward_scheme: "http",
    enabled: false,
  },
];

const redirectionHosts: NpmRedirectionHost[] = [
  {
    id: 9,
    domain_names: ["www.example.com"],
    forward_http_code: 301,
    forward_domain_name: "example.com",
    forward_scheme: "https",
    enabled: true,
  },
];

const streams: NpmStream[] = [
  {
    id: 12,
    incoming_port: 2222,
    forwarding_host: "10.0.0.7",
    forwarding_port: 22,
    tcp_forwarding: true,
    udp_forwarding: false,
    enabled: true,
  },
];

const certificates: NpmCertificate[] = [
  {
    id: 5,
    provider: "letsencrypt",
    nice_name: "app.example.com",
    domain_names: ["app.example.com"],
    expires_on: "2026-11-01T00:00:00.000Z",
  },
];

const passwordConfig: NpmConnectionConfig = {
  api_url: "http://npm.local:81",
  email: "admin@example.com",
  password: "s3cretpassword!",
  skip_tls_verify: false,
  timeout_secs: 30,
};

const tokenConfig: NpmConnectionConfig = {
  api_url: "https://npm.local:4443",
  token: "eyJhbGciOiJSUzI1NiJ9.bearer-token",
};

/** Route invoke calls by command name; unknown commands resolve undefined. */
function routeInvoke(handlers: Record<string, (args?: unknown) => unknown>) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    const h = handlers[cmd];
    if (!h) return Promise.resolve(undefined);
    try {
      return Promise.resolve(h(args));
    } catch (e) {
      return Promise.reject(e);
    }
  });
}

const happyHandlers = {
  npm_connect: () => summary,
  npm_web_ui_url: () => "http://npm.local:81",
  npm_ping: () => summary,
  npm_refresh_token: () => ({
    ...summary,
    token_expires_at: "2026-08-28T10:00:00.000Z",
  }),
  npm_list_proxy_hosts: () => proxyHosts,
  npm_list_redirection_hosts: () => redirectionHosts,
  npm_list_streams: () => streams,
  npm_list_certificates: () => certificates,
  npm_renew_certificate: () => ({
    ...certificates[0],
    expires_on: "2027-02-01T00:00:00.000Z",
  }),
};

beforeEach(() => {
  invokeMock.mockReset();
  proxyUrlMock.mockReturnValue(undefined);
});

// ─── npmApi wrappers: command names + arg shapes ─────────────────────────────

describe("npmApi", () => {
  beforeEach(() => invokeMock.mockResolvedValue(undefined));

  it("codes to the 57 frozen command names (51 existing + 6 new) with camelCase args", async () => {
    const req = { domain_names: ["x"], forward_host: "h", forward_port: 1 };
    const redirReq = {
      domain_names: ["x"],
      forward_http_code: 301,
      forward_domain_name: "y",
    };
    const deadReq = { domain_names: ["x"] };
    const streamReq = {
      incoming_port: 1,
      forwarding_host: "h",
      forwarding_port: 2,
    };
    const leReq = { domain_names: ["x"] };
    const customCert = {
      nice_name: "n",
      certificate: "c",
      certificate_key: "k",
    };
    const userReq = { name: "n", nickname: "nn", email: "e" };
    const pwReq = { type: "password", secret: "s" };
    const aclReq = { name: "acl" };

    await npmApi.connect("c1", tokenConfig);
    await npmApi.disconnect("c1");
    await npmApi.listConnections();
    await npmApi.ping("c1");
    await npmApi.refreshToken("c1");
    await npmApi.webUiUrl("c1");

    await npmApi.listProxyHosts("c1");
    await npmApi.getProxyHost("c1", 3);
    await npmApi.createProxyHost("c1", req);
    await npmApi.updateProxyHost("c1", 3, req);
    await npmApi.deleteProxyHost("c1", 3);
    await npmApi.enableProxyHost("c1", 3);
    await npmApi.disableProxyHost("c1", 3);

    await npmApi.listRedirectionHosts("c1");
    await npmApi.getRedirectionHost("c1", 9);
    await npmApi.createRedirectionHost("c1", redirReq);
    await npmApi.updateRedirectionHost("c1", 9, redirReq);
    await npmApi.deleteRedirectionHost("c1", 9);
    await npmApi.enableRedirectionHost("c1", 9);
    await npmApi.disableRedirectionHost("c1", 9);

    await npmApi.listDeadHosts("c1");
    await npmApi.getDeadHost("c1", 2);
    await npmApi.createDeadHost("c1", deadReq);
    await npmApi.updateDeadHost("c1", 2, deadReq);
    await npmApi.deleteDeadHost("c1", 2);

    await npmApi.listStreams("c1");
    await npmApi.getStream("c1", 12);
    await npmApi.createStream("c1", streamReq);
    await npmApi.updateStream("c1", 12, streamReq);
    await npmApi.deleteStream("c1", 12);
    await npmApi.enableStream("c1", 12);
    await npmApi.disableStream("c1", 12);

    await npmApi.listCertificates("c1");
    await npmApi.getCertificate("c1", 5);
    await npmApi.createLetsEncryptCertificate("c1", leReq);
    await npmApi.uploadCustomCertificate("c1", customCert);
    await npmApi.deleteCertificate("c1", 5);
    await npmApi.renewCertificate("c1", 5);
    await npmApi.validateCertificate("c1", 5);

    await npmApi.listUsers("c1");
    await npmApi.getUser("c1", 1);
    await npmApi.createUser("c1", userReq);
    await npmApi.updateUser("c1", 1, userReq);
    await npmApi.deleteUser("c1", 1);
    await npmApi.changeUserPassword("c1", 1, pwReq);
    await npmApi.getMe("c1");

    await npmApi.listAccessLists("c1");
    await npmApi.getAccessList("c1", 7);
    await npmApi.createAccessList("c1", aclReq);
    await npmApi.updateAccessList("c1", 7, aclReq);
    await npmApi.deleteAccessList("c1", 7);

    await npmApi.listSettings("c1");
    await npmApi.getSetting("c1", "default-site");
    await npmApi.updateSetting("c1", "default-site", {
      value: "congratulations",
    });
    await npmApi.getReports("c1");
    await npmApi.getAuditLog("c1");
    await npmApi.getHealth("c1");

    expect(invokeMock.mock.calls).toEqual([
      ["npm_connect", { id: "c1", config: tokenConfig }],
      ["npm_disconnect", { id: "c1" }],
      ["npm_list_connections"],
      ["npm_ping", { id: "c1" }],
      ["npm_refresh_token", { id: "c1" }],
      ["npm_web_ui_url", { id: "c1" }],

      ["npm_list_proxy_hosts", { id: "c1" }],
      ["npm_get_proxy_host", { id: "c1", hostId: 3 }],
      ["npm_create_proxy_host", { id: "c1", request: req }],
      ["npm_update_proxy_host", { id: "c1", hostId: 3, request: req }],
      ["npm_delete_proxy_host", { id: "c1", hostId: 3 }],
      ["npm_enable_proxy_host", { id: "c1", hostId: 3 }],
      ["npm_disable_proxy_host", { id: "c1", hostId: 3 }],

      ["npm_list_redirection_hosts", { id: "c1" }],
      ["npm_get_redirection_host", { id: "c1", hostId: 9 }],
      ["npm_create_redirection_host", { id: "c1", request: redirReq }],
      [
        "npm_update_redirection_host",
        { id: "c1", hostId: 9, request: redirReq },
      ],
      ["npm_delete_redirection_host", { id: "c1", hostId: 9 }],
      ["npm_enable_redirection_host", { id: "c1", hostId: 9 }],
      ["npm_disable_redirection_host", { id: "c1", hostId: 9 }],

      ["npm_list_dead_hosts", { id: "c1" }],
      ["npm_get_dead_host", { id: "c1", hostId: 2 }],
      ["npm_create_dead_host", { id: "c1", request: deadReq }],
      ["npm_update_dead_host", { id: "c1", hostId: 2, request: deadReq }],
      ["npm_delete_dead_host", { id: "c1", hostId: 2 }],

      ["npm_list_streams", { id: "c1" }],
      ["npm_get_stream", { id: "c1", streamId: 12 }],
      ["npm_create_stream", { id: "c1", request: streamReq }],
      ["npm_update_stream", { id: "c1", streamId: 12, request: streamReq }],
      ["npm_delete_stream", { id: "c1", streamId: 12 }],
      ["npm_enable_stream", { id: "c1", streamId: 12 }],
      ["npm_disable_stream", { id: "c1", streamId: 12 }],

      ["npm_list_certificates", { id: "c1" }],
      ["npm_get_certificate", { id: "c1", certId: 5 }],
      ["npm_create_letsencrypt_certificate", { id: "c1", request: leReq }],
      ["npm_upload_custom_certificate", { id: "c1", request: customCert }],
      ["npm_delete_certificate", { id: "c1", certId: 5 }],
      ["npm_renew_certificate", { id: "c1", certId: 5 }],
      ["npm_validate_certificate", { id: "c1", certId: 5 }],

      ["npm_list_users", { id: "c1" }],
      ["npm_get_user", { id: "c1", userId: 1 }],
      ["npm_create_user", { id: "c1", request: userReq }],
      ["npm_update_user", { id: "c1", userId: 1, request: userReq }],
      ["npm_delete_user", { id: "c1", userId: 1 }],
      ["npm_change_user_password", { id: "c1", userId: 1, request: pwReq }],
      ["npm_get_me", { id: "c1" }],

      ["npm_list_access_lists", { id: "c1" }],
      ["npm_get_access_list", { id: "c1", listId: 7 }],
      ["npm_create_access_list", { id: "c1", request: aclReq }],
      ["npm_update_access_list", { id: "c1", listId: 7, request: aclReq }],
      ["npm_delete_access_list", { id: "c1", listId: 7 }],

      ["npm_list_settings", { id: "c1" }],
      ["npm_get_setting", { id: "c1", settingId: "default-site" }],
      [
        "npm_update_setting",
        {
          id: "c1",
          settingId: "default-site",
          value: { value: "congratulations" },
        },
      ],
      ["npm_get_reports", { id: "c1" }],
      ["npm_get_audit_log", { id: "c1" }],
      ["npm_get_health", { id: "c1" }],
    ]);
    expect(Object.keys(npmApi)).toHaveLength(57);
    const names = invokeMock.mock.calls.map(([c]) => c as string);
    expect(new Set(names).size).toBe(57);
    expect(names.every((n) => /^npm_[a-z_]+$/.test(n))).toBe(true);
  });

  it("passes the config through in snake_case, untouched", async () => {
    const config: NpmConnectionConfig = {
      api_url: "https://npm.local:4443",
      email: "a@b.c",
      password: "pw",
      skip_tls_verify: true,
      acknowledge_invalid_cert_risk: true,
      timeout_secs: 15,
      proxy_url: "http://proxy:3128",
    };
    await npmApi.connect("c1", config);
    const args = invokeMock.mock.calls[0][1] as {
      config: Record<string, unknown>;
    };
    expect(args.config).toEqual(config);
    // No camelCase leakage: the crate has no `rename_all`.
    for (const k of ["apiUrl", "skipTlsVerify", "timeoutSecs", "proxyUrl"]) {
      expect(args.config).not.toHaveProperty(k);
    }
  });
});

// ─── useNginxProxyMgr lifecycle ──────────────────────────────────────────────

describe("useNginxProxyMgr connect", () => {
  it("connects with email + password and fetches the web UI URL", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());
    expect(result.current.status).toBe("disconnected");

    let ok = false;
    await act(async () => {
      ok = await result.current.connect("c1", passwordConfig);
    });

    expect(ok).toBe(true);
    expect(result.current.status).toBe("connected");
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionId).toBe("c1");
    expect(result.current.summary).toEqual(summary);
    expect(result.current.summary?.auth_mode).toBe("password");
    expect(result.current.webUiUrl).toBe("http://npm.local:81");
    expect(result.current.error).toBeNull();

    const [cmd, args] = invokeMock.mock.calls[0] as [
      string,
      { id: string; config: NpmConnectionConfig },
    ];
    expect(cmd).toBe("npm_connect");
    expect(args.id).toBe("c1");
    expect(args.config).toMatchObject({
      api_url: passwordConfig.api_url,
      email: "admin@example.com",
      password: "s3cretpassword!",
      acknowledge_invalid_cert_risk: false,
    });
    expect(args.config.token).toBeUndefined();
    expect(args.config).not.toHaveProperty("proxy_url");
    expect(invokeMock.mock.calls[1][0]).toBe("npm_web_ui_url");
  });

  it("connects with a pre-existing bearer token (no email/password on the wire)", async () => {
    routeInvoke({
      ...happyHandlers,
      npm_connect: () => ({ ...summary, auth_mode: "token", user: null }),
    });
    const { result } = renderHook(() => useNginxProxyMgr());

    await act(async () => {
      await result.current.connect("c2", tokenConfig);
    });

    expect(result.current.summary?.auth_mode).toBe("token");
    const args = invokeMock.mock.calls[0][1] as { config: NpmConnectionConfig };
    expect(args.config.token).toBe(tokenConfig.token);
    expect(args.config.email).toBeUndefined();
    expect(args.config.password).toBeUndefined();
  });

  it("forwards the one-shot insecure-TLS acknowledgement on the first attempt", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());

    await act(async () => {
      await result.current.connect("c1", {
        ...tokenConfig,
        skip_tls_verify: true,
        acknowledge_invalid_cert_risk: true,
      });
    });
    const first = invokeMock.mock.calls[0][1] as {
      config: NpmConnectionConfig;
    };
    expect(first.config.skip_tls_verify).toBe(true);
    expect(first.config.acknowledge_invalid_cert_risk).toBe(true);
  });

  it("drops the acknowledgement when it was not given", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await result.current.connect("c1", {
        ...tokenConfig,
        skip_tls_verify: true,
      });
    });
    const first = invokeMock.mock.calls[0][1] as {
      config: NpmConnectionConfig;
    };
    expect(first.config.acknowledge_invalid_cert_risk).toBe(false);
  });

  it("injects the global HTTP proxy in snake_case", async () => {
    proxyUrlMock.mockReturnValue("http://proxy.local:3128");
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());

    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    const args = invokeMock.mock.calls[0][1] as { config: NpmConnectionConfig };
    expect(args.config.proxy_url).toBe("http://proxy.local:3128");
    expect(args.config).not.toHaveProperty("proxyUrl");
  });

  it("still reports connected when the web UI URL lookup fails", async () => {
    routeInvoke({
      ...happyHandlers,
      npm_web_ui_url: () => {
        throw "internal_error: boom";
      },
    });
    const { result } = renderHook(() => useNginxProxyMgr());

    let ok = false;
    await act(async () => {
      ok = await result.current.connect("c1", passwordConfig);
    });
    expect(ok).toBe(true);
    expect(result.current.status).toBe("connected");
    expect(result.current.webUiUrl).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

// ─── Token refresh / expiry / re-login ───────────────────────────────────────

describe("useNginxProxyMgr token lifecycle", () => {
  async function connected() {
    routeInvoke(happyHandlers);
    const hook = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await hook.result.current.connect("c1", passwordConfig);
    });
    invokeMock.mockClear();
    return hook;
  }

  it("refreshToken calls npm_refresh_token and updates the expiry in the summary", async () => {
    const { result } = await connected();
    await act(async () => {
      await result.current.refreshToken();
    });
    expect(invokeMock).toHaveBeenCalledWith("npm_refresh_token", { id: "c1" });
    expect(result.current.summary?.token_expires_at).toBe(
      "2026-08-28T10:00:00.000Z",
    );
    expect(result.current.status).toBe("connected");
    expect(result.current.busy).toBe(false);
  });

  it("surfaces a token_expired error (backend re-login also failed) without dropping the session", async () => {
    const { result } = await connected();
    routeInvoke({
      ...happyHandlers,
      npm_list_proxy_hosts: () => {
        throw {
          kind: "token_expired",
          message: "Authentication token has expired",
        };
      },
    });

    await act(async () => {
      await expect(result.current.loadProxyHosts()).rejects.toMatchObject({
        kind: "token_expired",
      });
    });
    expect(result.current.error).toBe(
      "token_expired: Authentication token has expired",
    );
    expect(result.current.proxyHosts).toEqual([]);
    // The connection id is retained so the panel can offer a reconnect.
    expect(result.current.connectionId).toBe("c1");
    expect(result.current.status).toBe("connected");
    expect(result.current.busy).toBe(false);
  });

  it("the 401 re-login path is transparent: a list call after a backend re-login is a single invoke", async () => {
    // The backend re-logs-in on 401 and retries internally; the hook must
    // never issue a second npm_connect on its own.
    const { result } = await connected();
    let calls = 0;
    routeInvoke({
      ...happyHandlers,
      npm_list_proxy_hosts: () => {
        calls += 1;
        return proxyHosts;
      },
    });
    await act(async () => {
      await result.current.loadProxyHosts();
    });
    expect(calls).toBe(1);
    expect(
      invokeMock.mock.calls.filter(([c]) => c === "npm_connect"),
    ).toHaveLength(0);
    expect(result.current.proxyHosts).toEqual(proxyHosts);
  });

  it("re-connecting after token expiry issues a fresh npm_connect", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    await act(async () => {
      await result.current.disconnect();
    });
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    const connectCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "npm_connect",
    );
    expect(connectCalls).toHaveLength(2);
    expect(result.current.status).toBe("connected");
  });

  it("refreshSummary re-pings and updates the summary", async () => {
    const { result } = await connected();
    routeInvoke({
      ...happyHandlers,
      npm_ping: () => ({ ...summary, version: "2.12.0" }),
    });
    await act(async () => {
      await result.current.refreshSummary();
    });
    expect(result.current.summary?.version).toBe("2.12.0");
    expect(invokeMock).toHaveBeenLastCalledWith("npm_ping", { id: "c1" });
  });
});

// ─── Error mapping ───────────────────────────────────────────────────────────

describe("useNginxProxyMgr error mapping", () => {
  it("surfaces a string backend error and returns false", async () => {
    routeInvoke({
      npm_connect: () => {
        throw "authentication_failed: Invalid credentials";
      },
    });
    const { result } = renderHook(() => useNginxProxyMgr());

    let ok = true;
    await act(async () => {
      ok = await result.current.connect("c1", passwordConfig);
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe("error");
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionId).toBeNull();
    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBe(
      "authentication_failed: Invalid credentials",
    );
    // Only one connect attempt — no implicit retry on the frontend side.
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["config_error", "Provide email+password or a bearer token"],
    [
      "tls_untrusted",
      "Certificate not trusted; trust it in Trust Center or accept self-signed",
    ],
    ["connection_failed", "connection refused"],
    ["permission_denied", "forbidden"],
  ])(
    "formats structured %s errors as 'kind: message'",
    async (kind, message) => {
      routeInvoke({
        npm_connect: () => {
          throw { kind, message };
        },
      });
      const { result } = renderHook(() => useNginxProxyMgr());
      await act(async () => {
        await result.current.connect("c1", passwordConfig);
      });
      expect(result.current.error).toBe(`${kind}: ${message}`);
      expect(result.current.status).toBe("error");
    },
  );

  it("data ops throw not_connected before any invoke when disconnected", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());
    await expect(result.current.loadProxyHosts()).rejects.toThrow(
      /not_connected/,
    );
    await expect(result.current.refreshToken()).rejects.toThrow(
      /not_connected/,
    );
    await expect(result.current.refreshAll()).rejects.toThrow(/not_connected/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("clearError resets the error", async () => {
    routeInvoke({
      npm_connect: () => {
        throw "connection_failed: refused";
      },
    });
    const { result } = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("run() surfaces op errors and resets busy", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await expect(
        result.current.run(() => Promise.reject("permission_denied: nope")),
      ).rejects.toBe("permission_denied: nope");
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.error).toBe("permission_denied: nope");
  });
});

// ─── Data ops ────────────────────────────────────────────────────────────────

describe("useNginxProxyMgr data ops", () => {
  async function connected() {
    routeInvoke(happyHandlers);
    const hook = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await hook.result.current.connect("c1", passwordConfig);
    });
    invokeMock.mockClear();
    return hook;
  }

  it("loads proxy hosts, redirections, streams and certificates into state", async () => {
    const { result } = await connected();

    await act(async () => {
      await result.current.loadProxyHosts();
    });
    expect(result.current.proxyHosts).toEqual(proxyHosts);
    expect(invokeMock).toHaveBeenLastCalledWith("npm_list_proxy_hosts", {
      id: "c1",
    });

    await act(async () => {
      await result.current.loadRedirectionHosts();
    });
    expect(result.current.redirectionHosts).toEqual(redirectionHosts);
    expect(invokeMock).toHaveBeenLastCalledWith("npm_list_redirection_hosts", {
      id: "c1",
    });

    await act(async () => {
      await result.current.loadStreams();
    });
    expect(result.current.streams).toEqual(streams);
    expect(invokeMock).toHaveBeenLastCalledWith("npm_list_streams", {
      id: "c1",
    });

    await act(async () => {
      await result.current.loadCertificates();
    });
    expect(result.current.certificates).toEqual(certificates);
    expect(invokeMock).toHaveBeenLastCalledWith("npm_list_certificates", {
      id: "c1",
    });
    expect(result.current.busy).toBe(false);
  });

  it("refreshAll fetches all four collections in one busy window", async () => {
    const { result } = await connected();
    await act(async () => {
      await result.current.refreshAll();
    });
    expect(invokeMock.mock.calls.map(([c]) => c)).toEqual([
      "npm_list_proxy_hosts",
      "npm_list_redirection_hosts",
      "npm_list_streams",
      "npm_list_certificates",
    ]);
    expect(result.current.proxyHosts).toEqual(proxyHosts);
    expect(result.current.redirectionHosts).toEqual(redirectionHosts);
    expect(result.current.streams).toEqual(streams);
    expect(result.current.certificates).toEqual(certificates);
    expect(result.current.busy).toBe(false);
  });

  it("toggleProxyHost enables / disables and patches the cached row", async () => {
    const { result } = await connected();
    await act(async () => {
      await result.current.loadProxyHosts();
    });
    invokeMock.mockClear();

    await act(async () => {
      await result.current.toggleProxyHost(3, false);
      await result.current.toggleProxyHost(4, true);
    });
    expect(invokeMock.mock.calls).toEqual([
      ["npm_disable_proxy_host", { id: "c1", hostId: 3 }],
      ["npm_enable_proxy_host", { id: "c1", hostId: 4 }],
    ]);
    expect(result.current.proxyHosts.find((h) => h.id === 3)?.enabled).toBe(
      false,
    );
    expect(result.current.proxyHosts.find((h) => h.id === 4)?.enabled).toBe(
      true,
    );
  });

  it("toggleRedirectionHost / toggleStream use the 4 new enable/disable commands", async () => {
    const { result } = await connected();
    await act(async () => {
      await result.current.loadRedirectionHosts();
      await result.current.loadStreams();
    });
    invokeMock.mockClear();

    await act(async () => {
      await result.current.toggleRedirectionHost(9, false);
      await result.current.toggleRedirectionHost(9, true);
      await result.current.toggleStream(12, false);
      await result.current.toggleStream(12, true);
    });
    expect(invokeMock.mock.calls).toEqual([
      ["npm_disable_redirection_host", { id: "c1", hostId: 9 }],
      ["npm_enable_redirection_host", { id: "c1", hostId: 9 }],
      ["npm_disable_stream", { id: "c1", streamId: 12 }],
      ["npm_enable_stream", { id: "c1", streamId: 12 }],
    ]);
    expect(result.current.redirectionHosts[0].enabled).toBe(true);
    expect(result.current.streams[0].enabled).toBe(true);
  });

  it("a failed toggle leaves the cached row untouched and surfaces the error", async () => {
    const { result } = await connected();
    await act(async () => {
      await result.current.loadProxyHosts();
    });
    routeInvoke({
      ...happyHandlers,
      npm_disable_proxy_host: () => {
        throw "proxy_host_not_found: Proxy host not found: 3";
      },
    });
    await act(async () => {
      await expect(result.current.toggleProxyHost(3, false)).rejects.toBe(
        "proxy_host_not_found: Proxy host not found: 3",
      );
    });
    expect(result.current.proxyHosts.find((h) => h.id === 3)?.enabled).toBe(
      true,
    );
    expect(result.current.error).toBe(
      "proxy_host_not_found: Proxy host not found: 3",
    );
  });

  it("renewCertificate calls npm_renew_certificate and patches the cached cert", async () => {
    const { result } = await connected();
    await act(async () => {
      await result.current.loadCertificates();
    });
    invokeMock.mockClear();

    await act(async () => {
      await result.current.renewCertificate(5);
    });
    expect(invokeMock).toHaveBeenLastCalledWith("npm_renew_certificate", {
      id: "c1",
      certId: 5,
    });
    expect(result.current.certificates[0].expires_on).toBe(
      "2027-02-01T00:00:00.000Z",
    );
  });
});

// ─── Disconnect ──────────────────────────────────────────────────────────────

describe("useNginxProxyMgr disconnect", () => {
  it("disconnects and clears all cached state", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    await act(async () => {
      await result.current.refreshAll();
    });
    expect(result.current.proxyHosts).toHaveLength(2);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(invokeMock).toHaveBeenLastCalledWith("npm_disconnect", { id: "c1" });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionId).toBeNull();
    expect(result.current.summary).toBeNull();
    expect(result.current.proxyHosts).toEqual([]);
    expect(result.current.redirectionHosts).toEqual([]);
    expect(result.current.streams).toEqual([]);
    expect(result.current.certificates).toEqual([]);
    expect(result.current.webUiUrl).toBeNull();
  });

  it("is a no-op when not connected", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await result.current.disconnect();
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("clears local state even when the backend disconnect fails", async () => {
    routeInvoke({
      ...happyHandlers,
      npm_disconnect: () => {
        throw "not_connected: gone";
      },
    });
    const { result } = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.connectionId).toBeNull();
    expect(result.current.error).toBe("not_connected: gone");
  });
});

// ─── Secrets ─────────────────────────────────────────────────────────────────

describe("secrets never leak into fields-shaped output", () => {
  it("summary and cached state carry no password / token", async () => {
    routeInvoke(happyHandlers);
    const { result } = renderHook(() => useNginxProxyMgr());
    await act(async () => {
      await result.current.connect("c1", passwordConfig);
    });
    await act(async () => {
      await result.current.refreshAll();
    });
    const serialized = JSON.stringify({
      summary: result.current.summary,
      proxyHosts: result.current.proxyHosts,
      redirectionHosts: result.current.redirectionHosts,
      streams: result.current.streams,
      certificates: result.current.certificates,
      webUiUrl: result.current.webUiUrl,
      connectionId: result.current.connectionId,
    });
    expect(serialized).not.toContain("s3cretpassword!");
    expect(serialized).not.toContain("bearer-token");
    expect(result.current.summary).not.toHaveProperty("password");
    expect(result.current.summary).not.toHaveProperty("token");
  });
});
