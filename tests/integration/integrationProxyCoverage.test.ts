import fs from "node:fs";
import path from "node:path";
import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { gdriveApi } from "../../src/hooks/integration/useGdrive";
import { useGrafana } from "../../src/hooks/integration/useGrafana";
import { useLxdConnection } from "../../src/hooks/integration/lxd/useLxdConnection";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import type { ProxyConfig } from "../../src/types/settings/settings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function compact(source: string): string {
  return source.replace(/\s+/g, " ");
}

function setProxy(overrides: Partial<ProxyConfig> = {}) {
  SettingsManager.getInstance().applyInMemory({
    globalProxy: {
      type: "http",
      host: "proxy.local",
      port: 8080,
      enabled: true,
      ...overrides,
    },
  });
}

const FRONTEND_PROXY_CASES = [
  {
    name: "Budibase",
    hookFile: "src/hooks/integration/useBudibase.ts",
    typeFile: "src/types/budibase.ts",
    helperCall: 'withGlobalHttpProxy(config, "camel")',
    typeField: "proxyUrl?:",
  },
  {
    name: "Caddy",
    hookFile: "src/hooks/integration/useCaddy.ts",
    typeFile: "src/types/caddy.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "cPanel",
    hookFile: "src/hooks/integration/cpanel/useCpanelConnection.ts",
    typeFile: "src/types/cpanel/index.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "Exchange",
    hookFile: "src/hooks/integration/exchange/useExchangeConnection.ts",
    typeFile: "src/types/exchange/index.ts",
    helperCall: 'withGlobalHttpProxy(config, "camel")',
    typeField: "proxyUrl?:",
  },
  {
    name: "GDrive",
    hookFile: "src/hooks/integration/useGdrive.ts",
    helperCall: "withGlobalHttpProxyArgs({",
  },
  {
    name: "Grafana",
    hookFile: "src/hooks/integration/useGrafana.ts",
    typeFile: "src/types/grafana.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "HAProxy",
    hookFile: "src/hooks/integration/useHaproxy.ts",
    typeFile: "src/types/haproxy.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "Jira",
    hookFile: "src/hooks/integration/jira/useJiraConnection.ts",
    typeFile: "src/types/jira/index.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "LXD",
    hookFile: "src/hooks/integration/lxd/useLxdConnection.ts",
    typeFile: "src/types/lxd/index.ts",
    helperCall: 'withGlobalHttpProxy(config, "camel")',
    typeField: "proxyUrl?:",
  },
  {
    name: "Mailcow",
    hookFile: "src/hooks/integration/mailcow/useMailcowConnection.ts",
    typeFile: "src/types/mailcow/index.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "NetBox",
    hookFile: "src/hooks/integration/netbox/useNetboxConnection.ts",
    typeFile: "src/types/netbox/index.ts",
    helperCall: 'withGlobalHttpProxy(config, "camel")',
    typeField: "proxyUrl?:",
  },
  {
    name: "Nginx",
    hookFile: "src/hooks/integration/useNginx.ts",
    typeFile: "src/types/nginx.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "osTicket",
    hookFile: "src/hooks/integration/osticket/useOsticketConnection.ts",
    typeFile: "src/types/osticket/index.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "pfSense",
    hookFile: "src/components/integrations/pfsense/PfsensePanel.tsx",
    typeFile: "src/types/pfsense/index.ts",
    helperCall: 'withGlobalHttpProxy(config, "camel")',
    typeField: "proxyUrl?:",
  },
  {
    name: "Prometheus",
    hookFile: "src/hooks/integration/usePrometheus.ts",
    typeFile: "src/types/prometheus.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "Traefik",
    hookFile: "src/hooks/integration/useTraefik.ts",
    typeFile: "src/types/traefik.ts",
    helperCall: "withGlobalHttpProxy(config)",
    typeField: "proxy_url?:",
  },
  {
    name: "VMware vSphere",
    hookFile: "src/hooks/integration/useVmware.ts",
    typeFile: "src/types/vmware.ts",
    helperCall: "withGlobalHttpProxyArgs(args)",
    typeField: "proxyUrl?:",
  },
  {
    name: "VMware Desktop",
    hookFile: "src/hooks/integration/vmwareDesktop/useVmwDesktopConnection.ts",
    typeFile: "src/types/vmwareDesktop/index.ts",
    helperCall: "withGlobalHttpProxyArgs(args)",
    typeField: "proxyUrl?:",
  },
] as const;

