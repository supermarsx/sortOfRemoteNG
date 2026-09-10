import type { Connection } from "../../types/connection/connection";
import {
  DEFAULT_HTTP_PROXY_POLICY,
  type HttpProxyPolicy,
} from "../../types/connection/httpProxyPolicy";
import { generateId } from "../core/id";

export interface HttpRedirectReview {
  receiptId: string;
  sessionId: string;
  sourceOrigin: string;
  destinationUrl: string;
  navigationToken: string | null;
  documentSequence: number;
  removedQuery: boolean;
}
export function parseHttpRedirectReview(
  value: unknown,
  sessionId: string,
  sourceOrigin: string,
  policy?: HttpProxyPolicy,
): HttpRedirectReview | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HttpRedirectReview>;
  if (
    candidate.sessionId !== sessionId ||
    candidate.sourceOrigin !== sourceOrigin ||
    typeof candidate.receiptId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(candidate.receiptId) ||
    typeof candidate.destinationUrl !== "string" ||
    candidate.destinationUrl.length > 4096 ||
    !Number.isSafeInteger(candidate.documentSequence) ||
    Number(candidate.documentSequence) < 1 ||
    typeof candidate.removedQuery !== "boolean" ||
    (candidate.navigationToken !== null &&
      (typeof candidate.navigationToken !== "string" ||
        !/^[a-f0-9]{32}$/.test(candidate.navigationToken)))
  )
    return null;
  try {
    const destination = new URL(candidate.destinationUrl);
    if (
      !["http:", "https:"].includes(destination.protocol) ||
      (destination.protocol === "http:" &&
        (policy?.httpsOnly === true ||
          (new URL(sourceOrigin).protocol === "https:" &&
            !(
              policy?.allowCrossOriginRedirects === true &&
              policy.allowHttpDowngradeRedirects === true
            )))) ||
      destination.origin === sourceOrigin ||
      destination.port === "0" ||
      destination.username ||
      destination.password ||
      destination.search ||
      destination.hash ||
      destination.toString() !== candidate.destinationUrl
    )
      return null;
  } catch {
    return null;
  }
  return candidate as HttpRedirectReview;
}

/** Deliberate whitelist: source website auth, cookies, policy query, headers,
 * scripts, MFA, favorites, hooks and parent credential inheritance are absent. */
export function anonymousRedirectConnection(
  source: Connection,
  review: HttpRedirectReview,
): Connection {
  const target = new URL(review.destinationUrl);
  if (
    !parseHttpRedirectReview(
      review,
      review.sessionId,
      review.sourceOrigin,
      source.httpProxyPolicy,
    )
  )
    throw new Error(
      "Redirect destination requires a valid review and explicit permission for any security downgrade.",
    );
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: `Redirect — ${target.hostname}`,
    protocol: target.protocol === "https:" ? "https" : "http",
    hostname: target.hostname,
    port: Number(target.port || (target.protocol === "https:" ? 443 : 80)),
    isGroup: false,
    createdAt: now,
    updatedAt: now,
    httpVerifySsl: true,
    httpsTrustPolicy: "always-ask",
    httpAutoLogin: false,
    httpProxyPolicy: {
      ...DEFAULT_HTTP_PROXY_POLICY,
      queryParameters: [],
      httpsOnly: source.httpProxyPolicy?.httpsOnly === true,
      allowCrossOriginRedirects: true,
      allowHttpDowngradeRedirects:
        source.httpProxyPolicy?.allowHttpDowngradeRedirects === true,
      pageScripts: source.httpProxyPolicy?.pageScripts ?? "allow",
      sameOriginOnly: source.httpProxyPolicy?.sameOriginOnly ?? false,
    },
    // Route credentials, if present, remain confined to the existing transport.
    proxyChainId: source.proxyChainId,
    connectionChainId: source.connectionChainId,
    tunnelChainId: source.tunnelChainId,
    security: source.security
      ? {
          proxy: source.security.proxy,
          openvpn: source.security.openvpn,
          sshTunnel: source.security.sshTunnel,
          tunnelChain: source.security.tunnelChain,
        }
      : undefined,
  };
}
