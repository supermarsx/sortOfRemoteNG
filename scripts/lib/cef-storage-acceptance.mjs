/** Observation validation only; never execution provenance or production Ready. */
import { readFileSync } from "node:fs";

export const STORAGE_PLAN = JSON.parse(
  readFileSync(
    new URL(
      "../../src-tauri/crates/sorng-browser-host/tests/native_acceptance/fixtures/storage-plan.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
export const STORAGE_CONTEXTS = [
  "storage-a",
  "storage-b",
  "storage-a-reconnect",
];

export function assessStorageIsolation(report, runId, assessLedger) {
  const failures = [];
  const require = (ok, reason) => {
    if (!ok) failures.push(reason);
  };
  require(report?.schema === 1 &&
    report.status ===
      "completed", "complete native storage observation required");
  require(typeof runId === "string" &&
    runId.length > 0 &&
    report?.runId === runId, "storage invocation correlation missing");
  require(report?.factory === "production-create-with-tls" &&
    report?.origin ===
      "https://accounts.google.com", "storage production TLS factory and exact local-fixture origin required");
  require(report?.productionReady === false &&
    report?.publicProviderAcceptance ===
      false, "storage fixture cannot claim production/provider acceptance");
  require(report?.protocolErrors === 0 &&
    Array.isArray(report?.failures) &&
    report.failures.length ===
      0, "storage protocol/native failures or missing inventory");
  require([
    "sameOwner",
    "distinctConnections",
    "reconnectSameOwner",
    "reconnectSameConnection",
    "reconnectSameSession",
    "freshAttempts",
  ].every(
    (key) => report?.identities?.[key] === true,
  ), "native distinct-connection/reconnect identity evidence missing");

  const steps = Array.isArray(report?.steps) ? report.steps : [];
  require(steps.length ===
    STORAGE_PLAN.length, "complete ordered storage step inventory required");
  for (const [index, expected] of STORAGE_PLAN.entries()) {
    const step = steps[index];
    const label = `storage ${expected.name}`;
    require(step?.name === expected.name &&
      step?.slot ===
        expected.slot, `${label}: ordered identity-bound step missing`);
    require([
      "passed",
      "originExact",
      "secure",
      "top",
      "tauriAbsent",
      "httpOnlyHidden",
    ].every(
      (key) => step?.[key] === true,
    ), `${label}: secure native storage proof missing`);
    for (const key of ["cookie", "localStorage", "indexedDb"]) {
      require(step?.before?.[key] === expected.before &&
        step?.after?.[key] ===
          expected.after, `${label}: ${key} isolation/readback mismatch`);
    }
    for (const key of ["native", "script"]) {
      require(step?.initialCookies?.[key] === expected.before &&
        step?.sentCookies?.[key] ===
          expected.after, `${label}: ${key} server cookie round trip mismatch`);
    }
    const live = index < 8 ? [0, 1] : index === 8 ? [1] : [1, 2];
    require(Array.isArray(step?.liveSlots) &&
      step.liveSlots.length === live.length &&
      live.every(
        (slot, i) => step.liveSlots[i] === slot,
      ), `${label}: simultaneously live contexts missing`);
  }

  const contexts = Array.isArray(report?.contexts) ? report.contexts : [];
  require(contexts.length ===
    STORAGE_CONTEXTS.length, "complete storage context cleanup inventory required");
  const tokens = new Set();
  for (const [slot, name] of STORAGE_CONTEXTS.entries()) {
    const matches = contexts.filter((c) => c?.name === name),
      context = matches[0];
    require(matches.length === 1, `${name}: exactly one context required`);
    if (!context) continue;
    require(Number.isSafeInteger(context.contextToken) &&
      context.contextToken > 0 &&
      !tokens.has(
        context.contextToken,
      ), `${name}: distinct native TLS context missing`);
    tokens.add(context.contextToken);
    require([
      "tlsInstalled",
      "closed",
      "revokedNavigationRejected",
      "relayStopped",
      "collectorDrained",
      "sniExact",
      "hostHeaderExact",
      "evidenceExact",
    ].every(
      (key) => context[key] === true,
    ), `${name}: native TLS/ordered cleanup evidence missing`);
    require([
      "routeDials",
      "tlsHandshakes",
      "httpRequests",
      "pulseRequests",
      "httpBytes",
      "challenges",
      "decisions",
      "allowDecisionsSubmitted",
    ].every(
      (key) => Number.isSafeInteger(context[key]) && context[key] > 0,
    ), `${name}: actual TLS, payload and renderer pulse required`);
    // Every snapshot requires its page GET and proof POST. Each write also
    // requires a cookie POST. Pulses/retries/favicon requests make exact totals
    // inappropriate, but fewer requests than these observations is impossible.
    const minimumProbeRequests = STORAGE_PLAN.filter(
      (step) => step.slot === slot,
    ).reduce((total, step) => total + 2 + (step.write === null ? 0 : 1), 0);
    require(context.httpRequests >=
      minimumProbeRequests +
        context.pulseRequests, `${name}: HTTP count cannot support the reported storage snapshots/writes/pulses`);
    // This fixture serves one request per TLS socket (Connection: close).
    // Partial requests can increase byte-bearing sockets, never reduce them.
    const payloadSockets = Array.isArray(context.sockets)
      ? context.sockets.filter((socket) => socket?.httpBytes > 0).length
      : 0;
    require(context.httpRequests <= payloadSockets &&
      context.httpRequests <=
        context.tlsHandshakes, `${name}: HTTP count exceeds observed payload sockets/handshakes`);
    require(Number.isSafeInteger(context.heldMs) &&
      context.heldMs >= 300 &&
      Number.isSafeInteger(context.revokeObservedMs) &&
      context.revokeObservedMs >=
        750, `${name}: admission/revocation window missing`);
    require(context.proxyAuthorizationLeaked === false &&
      context.unexpectedRoute === false &&
      context.httpBeforeAdmission === 0 &&
      context.postRevokeBytes ===
        0, `${name}: route/disclosure/admission violation`);
    require(Array.isArray(context.grants) &&
      context.grants.length ===
        0, `${name}: storage probe must not grant credentials`);
    require(typeof assessLedger ===
      "function", `${name}: per-socket TLS validator required`);
    if (typeof assessLedger === "function") {
      for (const failure of assessLedger(context).failures)
        failures.push(`${name}: ${failure}`);
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    productionReady: false,
    publicProviderAcceptance: false,
  };
}
