import { describe, expect, it, beforeEach } from "vitest";

import {
  getGlobalHttpProxyUrl,
  withGlobalHttpProxy,
  withGlobalHttpProxyArgs,
} from "../../src/hooks/integration/httpProxy";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import type { ProxyConfig } from "../../src/types/settings/settings";

function setProxy(overrides: Partial<ProxyConfig>) {
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

describe("integration HTTP proxy helper", () => {
  beforeEach(() => {
    SettingsManager.resetInstance();
    _resetInMemorySettingsStore();
  });

  it("does not add a proxy when the global proxy is disabled", () => {
    setProxy({ enabled: false });

    expect(getGlobalHttpProxyUrl()).toBeUndefined();
    expect(withGlobalHttpProxy({ host: "grafana" })).toEqual({
      host: "grafana",
    });
  });

  it("adds snake_case proxy_url for plain serde config structs", () => {
    setProxy({ username: "user name", password: "pa:ss" });

    expect(withGlobalHttpProxy({ host: "grafana" })).toEqual({
      host: "grafana",
      proxy_url: "http://user%20name:pa%3Ass@proxy.local:8080",
    });
  });

  it("adds camelCase proxyUrl for camelCase config structs and flat args", () => {
    setProxy({ type: "http-connect", host: "2001:db8::12", port: 3128 });

    expect(withGlobalHttpProxy({ host: "lxd" }, "camel")).toEqual({
      host: "lxd",
      proxyUrl: "http://[2001:db8::12]:3128",
    });
    expect(withGlobalHttpProxyArgs({ host: "vcenter" })).toEqual({
      host: "vcenter",
      proxyUrl: "http://[2001:db8::12]:3128",
    });
  });

  it("ignores proxy tunnel types that reqwest is not configured to use", () => {
    setProxy({ type: "socks5" });

    expect(getGlobalHttpProxyUrl()).toBeUndefined();
  });
});