const RUST_PROXY_CASES = [
  {
    name: "Budibase",
    typeFile: "src-tauri/crates/sorng-budibase/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-budibase/src/client.rs"],
    wire: "camel",
  },
  {
    name: "Caddy",
    typeFile: "src-tauri/crates/sorng-caddy/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-caddy/src/client.rs"],
    wire: "snake",
  },
  {
    name: "cPanel",
    typeFile: "src-tauri/crates/sorng-cpanel/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-cpanel/src/client.rs"],
    wire: "snake",
  },
  {
    name: "Exchange",
    typeFile: "src-tauri/crates/sorng-exchange/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-exchange/src/client.rs"],
    wire: "camel",
  },
  {
    name: "GDrive",
    typeFile: "src-tauri/crates/sorng-gdrive/src/types.rs",
    proxyFiles: [
      "src-tauri/crates/sorng-gdrive/src/commands.rs",
      "src-tauri/crates/sorng-gdrive/src/service.rs",
      "src-tauri/crates/sorng-gdrive/src/client.rs",
    ],
    wire: "commandArg",
  },
  {
    name: "Grafana",
    typeFile: "src-tauri/crates/sorng-grafana/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-grafana/src/client.rs"],
    wire: "snake",
  },
  {
    name: "HAProxy",
    typeFile: "src-tauri/crates/sorng-haproxy/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-haproxy/src/client.rs"],
    wire: "snake",
  },
  {
    name: "Jira",
    typeFile: "src-tauri/crates/sorng-jira/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-jira/src/client.rs"],
    wire: "snake",
  },
  {
    name: "LXD",
    typeFile: "src-tauri/crates/sorng-lxd/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-lxd/src/client.rs"],
    wire: "camel",
  },
  {
    name: "Mailcow",
    typeFile: "src-tauri/crates/sorng-mailcow/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-mailcow/src/client.rs"],
    wire: "snake",
  },
  {
    name: "NetBox",
    typeFile: "src-tauri/crates/sorng-netbox/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-netbox/src/client.rs"],
    wire: "alias",
  },
  {
    name: "Nginx",
    typeFile: "src-tauri/crates/sorng-nginx/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-nginx/src/client.rs"],
    wire: "snake",
  },
  {
    name: "osTicket",
    typeFile: "src-tauri/crates/sorng-osticket/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-osticket/src/client.rs"],
    wire: "snake",
  },
  {
    name: "pfSense",
    typeFile: "src-tauri/crates/sorng-pfsense/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-pfsense/src/client.rs"],
    wire: "alias",
  },
  {
    name: "Prometheus",
    typeFile: "src-tauri/crates/sorng-prometheus/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-prometheus/src/client.rs"],
    wire: "snake",
  },
  {
    name: "Traefik",
    typeFile: "src-tauri/crates/sorng-traefik/src/types.rs",
    proxyFiles: ["src-tauri/crates/sorng-traefik/src/client.rs"],
    wire: "snake",
  },
  {
    name: "VMware vSphere",
    typeFile: "src-tauri/crates/sorng-vmware/src/types.rs",
    proxyFiles: [
      "src-tauri/crates/sorng-vmware/src/commands.rs",
      "src-tauri/crates/sorng-vmware/src/vsphere.rs",
    ],
    wire: "commandArg",
  },
  {
    name: "VMware Desktop",
    typeFile: "src-tauri/crates/sorng-vmware-desktop/src/types.rs",
    proxyFiles: [
      "src-tauri/crates/sorng-vmware-desktop/src/commands.rs",
      "src-tauri/crates/sorng-vmware-desktop/src/service.rs",
      "src-tauri/crates/sorng-vmware-desktop/src/vmrest.rs",
    ],
    wire: "commandArg",
  },
] as const;

