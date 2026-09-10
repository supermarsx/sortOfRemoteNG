import { normalizeHttpProxyPolicy } from "./httpProxyPolicy";
import { normalizeHttpFormAutomation } from "./httpFormAutomation";

export const isHttpSecretOption = (fieldName: string) =>
  fieldName === "httpproxypolicy" || fieldName === "httpformautomation";

/** Keep only validated metadata. Never infer secrecy from a parameter's name. */
export function stripHttpOptionSecrets(
  fieldName: string,
  value: unknown,
): unknown {
  try {
    if (fieldName === "httpproxypolicy") {
      const policy = normalizeHttpProxyPolicy(value);
      return { ...policy, queryParameters: [] };
    }
    if (fieldName === "httpformautomation") {
      const form = normalizeHttpFormAutomation(value);
      return form ? { ...form, fields: [], submit: false } : undefined;
    }
  } catch {
    // Unknown imported extensions must not smuggle literal secrets into exports.
  }
  return undefined;
}
