import { invoke } from "@tauri-apps/api/core";

export interface PfsenseApiProxyResponse {
  local_port: number;
  session_id: string;
  proxy_url: string;
}

export interface StartPfsenseApiProxyInput {
  host: string;
  port: number;
  useTls: boolean;
  acceptInvalidCerts: boolean;
  apiKey: string;
  apiSecret: string;
  connectionId: string;
  upstreamProxyUrl?: string;
}

const PROTECTED_PROXY_HOST_RE = /^p[0-9a-f]{32}\.localhost$/u;

function formatUrlHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.includes(":") && !trimmed.startsWith("[")) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

export function buildPfsenseApiTargetUrl(
  input: Pick<StartPfsenseApiProxyInput, "host" | "port" | "useTls">,
): string {
  const host = input.host.trim();
  if (!host) throw new Error("pfSense host is required");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("pfSense API port must be between 1 and 65535");
  }
  const scheme = input.useTls ? "https" : "http";
  const url = new URL(`${scheme}://${formatUrlHost(host)}:${input.port}/`);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "pfSense host must not contain credentials, a path, query, or fragment",
    );
  }
  return url.toString();
}

/**
 * Accept only the capability-protected loopback URL returned by the native
 * mediator. The random host token is also enforced by the proxy's Host check,
 * so another local process cannot use a bare 127.0.0.1 URL to reach it.
 */
export function validatePfsenseApiProxyResponse(
  response: PfsenseApiProxyResponse,
): string {
  if (
    !Number.isInteger(response.local_port) ||
    response.local_port < 1 ||
    response.local_port > 65535 ||
    !response.session_id
  ) {
    throw new Error("Backend returned an invalid pfSense proxy session");
  }

  let proxyUrl: URL;
  try {
    proxyUrl = new URL(response.proxy_url);
  } catch {
    throw new Error("Backend returned an invalid pfSense proxy URL");
  }
  if (
    proxyUrl.protocol !== "http:" ||
    proxyUrl.username ||
    proxyUrl.password ||
    !PROTECTED_PROXY_HOST_RE.test(proxyUrl.hostname) ||
    proxyUrl.port !== String(response.local_port) ||
    proxyUrl.pathname !== "/" ||
    proxyUrl.search ||
    proxyUrl.hash
  ) {
    throw new Error("Backend returned an unsafe pfSense proxy URL");
  }
  return proxyUrl.toString();
}

export async function stopPfsenseApiProxy(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await invoke<void>("stop_basic_auth_proxy", { sessionId });
}

/** Start the only allowed transport for pfSense API traffic. */
export async function startPfsenseApiProxy(
  input: StartPfsenseApiProxyInput,
): Promise<PfsenseApiProxyResponse & { protectedProxyUrl: string }> {
  const response = await invoke<PfsenseApiProxyResponse>(
    "start_basic_auth_proxy",
    {
      config: {
        target_url: buildPfsenseApiTargetUrl(input),
        username: input.apiKey,
        password: input.apiSecret,
        upstream_auth_mode: "pfSenseV1",
        upstream_proxy_url: input.upstreamProxyUrl,
        local_port: 0,
        verify_ssl: !input.acceptInvalidCerts,
        accepted_cert_fingerprint: null,
        connection_id: input.connectionId,
        http_auto_login: false,
      },
    },
  );

  try {
    return {
      ...response,
      protectedProxyUrl: validatePfsenseApiProxyResponse(response),
    };
  } catch (error) {
    await stopPfsenseApiProxy(response.session_id).catch(() => undefined);
    throw error;
  }
}