describe("integration HTTP proxy coverage contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SettingsManager.resetInstance();
    _resetInMemorySettingsStore();
  });

  it.each(FRONTEND_PROXY_CASES)(
    "$name wires the global proxy helper into its connection flow and public config type",
    (testCase) => {
      const { hookFile, helperCall } = testCase;
      const hookSource = compact(readWorkspaceFile(hookFile));
      const helperName = helperCall.startsWith("withGlobalHttpProxyArgs")
        ? "withGlobalHttpProxyArgs"
        : "withGlobalHttpProxy";

      expect(hookSource).toContain(helperName);
      expect(hookSource).toContain(compact(helperCall));

      if ("typeFile" in testCase && "typeField" in testCase) {
        expect(readWorkspaceFile(testCase.typeFile)).toContain(
          testCase.typeField,
        );
      }
    },
  );

  it.each(RUST_PROXY_CASES)(
    "$name accepts proxy data at the Tauri boundary and applies reqwest::Proxy",
    ({ typeFile, proxyFiles, wire }) => {
      const typeSource = readWorkspaceFile(typeFile);
      const proxySource = proxyFiles.map(readWorkspaceFile).join("\n");

      expect(typeSource).toContain("proxy_url");
      expect(proxySource).toContain("proxy_url");
      expect(proxySource).toContain("reqwest::Proxy::all");
      expect(proxySource).toMatch(/builder\s*=\s*builder\.proxy\(proxy\)/);

      if (wire === "camel") {
        expect(typeSource).toContain('rename_all = "camelCase"');
      }
      if (wire === "alias") {
        expect(typeSource).toContain('alias = "proxyUrl"');
      }
      if (wire === "commandArg") {
        expect(proxySource).toMatch(/proxy_url:\s*Option<\s*String\s*>/);
      }
    },
  );

  it("injects proxyUrl into global-session API wrappers that use flat Tauri args", async () => {
    setProxy({ username: "proxy-user", password: "p@ss word" });
    invokeMock.mockResolvedValue(undefined as never);

    await gdriveApi.setCredentials(
      "client-id",
      "client-secret",
      "http://localhost/callback",
      ["https://www.googleapis.com/auth/drive.metadata.readonly"],
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "gdrive_set_credentials",
      expect.objectContaining({
        clientId: "client-id",
        proxyUrl: "http://proxy-user:p%40ss%20word@proxy.local:8080",
      }),
    );
  });

  it("injects snake_case proxy_url for config structs that keep Rust field names on the wire", async () => {
    setProxy();
    invokeMock.mockResolvedValue({
      connected: true,
      host: "grafana.example.test",
    } as never);
    const { result } = renderHook(() => useGrafana());

    await act(async () => {
      await result.current.connect("grafana-main", {
        host: "grafana.example.test",
        port: 3000,
        use_tls: true,
        api_key: "secret",
      } as any);
    });

    expect(invokeMock).toHaveBeenCalledWith("grafana_connect", {
      id: "grafana-main",
      config: expect.objectContaining({
        host: "grafana.example.test",
        proxy_url: "http://proxy.local:8080",
      }),
    });
  });

  it("injects camelCase proxyUrl for config structs that use camelCase serde wire names", async () => {
    setProxy();
    invokeMock.mockResolvedValue({
      connected: true,
      serverUrl: "https://lxd.example.test:8443",
      project: "default",
    } as never);
    const { result } = renderHook(() => useLxdConnection());

    await act(async () => {
      await result.current.connect({
        url: "https://lxd.example.test:8443",
        skipTlsVerify: true,
        project: "default",
        timeoutSecs: 30,
      });
    });

    expect(invokeMock).toHaveBeenCalledWith("lxd_connect", {
      config: expect.objectContaining({
        url: "https://lxd.example.test:8443",
        proxyUrl: "http://proxy.local:8080",
      }),
    });
  });
});
