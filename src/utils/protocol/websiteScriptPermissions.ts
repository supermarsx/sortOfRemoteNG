import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import {
  normalizeExternalResourceOrigins,
  normalizeHttpProxyPolicy,
} from "../connection/httpProxyPolicy";
import type { WebNetworkReport } from "./webNetworkReport";

export function allWebsiteScriptsAllowed(
  policy: HttpProxyPolicy | null,
): boolean {
  return (
    (policy?.allowAllScripts === true || policy?.allowAllRequests === true) &&
    policy.pageScripts === "allow" &&
    !policy.sameOriginOnly
  );
}

/** Explicit user trust exception; never derive this from an individual report. */
export function allowAllWebsiteScripts(
  policy: HttpProxyPolicy | null,
): HttpProxyPolicy | null {
  if (!policy || allWebsiteScriptsAllowed(policy)) return null;
  try {
    return {
      ...normalizeHttpProxyPolicy(policy),
      allowAllScripts: true,
      allowAllRequests: false,
      pageScripts: "allow",
      sameOriginOnly: false,
    };
  } catch {
    return null;
  }
}

/** Reports are advisory. Only a user's explicit review may persist this proposal. */
export function websiteScriptPermission(
  report: WebNetworkReport,
  effectivePolicy: HttpProxyPolicy | null,
): { policy: HttpProxyPolicy | null; explanation: string } {
  if (allWebsiteScriptsAllowed(effectivePolicy))
    return {
      policy: null,
      explanation:
        "All-script trust is already enabled. Reload the website to apply it. Remaining blocks may come from the browser sandbox, unsupported URLs or other network restrictions; adding a source cannot remove those limits.",
    };
  if (
    report.kind !== "script" ||
    !["policy-blocked-resource", "origin-not-approved"].includes(report.reason)
  )
    return {
      policy: null,
      explanation:
        "This block cannot be resolved with an external script permission.",
    };
  if (!report.origin)
    return {
      policy: null,
      explanation:
        "No external source was reported. Inline scripts, eval and the website's own CSP cannot be unlocked by adding a source.",
    };
  try {
    const [source] = normalizeExternalResourceOrigins([
      { origin: report.origin, kinds: ["script"] },
    ]);
    const host = new URL(source.origin).hostname;
    if (
      source.origin !== report.origin ||
      host === "localhost" ||
      host.endsWith(".localhost")
    )
      throw new Error("Not an external origin");
    if (!effectivePolicy) throw new Error("Policy unavailable");
    const policy = normalizeHttpProxyPolicy(effectivePolicy);
    const rows = policy.externalResourceOrigins!;
    const existing = rows.find((row) => row.origin === source.origin);
    if (
      existing?.kinds.includes("script") &&
      !policy.sameOriginOnly &&
      policy.pageScripts === "allow"
    )
      return {
        policy: null,
        explanation:
          "This source is already allowed. Reload the website; if it remains blocked, its CSP or proxy routing needs investigation. No broader permission will be added.",
      };
    if (!existing && rows.length >= 16)
      return {
        policy: null,
        explanation:
          "The 16-source limit is reached. Remove an unused source in this connection's Internal proxy controls first.",
      };
    return {
      policy: {
        ...policy,
        // An individual source grant must not reactivate a dormant all-script
        // exception from imported or previously restricted settings.
        allowAllScripts: false,
        allowAllRequests: false,
        pageScripts: "allow",
        sameOriginOnly: false,
        externalResourceOrigins: existing
          ? rows.map((row) =>
              row === existing
                ? {
                    ...row,
                    kinds: [...new Set([...row.kinds, "script" as const])],
                  }
                : row,
            )
          : [...rows, source],
      },
      explanation:
        "Allow scripts from this exact HTTPS origin for this saved connection. Requests stay on the proxy; this does not grant credentials, login consent, redirects or access to other origins.",
    };
  } catch {
    return {
      policy: null,
      explanation:
        "Only exact external HTTPS sources can be allowed here. Review this connection's Internal proxy controls for other blocks.",
    };
  }
}

/** Build one atomic grant for reviewed, actionable sources. Inline and already
 * allowed sources are not unlocked; exceeding the saved limit applies nothing. */
export function allListedWebsiteScriptPermissions(
  reports: readonly WebNetworkReport[],
  effectivePolicy: HttpProxyPolicy | null,
): { policy: HttpProxyPolicy | null; count: number; explanation: string } {
  let policy = effectivePolicy;
  const origins = new Set<string>();
  for (const report of reports) {
    if (!report.origin || origins.has(report.origin)) continue;
    const original = websiteScriptPermission(report, effectivePolicy);
    if (!original.policy) {
      if (original.explanation.startsWith("The 16-source limit"))
        return { policy: null, count: 0, explanation: original.explanation };
      continue;
    }
    const next = websiteScriptPermission(report, policy);
    if (!next.policy)
      return { policy: null, count: 0, explanation: next.explanation };
    origins.add(report.origin);
    policy = next.policy;
  }
  return {
    policy: origins.size ? policy : null,
    count: origins.size,
    explanation:
      "Only the external HTTPS sources shown here are added. New sources still require review; inline and unsupported blocks are unchanged.",
  };
}
