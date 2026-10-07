import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import { normalizeHttpProxyPolicy } from "../connection/httpProxyPolicy";

export function allWebsiteRequestsAllowed(
  policy: HttpProxyPolicy | null,
): boolean {
  return policy?.allowAllRequests === true && !policy.sameOriginOnly;
}

/** A user-approved connection setting, never an automatic response to a report.
 * Keep TLS/downgrade and saved-login decisions independent of destination trust. */
export function allowAllWebsiteRequests(
  policy: HttpProxyPolicy | null,
): HttpProxyPolicy | null {
  if (!policy || allWebsiteRequestsAllowed(policy)) return null;
  try {
    return {
      ...normalizeHttpProxyPolicy(policy),
      allowAllRequests: true,
      pageScripts: "allow",
      sameOriginOnly: false,
    };
  } catch {
    return null;
  }
}
