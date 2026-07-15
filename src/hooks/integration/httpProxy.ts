import type { ProxyConfig } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";

type ProxyWireStyle = "camel" | "snake";

function proxyScheme(proxy: ProxyConfig): "http" | "https" | null {
  switch (proxy.type) {
    case "http":
    case "http-connect":
      return "http";
    case "https":
      return "https";
    default:
      return null;
  }
}

function formatProxyHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.includes(":") && !trimmed.startsWith("[")) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

export function getGlobalHttpProxyUrl(): string | undefined {
  const proxy = SettingsManager.getInstance().getSettings().globalProxy;
  if (!proxy?.enabled) return undefined;

  const scheme = proxyScheme(proxy);
  const host = proxy.host?.trim();
  const port = Number(proxy.port);
  if (!scheme || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }

  const username = proxy.username?.trim();
  const password = proxy.password ?? "";
  const auth = username
    ? `${encodeURIComponent(username)}${
        password ? `:${encodeURIComponent(password)}` : ""
      }@`
    : "";

  return `${scheme}://${auth}${formatProxyHost(host)}:${port}`;
}

export function withGlobalHttpProxy<T extends object>(
  config: T,
  style: ProxyWireStyle = "snake",
): T & { proxy_url?: string; proxyUrl?: string } {
  const proxyUrl = getGlobalHttpProxyUrl();
  if (!proxyUrl) return config;

  const key = style === "camel" ? "proxyUrl" : "proxy_url";
  return { ...config, [key]: proxyUrl };
}

export function withGlobalHttpProxyArgs<T extends object>(
  args: T,
): T & { proxyUrl?: string } {
  const proxyUrl = getGlobalHttpProxyUrl();
  return proxyUrl ? { ...args, proxyUrl } : args;
}
