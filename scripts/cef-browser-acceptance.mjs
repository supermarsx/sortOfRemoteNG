/** Independent actual-browser gate. Never changes production Ready or trust stores. */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectRuntime,
  inspectNativeBinary,
  packageManifest,
} from "./browser-runtime-package.mjs";
import {
  stageCustomRuntimePackage,
  BRIDGE_PATCH_ID,
  PROXY_APPLIED_BRIDGE_PATCH_ID,
  HTTP2_BRIDGE_PATCH_ID,
  LEGACY_BRIDGE_PATCH_ID,
} from "./lib/browser-custom-runtime.mjs";
import { ensureBrowserSandboxAccess } from "./lib/browser-sandbox-access.mjs";
import { verifyLocalRuntimeSelection } from "./lib/browser-local-runtime.mjs";
import { assessStorageIsolation } from "./lib/cef-storage-acceptance.mjs";
import {
  readNativeCrashSummary,
  applyNativeCrashGate,
} from "./lib/cef-native-crash-summary.mjs";

export const TLS_PATCH_ID = BRIDGE_PATCH_ID;
export const TLS_LEGACY_PATCH_ID = LEGACY_BRIDGE_PATCH_ID;
const TLS_SUPPORTED_PATCH_IDS = [
  TLS_PATCH_ID,
  PROXY_APPLIED_BRIDGE_PATCH_ID,
  HTTP2_BRIDGE_PATCH_ID,
  TLS_LEGACY_PATCH_ID,
];
function matchesTlsRevision(actual, expected) {
  return (
    TLS_SUPPORTED_PATCH_IDS.includes(actual) &&
    (expected === undefined || actual === expected)
  );
}
export const TLS_CASES = [
  "manual",
  "staged",
  "reject",
  "cancel",
  "wrong-host",
  "wrong-port",
  "wrong-certificate",
  "revoke-pending",
  "successor",
];

export function assessTlsSocketLedger(c) {
  const failures = [];
  const require = (ok, reason) => {
    if (!ok) failures.push(reason);
  };
  const sockets = Array.isArray(c?.sockets) ? c.sockets : [];
  require(c?.correlation === "unique-leaf-der-per-accepted-socket" &&
    c.correlationErrors === 0, "unique leaf/socket correlation required");
  require(c?.collectorDrained === true &&
    c.taskErrors === 0, "fixture tasks not completely drained");
  require(sockets.length > 0 &&
    sockets.length <= 256, "bounded socket inventory required");
  const ids = new Set(),
    challenges = new Set(),
    generations = new Set();
  const totals = {
    httpBytes: 0,
    httpBeforeAdmission: 0,
    postRevokeBytes: 0,
    tlsHandshakes: 0,
    challenges: 0,
    allowDecisionsSubmitted: 0,
    decisions: 0,
  };
  for (const s of sockets) {
    if (!s || typeof s !== "object") {
      failures.push("invalid socket");
      continue;
    }
    require(Number.isSafeInteger(s.id) &&
      s.id > 0 &&
      !ids.has(s.id), "duplicate or invalid socket ID");
    ids.add(s.id);
    require(["completed", "eof", "tls-error", "io-error"].includes(
      s.outcome,
    ), "missing, cancelled or timed-out socket outcome");
    require(typeof s.tlsCompleted ===
      "boolean", "socket handshake observation missing");
    for (const key of ["httpBytes", "httpBeforeAdmission", "postRevokeBytes"]) {
      require(Number.isSafeInteger(s[key]) &&
        s[key] >= 0, `invalid socket ${key}`);
      totals[key] += s[key];
    }
    const key = s.challenge;
    if (key !== null) {
      require(Number.isSafeInteger(key?.id) &&
        key.id > 0 &&
        key.context === c.contextToken &&
        Number.isSafeInteger(key.generation) &&
        key.generation > 0, "challenge not bound to this native context");
      const tag = JSON.stringify([key?.context, key?.generation, key?.id]);
      require(!challenges.has(tag), "replayed challenge across sockets");
      challenges.add(tag);
      generations.add(key?.generation);
      totals.challenges++;
      require(["allow-submitted", "deny", "cancel", "stale-attempt"].includes(
        s.decision,
      ), "correlated challenge has no terminal decision");
    } else
      require(s.decision === "pending" &&
        s.tlsCompleted === false &&
        s.httpBytes === 0 &&
        s.outcome ===
          "tls-error", "unmatched transport emitted payload or completed TLS");
    if (s.decision === "allow-submitted") totals.allowDecisionsSubmitted++;
    if (s.decision !== "pending") totals.decisions++;
    if (s.tlsCompleted) totals.tlsHandshakes++;
    require(s.httpBeforeAdmission === 0 &&
      s.postRevokeBytes === 0, "per-socket pre-decision or revoked bytes");
    if (s.httpBytes > 0)
      require(key != null &&
        s.decision === "allow-submitted" &&
        s.tlsCompleted === true, "socket borrowed another socket admission");
    if (s.tlsCompleted)
      require(key != null &&
        s.decision === "allow-submitted", "unapproved socket completed TLS");
    else
      require(s.outcome ===
        "tls-error", "incomplete handshake lacks a retained TLS failure");
  }
  require(generations.size === 1, "native generation changed within a context");
  for (const [key, value] of Object.entries(totals))
    require(c?.[key] === value, `socket aggregate mismatch: ${key}`);
  return { ok: failures.length === 0, failures };
}

export const REGISTRATION_RETIREMENT_CASES = [
  "sequential-1025",
  "attached-revoked-retained",
  "ack-before-detach",
  "detach-before-ack",
  "retired-operation-denial",
  "token-replay-denial",
  "out-of-order-denial",
  "rejected-create-quiescent",
  "root-storage-released",
  "no-late-callbacks",
];

export function assessRegistrationRetirement(value) {
  const failures = [];
  const require = (ok, reason) => {
    if (!ok) failures.push(reason);
  };
  require(value?.ok === true, "registration retirement did not complete");
  require(Number.isSafeInteger(value?.sequentialContexts) &&
    value.sequentialContexts >=
      1025, "more than 1024 sequential native contexts required");
  require(Number.isSafeInteger(value?.peakRegistrations) &&
    value.peakRegistrations >= 1 &&
    value.peakRegistrations <=
      2, "bounded live registration observation missing");
  require(Number.isSafeInteger(value?.peakRootBytes) &&
    value.peakRootBytes > 0 &&
    value.peakRootBytes <=
      8 * 1024 * 1024, "bounded root-storage observation missing");
  require(value?.finalRegistrations === 0 &&
    value?.finalRootBytes ===
      0, "native registrations or root storage were retained");
  require(typeof value?.tokenHighWater === "string" &&
    /^[1-9]\d{0,19}$/.test(value.tokenHighWater) &&
    BigInt(value.tokenHighWater) <=
      18446744073709551615n, "lossless native token high-water observation missing");
  const cases = Array.isArray(value?.cases) ? value.cases : [];
  require(cases.length === REGISTRATION_RETIREMENT_CASES.length &&
    new Set(cases.map((row) => row?.case)).size === cases.length &&
    REGISTRATION_RETIREMENT_CASES.every((name) =>
      cases.some((row) => row?.case === name && row.ok === true),
    ), "complete native registration retirement cases required");
  require(value?.browserCreated === false &&
    value?.networkProbe ===
      false, "registration-only observation scope missing");
  require(value?.factoryAbandonFaultInjected === false &&
    value?.partitionRecreationFaultInjected ===
      false, "registration fixture fault-injection limits must be explicit");
  return { ok: failures.length === 0, failures, productionReady: false };
}

export const HTTP2_CHECKS = Object.freeze([
  "multiplex",
  "deny",
  "delay",
  "revoke",
  "cross-authority",
  "wss",
  "h1-fallback",
  "permission-churn",
]);

/** Scrub experiment controls even when launching another acceptance suite. */
export function http2Environment(environment, suite, check) {
  if (suite === "http2" && !HTTP2_CHECKS.includes(check))
    throw new Error("Unknown HTTP2 check");
  if (suite !== "http2" && check !== undefined)
    throw new Error("check applies only to http2");
  const env = { ...environment };
  for (const name of Object.keys(env))
    if (
      name.startsWith("SORNG_CEF_HTTP2_") ||
      [
        "PROBE_VISIBLE",
        "PROBE_FIXTURE_NODELAY",
        "SORNG_PROBE_VISIBLE",
        "SORNG_PROBE_FIXTURE_NODELAY",
      ].includes(name)
    )
      delete env[name];
  if (suite === "http2") {
    env.SORNG_CEF_HTTP2_CHECK = check === "h1-fallback" ? "multiplex" : check;
    env.SORNG_CEF_HTTP2_EXPECT = check === "h1-fallback" ? "h1" : "retirement";
  }
  return env;
}

/** Validates fixture observations; execution and isolation are separate gates. */
export function assessNativeHttp2Report(report, runId, expectedPatchId, check) {
  const failures = [];
  const require = (ok, message) => {
    if (!ok) failures.push(message);
  };
  const rows = (value, length) =>
    Array.isArray(value) && value.length === length;
  const pair = (value) => rows(value, 2) && value.every((v) => v === true);
  require(HTTP2_CHECKS.includes(check), "known HTTP2 check required");
  require(expectedPatchId === TLS_PATCH_ID &&
    report?.patchId === expectedPatchId &&
    report?.loadedBridgeVerified ===
      true, "exact loaded revision-four bridge required");
  require(typeof runId === "string" &&
    runId.length > 0 &&
    report?.runId === runId, "fresh HTTP2 invocation correlation missing");
  require(report?.probeKind === "native-same-authority-http2" &&
    report?.check ===
      (check === "h1-fallback"
        ? "multiplex"
        : check), "actual requested HTTP2 fixture check required");
  require(report?.ok === true &&
    report?.productionReady === false &&
    report?.productionTlsFactory ===
      true, "production TLS fixture observations required");
  require(report?.clean === true &&
    report?.closed === true &&
    report?.shutdownComplete ===
      true, "clean closed HTTP2 fixture shutdown required");
  require(Array.isArray(report?.failures) &&
    report.failures.length ===
      0, "HTTP2 native failure inventory must be empty");
  const retirement = assessRegistrationRetirement(
    report?.registrationRetirementCases,
  );
  for (const failure of retirement.failures)
    failures.push(`registration retirement: ${failure}`);
  const boundary = report?.proxyBoundaryCases;
  const expectedBoundary = [
    "wrong-port",
    "direct",
    "fallback",
    "replace-during-ack",
    "revoke-before-ack",
  ];
  require(boundary?.ok === true &&
    boundary.networkProbe === false &&
    boundary.pacPreferenceTested === false &&
    rows(boundary.cases, 5) &&
    new Set(boundary.cases.map((r) => r?.case)).size === 5 &&
    expectedBoundary.every((name) =>
      boundary.cases.some(
        (r) =>
          r?.case === name &&
          r.ok === true &&
          r.browserCreated === false &&
          r.tlsEvidence === 0 &&
          rows(r.states, name === "revoke-before-ack" ? 2 : 3) &&
          r.states.every(
            (s, i) =>
              s === (name === "revoke-before-ack" ? [1, 2] : [1, 5, 2])[i],
          ),
      ),
    ), "five actual proxy application boundary cases required");
  require(report?.proxyProofRequired === true &&
    report?.proxyAckNoApplicationNetwork ===
      true, "proxy ACK before application networking required");
  if (check === "permission-churn") {
    require(report?.mode === "permission-churn" &&
      report?.replacedOldContext === true &&
      report?.sameRowFreshAttempt === true &&
      report?.distinctEndpoints === true &&
      report?.distinctCredentials === true &&
      report?.beforeAdmissionBytesZero === true &&
      rows(report?.actualProxyProofs, 4) &&
      report.actualProxyProofs.every(
        (v) => v === true,
      ), "four independently admitted permission replacement contexts required");
    const phases = [
      "before-change",
      "after-old-close-before-new-contexts",
      "fresh-contexts-operational",
      "after-change",
    ];
    require(Number.isSafeInteger(report?.globalPolicyChecks) &&
      report.globalPolicyChecks > 0 &&
      rows(report?.phases, 4) &&
      phases.every((phase, index) => {
        const row = report.phases[index];
        return (
          row?.phase === phase &&
          row.globalPolicy === true &&
          row.survivorIdentityAndEndpointUnchanged === true &&
          rows(row.survivorCounts, 2) &&
          row.survivorCounts.every(
            (n) => Number.isSafeInteger(n) && n >= index + 1,
          )
        );
      }), "unchanged survivor HTTP/WSS and global policy through replacement required");
  } else {
    const slots = Array.isArray(report?.slots)
      ? report.slots.filter(
          (s) => s && typeof s === "object" && Array.isArray(s.requests),
        )
      : [];
    require(rows(report?.slots, 2) &&
      rows(slots, 2) &&
      slots.every(
        (s) =>
          s?.beforeAdmissionBytes === 0 &&
          s.proxyApplicationVerified === true &&
          Array.isArray(s.errors) &&
          (check === "deny" || s.errors.length === 0) &&
          Array.isArray(s.requests),
      ), "two scoped contexts with zero pre-admission bytes required");
    require(rows(report?.baselineBeforeCef, 2) &&
      slots.length === 2 &&
      slots.every((s, index) => {
        const before = s.proxyBeforeHost,
          baseline = report.baselineBeforeCef[index];
        const delta = (field) =>
          Number.isSafeInteger(before?.[field]) &&
          Number.isSafeInteger(baseline?.[field]) &&
          before[field] >= baseline[field]
            ? before[field] - baseline[field]
            : undefined;
        return (
          delta("acceptedConnections") !== undefined &&
          delta("acceptedConnections") === delta("authenticationChallenges") &&
          delta("authenticatedRequests") === 0 &&
          delta("requestRejections") === 0 &&
          delta("capacityRefusals") === 0 &&
          before.upstreamDials === 0 &&
          before.upstreamFailures === 0
        );
      }), "pre-host proxy counters must show no authenticated request or upstream dial");
    const protocol = check === "h1-fallback" ? "http/1.1" : "h2";
    require(report?.expectedProtocol ===
      protocol, "requested ALPN mode required");
    if (check === "deny") {
      require(slots.length === 2 &&
        slots.every(
          (s) =>
            Number.isSafeInteger(s.denied) &&
            s.denied > 0 &&
            s.requests?.length === 0,
        ), "denied TLS must deliver no application requests");
    } else if (check === "revoke") {
      require(pair(report?.socketsClosedBeforeBrowserClose) &&
        pair(report?.revokedNavigationRejected) &&
        rows(report?.revokeBaselineRequests, 2) &&
        slots.length === 2 &&
        slots.every(
          (s, i) =>
            Number.isSafeInteger(report.revokeBaselineRequests[i]) &&
            report.revokeBaselineRequests[i] > 0 &&
            s.requests?.length === report.revokeBaselineRequests[i] &&
            s.tlsCurrent === false,
        ), "revocation must close sockets and prevent later requests/navigation");
    } else if (check === "wss") {
      require(slots.length === 2 &&
        slots.every(
          (s) =>
            s.requests?.some(
              (r) => r?.websocket === true && r.alpn === "http/1.1",
            ) &&
            s.requests.some((r) => r?.path === "/wss-ok" && r.alpn === "h2"),
        ), "WSS upgrade plus HTTP2 marker required");
    } else {
      const matrix = [
        [0, 0, 0],
        [8, 0, 0],
        [32, 0, 0],
        [0, 80, 0],
        [8, 80, 0],
        [32, 80, 0],
        [32, 80, 80],
      ];
      require(report?.matrixCases === 7 &&
        slots.length === 2 &&
        slots.every(
          (s) =>
            rows(s.cases, 7) &&
            matrix.every(([resources, response, dial], index) => {
              const c = s.cases[index];
              return (
                c?.case === index &&
                c.resources === resources &&
                c.responseDelayMs === response &&
                c.dialDelayMs === dial &&
                Number.isFinite(c.loadMs) &&
                c.loadMs >= 0 &&
                Array.isArray(c.requests) &&
                c.requests.length >= resources + 1 &&
                c.requests.every(
                  (r) => r?.alpn === protocol && r.written === true,
                )
              );
            }) &&
            Array.isArray(s.alpnObserved) &&
            s.alpnObserved.length > 0 &&
            s.alpnObserved.every((v) => v === protocol) &&
            s.cases.some(
              (c) =>
                c.resources === 32 &&
                c.responseDelayMs === 80 &&
                Number.isSafeInteger(c.requestPeak) &&
                (protocol === "h2"
                  ? c.requestPeak > 6
                  : c.requestPeak > 0 && c.requestPeak <= 6),
            ),
        ), "complete seven-case native multiplex/fallback matrix required");
      if (check === "delay")
        require(slots.length === 2 &&
          slots.every(
            (s) =>
              Number.isFinite(s.minimumAdmissionDelayMs) &&
              s.minimumAdmissionDelayMs >= 300,
          ), "actual withheld admission duration required");
      if (check === "cross-authority")
        require(slots.length === 2 &&
          slots.every(
            (s) =>
              Number.isSafeInteger(s.denied) &&
              s.denied > 0 &&
              s.requests?.every(
                (r) => r && r.authority !== "alternate.fixture.test",
              ),
          ), "cross-authority TLS denial without application delivery required");
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    actualCefAcceptance: false,
    publicProviderAcceptance: false,
    productionReady: false,
  };
}

/** Validate observations, never turn a JSON document into execution provenance. */
export function assessNativeTlsReport(report, runId, expectedPatchId) {
  const failures = [];
  const require = (ok, reason) => {
    if (!ok) failures.push(reason);
  };
  require(report?.schema === 2 &&
    report?.engine === "cef" &&
    report?.bindingPin === "154.3.0" &&
    report?.evidenceKind ===
      "native-cef-local-fixture", "actual native TLS fixture report required");
  require(typeof runId === "string" &&
    runId.length > 0 &&
    report?.runId === runId, "fresh invocation correlation missing");
  require(matchesTlsRevision(report?.patchId, expectedPatchId) &&
    report?.loadedBridgeVerified === true, "frozen loaded V2 bridge missing");
  if (report?.patchId === TLS_PATCH_ID) {
    const retirement = assessRegistrationRetirement(
      report.registrationRetirementCases,
    );
    for (const failure of retirement.failures)
      failures.push(`registration retirement: ${failure}`);
  }
  require(report?.productionReady === false &&
    report?.publicProviderAcceptance ===
      false, "fixture must not claim production or provider acceptance");
  require(report?.securitySwitchesClean === true &&
    report?.networkPolicyConfigured ===
      true, "native security/policy readback missing");
  require(report?.shutdownComplete === true, "ordered native shutdown missing");
  require(Array.isArray(report?.failures), "native failure inventory missing");
  for (const failure of Array.isArray(report?.failures) ? report.failures : [])
    failures.push(`native: ${failure}`);
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  require(typeof report?.manualRequested ===
    "boolean", "explicit manual/automated observation scope required");
  const manual = report?.manualRequested !== false;
  require(report?.manualStatus ===
    (manual
      ? "observed"
      : "not-run"), "manual input must be observed or explicitly not run");
  const requiredCases = manual
    ? TLS_CASES
    : TLS_CASES.filter((name) => name !== "manual");
  require(cases.length ===
    requiredCases.length, "complete unique TLS case inventory required");
  const tokens = new Set();
  for (const name of requiredCases) {
    const matches = cases.filter((c) => c?.name === name);
    const c = matches[0];
    require(matches.length === 1, `${name}: one native observation required`);
    if (!c) continue;
    require([
      "challenges",
      "heldMs",
      "revokeObservedMs",
      "decisions",
      "allowDecisionsSubmitted",
      "routeDials",
      "tlsHandshakes",
      "httpRequests",
      "pulseRequests",
      "httpBytes",
      "httpBeforeAdmission",
      "postRevokeBytes",
    ].every(
      (key) => Number.isSafeInteger(c[key]) && c[key] >= 0,
    ), `${name}: numeric observations required`);
    require(Array.isArray(
      c.grants,
    ), `${name}: native grant inventory required`);
    require(c.tlsInstalled === true &&
      c.closed === true &&
      c.routeDials > 0, `${name}: native lifecycle/TLS evidence missing`);
    for (const reason of assessTlsSocketLedger(c).failures)
      failures.push(`${name}: ${reason}`);
    require(Number.isSafeInteger(c.contextToken) &&
      c.contextToken > 0 &&
      !tokens.has(c.contextToken), `${name}: distinct native context missing`);
    tokens.add(c.contextToken);
    require(c.challenges > 0 &&
      c.heldMs >= 300 &&
      c.revokeObservedMs >= 750 &&
      c.httpBeforeAdmission === 0 &&
      c.postRevokeBytes ===
        0, `${name}: pre-admission/revocation isolation missing`);
    require(c.proxyAuthorizationLeaked === false &&
      c.unexpectedRoute === false &&
      c.sniExact === true &&
      c.hostHeaderExact ===
        true, `${name}: exact route/SNI/header evidence missing`);
    require(c.evidenceExact ===
      true, `${name}: observed host/port/certificate mismatch`);
    if (["manual", "staged", "successor"].includes(name)) {
      require(c.allowDecisionsSubmitted > 0 &&
        c.tlsHandshakes > 0 &&
        c.httpRequests >= 3 &&
        c.pulseRequests > 0 &&
        c.proof?.origin === "https://accounts.google.com" &&
        c.proof?.secure === true &&
        c.proof?.top === true &&
        c.proof?.tauriAbsent === true &&
        c.initialCookieEmpty === true &&
        c.proof?.cookieEmpty === true &&
        c.proof?.storageEmpty ===
          true, `${name}: secure origin/login/storage proof missing`);
      require(c.proof?.login === true &&
        c.proof?.nativeCookieSent === true &&
        c.proof?.httpOnlyHidden ===
          true, `${name}: login/cookie round trip missing`);
      if (name === "manual")
        require(c.proof?.trustedSubmit === true &&
          c.grants?.length ===
            0, "manual: trusted operator input without native grants required");
      else
        require(["Identifier", "Password"].every(
          (s) => Array.isArray(c.grants) && c.grants.includes(s),
        ), `${name}: staged native grants missing`);
      require(c.revokedNavigationRejected ===
        true, `${name}: revoked navigation was not rejected`);
    } else {
      require(c.httpRequests === 0 &&
        c.httpBytes === 0 &&
        c.allowDecisionsSubmitted === 0 &&
        c.tlsHandshakes ===
          0, `${name}: rejected connection emitted HTTP or completed TLS`);
      require(c.decisions > 0, `${name}: negative policy action missing`);
      const expectedDecision =
        name === "cancel"
          ? "cancel"
          : name === "revoke-pending"
            ? "stale-attempt"
            : "deny";
      require(Array.isArray(c.sockets) &&
        c.sockets
          .filter((s) => s?.challenge != null)
          .every(
            (s) => s.decision === expectedDecision,
          ), `${name}: wrong negative decision exercised`);
      if (name.startsWith("wrong-"))
        require(c.policyMismatch ===
          true, `${name}: exact policy mismatch not exercised`);
      if (name === "revoke-pending")
        require(c.staleCompletionAttempted ===
          true, "revoke-pending: stale completion not exercised");
    }
  }
  const predecessor = cases.find((c) => c?.name === "revoke-pending"),
    successor = cases.find((c) => c?.name === "successor");
  require(predecessor?.overlapPeerToken === successor?.contextToken &&
    successor?.overlapPeerToken === predecessor?.contextToken &&
    Number.isSafeInteger(predecessor?.predecessorPendingAtSuccessor) &&
    predecessor.predecessorPendingAtSuccessor > 0 &&
    predecessor.predecessorPendingAtSuccessor ===
      successor?.predecessorPendingAtSuccessor, "successor must challenge while predecessor completion remains pending");
  const storage = assessStorageIsolation(
    report?.storageIsolation,
    runId,
    assessTlsSocketLedger,
  );
  for (const failure of storage.failures) failures.push(failure);
  for (const context of Array.isArray(report?.storageIsolation?.contexts)
    ? report.storageIsolation.contexts
    : []) {
    require(!tokens.has(
      context?.contextToken,
    ), "storage cannot reuse a preceding TLS case context");
  }
  return {
    ok: failures.length === 0,
    failures,
    productionReady: false,
    actualCefAcceptance: false,
    publicProviderAcceptance: false,
    manualAcceptance: manual && failures.length === 0,
    manualStatus: report?.manualStatus ?? "not-run",
    storageIsolationObserved: storage.ok,
    remainingProbes: manual ? [] : ["trusted manual input not run"],
    scope: `${manual ? "manual and automated" : "automated only; trusted manual input not run"} local synthetic fixture observations; requires runner execution correlation; not full CEF acceptance`,
  };
}

export function assessNativeReport(report, expectedPatchId) {
  const failures = [...(report?.failures ?? [])];
  const require = (ok, message) => {
    if (!ok) failures.push(message);
  };
  require(report?.schema === 1 &&
    report.engine === "cef" &&
    report.bindingPin === "154.3.0", "pinned native CEF report required");
  require(report?.productionReady ===
    false, "acceptance must not grant production readiness");
  require(report?.mode !==
    "measure", "measurement report is not acceptance evidence");
  require(report?.mode !==
    "menu", "context-menu evidence report is not acceptance evidence");
  require(matchesTlsRevision(
    report?.nativeTlsAdmission?.patchId,
    expectedPatchId,
  ) &&
    report.nativeTlsAdmission.verified ===
      true, "legacy SPKI fixture cannot establish patched-engine TLS admission; run the native TLS suite");
  const policy = report?.networkPolicy;
  const verifiedStore = (store) =>
    [
      "dictionaryPresent",
      "exactlyThreeFields",
      "fixedServers",
      "productionRejectingEndpoint",
      "loopbackBypassDisabled",
    ].every((key) => store?.[key] === true);
  require(policy?.reader === "production-runtime" &&
    policy.configured === true &&
    policy.readbackFailed === false &&
    verifiedStore(policy.system) &&
    verifiedStore(
      policy.global,
    ), "production network policy readback missing or rejected");
  const proofs = report?.proofs ?? [];
  const generic = proofs.find((p) => p.completed === "generic");
  require(generic?.origin === "https://fixture.test" &&
    generic.secure === true &&
    generic.top === true, "real secure top-level origin missing");
  require(generic?.tauriAbsent === true &&
    generic.httpOnlyHidden === true &&
    generic.nativeCookieSent === true &&
    generic.syntheticLogin ===
      true, "native cookie/login/privilege evidence missing");
  require(generic?.iframe?.origin === "https://frame.test" &&
    generic.iframe.isolated === true &&
    generic.iframe.nativeCookieAbsent === true &&
    generic.iframe.tauriAbsent ===
      true, "cross-origin iframe isolation missing");
  const isolated = proofs.find((p) => p.completed === "isolation");
  require(isolated?.cookieEmpty === true &&
    isolated.storageEmpty === true &&
    isolated.nativeCookieSent === false, "private-context isolation missing");
  const google = proofs.find((p) => p.completed === "google");
  require(google?.origin === "https://accounts.google.com" &&
    google.identifier === true &&
    google.password === true &&
    google.nativeBridgeAbsent ===
      true, "local Google-shaped staged login missing");
  require(["Form", "Identifier", "Password"].every((stage) =>
    report?.grants?.includes(stage),
  ), "native per-stage grants missing");
  require(report?.proxyAuthorizationLeaked ===
    false, "upstream proxy credential leak or missing observation");
  require(report?.routeDials?.length > 0 &&
    report.routeDials.every((d) =>
      [
        "fixture.test:443",
        "frame.test:443",
        "accounts.google.com:443",
      ].includes(d),
    ), "route dial evidence missing or unexpected destination");
  require(report?.sni?.length > 0 &&
    report.sni.every((s) =>
      ["fixture.test", "frame.test", "accounts.google.com"].includes(s),
    ), "native TLS SNI evidence missing or unexpected");
  for (const attempt of ["generic", "isolation", "google"]) {
    const lifecycle = report?.lifecycle?.find((l) => l.attempt === attempt);
    require(lifecycle?.closed === true &&
      lifecycle.postRevokeRequests ===
        0, `${attempt}: acknowledged close/revocation missing`);
  }
  for (const missing of report?.missingEvidence ?? [
    "native evidence inventory",
  ])
    failures.push(`unverified: ${missing}`);
  return { ok: failures.length === 0, failures, productionReady: false };
}

const login = (id, presentation) => ({
  id,
  presentation,
  adapter: "modular-form",
});
const scenario = (id, slots, options = {}) => ({
  id,
  shell: options.shell ?? "as-launched",
  page: options.page ?? "login",
  longWindow: options.longWindow === true,
  slots,
});

/**
 * Measurement scenarios (a)-(f), in run order. Mirrors SCENARIOS in
 * native_acceptance/src/measure.rs; a tooling test compares the two tables.
 * The (e) scenarios run last because they change the fixture window's state.
 * The two (f) scenarios open the same 52 connections through one relay: the
 * first with the relay's default client cap, the second with a cap the
 * fixture sets below 52, so the refusal path never depends on the default.
 * "modular-form" logins use the native key pipeline; "generic" assigns values
 * in page script and sends no key events. A long window lasts two and a half
 * windows, to show timer throttling that starts late.
 */
export const MEASUREMENT_SCENARIOS = [
  scenario("baseline-visible", [login("baseline-visible", "visible")]),
  scenario("a-hidden-after-attach", [
    login("a-hidden-after-attach", "hidden-after-attach"),
  ]),
  scenario("b-born-hidden-1x1", [login("b-born-hidden-1x1", "born-hidden")]),
  scenario(
    "b-born-hidden-1280x800",
    [login("b-born-hidden-1280x800", "born-hidden")],
    { longWindow: true },
  ),
  scenario("b-born-hidden-generic", [
    {
      id: "b-born-hidden-generic",
      presentation: "born-hidden",
      adapter: "generic",
    },
  ]),
  scenario("c-visible-input-blocked", [
    login("c-visible-input-blocked", "visible-input-blocked"),
  ]),
  scenario("d-concurrent", [
    login("d-visible", "visible"),
    login("d-hidden-after-attach", "hidden-after-attach"),
    login("d-born-hidden", "born-hidden"),
  ]),
  scenario(
    "f-relay-capacity",
    [{ id: "f-relay-capacity", presentation: "visible", adapter: "manual" }],
    { page: "capacity" },
  ),
  scenario(
    "f-relay-capacity-capped",
    [
      {
        id: "f-relay-capacity-capped",
        presentation: "visible",
        adapter: "manual",
      },
    ],
    { page: "capacity" },
  ),
  scenario("e-inactive", [login("e-inactive", "visible")], {
    shell: "inactive",
  }),
  scenario("e-covered", [login("e-covered", "visible")], { shell: "covered" }),
  scenario("e-minimized-hidden", [login("e-minimized-hidden", "born-hidden")], {
    shell: "minimized",
  }),
];

export const MEASUREMENT_VARIABLES = [
  "SORNG_CEF_ACCEPTANCE_MODE",
  "SORNG_CEF_MEASURE_WINDOW_MS",
  "SORNG_CEF_MEASURE_ONLY",
];

/** Validated runner options and the time the selected scenarios should take. */
export function measurementPlan({ windowMs, only } = {}) {
  // Observation window per scenario. The default covers the login client's
  // eight-second form budget.
  windowMs = Number(windowMs ?? 12000);
  if (!Number.isSafeInteger(windowMs) || windowMs < 5000 || windowMs > 40000)
    throw new Error("Invalid windowMs (5000..40000)");
  let selected;
  if (only !== undefined) {
    selected = String(only).split(",");
    if (
      new Set(selected).size !== selected.length ||
      !selected.every((id) => MEASUREMENT_SCENARIOS.some((s) => s.id === id))
    )
      throw new Error("Unknown or repeated measurement scenario");
  }
  const scenarios = MEASUREMENT_SCENARIOS.filter(
    (s) => !selected || selected.includes(s.id),
  );
  // Each scenario: its window plus set-up, report grace and close.
  const expectedMs = scenarios.reduce(
    (total, s) =>
      total +
      (s.longWindow ? Math.min(60000, windowMs * 2.5) : windowMs) +
      12000,
    15000,
  );
  return {
    windowMs,
    only: selected,
    scenarios: scenarios.map((s) => s.id),
    expectedMs,
  };
}

// Key order differs between the native serializer and this file.
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const sameJson = (left, right) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const HIDDEN_VIEW_SLOTS = [
  "a-hidden-after-attach",
  "b-born-hidden-1x1",
  "b-born-hidden-1280x800",
];
const LAYOUT_BOXES = ["form", "username", "password", "submit", "fluid"];
const KEY_COUNTS = [
  "keydown",
  "trustedKeydown",
  "beforeinput",
  "input",
  "trustedInput",
  "focusedDocument",
  "hiddenDocument",
  "activeTarget",
  "firstAtMs",
  "lastAtMs",
  "medianGapMs",
  "maxGapMs",
];

/**
 * Build the M1-M8 matrix from one native measurement report. A row is MEASURED
 * only when every observation it needs is present and its condition was
 * established natively; otherwise it carries reasons and no value. Nothing is
 * inferred, and a login that did not complete is a result, not a failure.
 */
export function assessMeasurementReport(report) {
  const measurements = report?.measurements;
  const usable =
    report?.schema === 1 &&
    report.engine === "cef" &&
    report.bindingPin === "154.3.0" &&
    report.mode === "measure" &&
    report.productionReady === false &&
    measurements?.schema === 1 &&
    Array.isArray(measurements.scenarios) &&
    sameJson(measurements.plan, MEASUREMENT_SCENARIOS);
  const scenarios = new Map();
  for (const scenario of usable ? measurements.scenarios : [])
    if (typeof scenario?.id === "string" && !scenarios.has(scenario.id))
      scenarios.set(scenario.id, scenario);
  const planned = new Map(
    MEASUREMENT_SCENARIOS.flatMap((scenario) =>
      scenario.slots.map((slot) => [slot.id, { scenario, slot }]),
    ),
  );
  // One slot's window-complete page report plus its native conditions. The
  // native view must have been in the planned state when its page was
  // requested: Hidden with its child window hidden, or Attached and shown.
  const observe = (id, reasons) => {
    const plan = planned.get(id);
    const scenario = scenarios.get(plan?.scenario.id);
    const slot = Array.isArray(scenario?.slots)
      ? scenario.slots.find((entry) => entry?.id === id)
      : undefined;
    if (scenario?.skipped) {
      reasons.push(`${id}: scenario skipped (${scenario.skipped})`);
      return null;
    }
    if (!slot) {
      reasons.push(`${id}: scenario did not run`);
      return null;
    }
    if (scenario.navigated !== true || slot.navigated !== true) {
      reasons.push(`${id}: navigation was not admitted`);
      return null;
    }
    const hidden = ["hidden-after-attach", "born-hidden"].includes(
      plan.slot.presentation,
    );
    const lifecycle = hidden ? "Hidden" : "Attached";
    if (slot.lifecycleAtNavigation !== lifecycle) {
      reasons.push(`${id}: native view was not ${lifecycle} at navigation`);
      return null;
    }
    const child = slot.childWindow?.atNavigation;
    if (child?.known === true && child.styleVisible !== !hidden) {
      reasons.push(
        `${id}: native child window was ${hidden ? "shown" : "hidden"} at navigation`,
      );
      return null;
    }
    const page = slot.reports?.final;
    if (page?.kind !== "final" || page.slot !== id) {
      reasons.push(`${id}: no window-complete page report`);
      return null;
    }
    return {
      plan: plan.slot,
      slot,
      page,
      scenario,
      shell: scenario.windowState ?? {},
    };
  };
  const collect = (ids, reasons, read) =>
    Object.fromEntries(
      ids.map((id) => {
        const seen = observe(id, reasons);
        return [id, seen ? read(id, seen) : null];
      }),
    );
  const shellAt = (state) =>
    state?.supported === true
      ? {
          visible: state.visible,
          minimized: state.minimized,
          foreground: state.foreground,
          // An estimate from the Z order, not Chromium's own occlusion state.
          exposedPermille: state.exposedPermille,
          coveringWindows: state.coveringWindows,
          coveringOwnWindows: state.coveringOwnWindows,
          decoyCovers: state.decoy?.coversFixture === true,
        }
      : null;
  const outcome = ({ slot, page }) => {
    const completed =
      page.login?.submitted === true && page.login.valuesMatch === true;
    const features = Array.isArray(slot.native?.features)
      ? slot.native.features.filter((entry) => entry?.bootstrap !== true)
      : [];
    return {
      completed,
      submitted: page.login?.submitted === true,
      // Page clock, from the start of the fixture script to its submit event.
      completionMs: completed ? page.login.submittedAtMs : null,
      usernameLength: page.login?.usernameLength ?? null,
      passwordLength: page.login?.passwordLength ?? null,
      // Native clock, from the navigation call to the page's login report.
      navigationToLoginReportMs: slot.navigationToLoginReportMs ?? null,
      lastFeature: features.at(-1)?.status ?? null,
      credentialCalls: slot.native?.credentialCalls ?? null,
    };
  };
  const cadence = (id, reasons, page) => {
    if (
      !Array.isArray(page.timer?.ticksPerSecond) ||
      !Array.isArray(page.animationFrame?.framesPerSecond)
    ) {
      reasons.push(`${id}: timer or frame cadence not reported`);
      return null;
    }
    return {
      requestedMs: page.timer.requestedMs,
      ticksPerSecond: page.timer.ticksPerSecond,
      medianMs: page.timer.medianMs,
      p95Ms: page.timer.p95Ms,
      maxMs: page.timer.maxMs,
      framesPerSecond: page.animationFrame.framesPerSecond,
      frameCount: page.animationFrame.count,
      messageTasks: page.messageTasks?.runs ?? null,
    };
  };
  const keyRow = (row) =>
    Object.fromEntries(KEY_COUNTS.map((key) => [key, row?.[key] ?? null]));
  // One capacity scenario: what the relay counted, what the fixture held and
  // what the page saw. `capped` says whose cap the scenario is about: the
  // fixture's own small one, which the page must exceed, or the default.
  const capacityOf = (id, capped, reasons) => {
    const scenario = scenarios.get(id);
    const capacity = scenario?.capacity;
    if (scenario?.navigated !== true || !capacity) {
      reasons.push(`${id}: scenario did not run`);
      return null;
    }
    const requested = {
      sockets: capacity.requested?.sockets,
      holds: capacity.requested?.holdsPerHost * capacity.requested?.holdHosts,
    };
    if (
      !Number.isSafeInteger(capacity.relay?.capacityRefusals) ||
      !Number.isSafeInteger(capacity.relayMaxClients)
    )
      reasons.push(`${id}: relay diagnostics not reported`);
    else if ((capacity.relayCapExplicit === true) !== capped)
      reasons.push(
        `${id}: the relay's cap was ${capped ? "not set by the fixture" : "not its default"}`,
      );
    else if (
      capped &&
      !(requested.sockets + requested.holds > capacity.relayMaxClients)
    )
      reasons.push(
        `${id}: requested connections did not exceed the relay limit`,
      );
    if (
      !(capacity.fixture?.socketsAccepted + capacity.fixture?.holdsAccepted > 0)
    )
      reasons.push(`${id}: no long-lived connection reached the fixture`);
    return {
      requested,
      relayMaxClients: capacity.relayMaxClients,
      relayCapExplicit: capacity.relayCapExplicit === true,
      capacityRefusals: capacity.relay?.capacityRefusals,
      acceptedConnections: capacity.relay?.acceptedConnections,
      authenticationChallenges: capacity.relay?.authenticationChallenges,
      authenticatedRequests: capacity.relay?.authenticatedRequests,
      upstreamFailures: capacity.relay?.upstreamFailures,
      requestRejections: capacity.relay?.requestRejections,
      relayState: capacity.relay?.state,
      heldPeak: capacity.fixture?.heldPeak,
      socketsAccepted: capacity.fixture?.socketsAccepted,
      holdsAccepted: capacity.fixture?.holdsAccepted,
      // What the page saw; absent when its report could not get through.
      page: scenario.slots?.[0]?.reports?.final?.capacity ?? null,
    };
  };
  const row = (id, title, build) => {
    const reasons = [];
    const value = usable ? build(reasons) : null;
    if (!usable)
      reasons.push(
        "no measurement report from the pinned native client with this runner's scenario table",
      );
    const measured = reasons.length === 0;
    return {
      id,
      title,
      status: measured ? "MEASURED" : "NOT MEASURED",
      reasons,
      value: measured ? value : null,
    };
  };

  const rows = [
    row("M1", "document.visibilityState in a hidden native view", (reasons) =>
      collect(
        ["baseline-visible", ...HIDDEN_VIEW_SLOTS],
        reasons,
        (id, { slot, page, shell }) => {
          const seen = page.visibility;
          if (
            typeof seen?.initial !== "string" ||
            typeof seen.current !== "string"
          ) {
            reasons.push(`${id}: visibility not reported`);
            return null;
          }
          return {
            initial: seen.initial,
            final: seen.current,
            documentHidden: seen.hidden,
            initialHasFocus: seen.initialHasFocus,
            hasFocus: seen.hasFocus,
            // Page clock; the native flip time counts from the navigation call.
            changes: seen.changes,
            lifecycleAtNavigation: slot.lifecycleAtNavigation,
            childWindowShown: slot.childWindow?.atNavigation?.styleVisible,
            flip: slot.flip ?? null,
            lifecycleAtEnd: slot.lifecycleAtEnd,
            shell: shellAt(shell.atNavigation),
            everForeground: shell.everForeground ?? null,
            // Any window of the fixture's process, not only the fixture
            // window; absent from reports of clients that did not record it.
            processForeground: shell.foregroundOwnedByFixtureProcess,
          };
        },
      ),
    ),
    row(
      "M2",
      "timer and requestAnimationFrame cadence in a hidden native view",
      (reasons) =>
        collect(
          ["baseline-visible", ...HIDDEN_VIEW_SLOTS],
          reasons,
          (id, { slot, page }) => {
            const value = cadence(id, reasons, page);
            return value && { ...value, flip: slot.flip ?? null };
          },
        ),
    ),
    row(
      "M3",
      "key events reaching the target frame when hidden and after set_focus(0)",
      (reasons) =>
        collect(
          [
            "baseline-visible",
            ...HIDDEN_VIEW_SLOTS,
            "b-born-hidden-generic",
            "c-visible-input-blocked",
          ],
          reasons,
          (id, seen) => {
            const { plan, slot, page } = seen;
            if (
              !Number.isSafeInteger(page.keys?.username?.input) ||
              !Number.isSafeInteger(page.keys.password?.input)
            ) {
              reasons.push(`${id}: key events not reported`);
              return null;
            }
            if (
              (id === "c-visible-input-blocked") !==
              (slot.inputBlockedRequested === true)
            ) {
              reasons.push(`${id}: input-blocked state was not as planned`);
              return null;
            }
            return {
              adapter: plan.adapter,
              lifecycleAtNavigation: slot.lifecycleAtNavigation,
              inputBlockedRequested: slot.inputBlockedRequested === true,
              focusAccepted: slot.focusAccepted ?? null,
              username: keyRow(page.keys.username),
              password: keyRow(page.keys.password),
              otherKeyEvents: page.keys.other,
              hasFocus: page.visibility?.hasFocus,
              ...outcome(seen),
            };
          },
        ),
    ),
    row("M4", "1x1 view against 1280x800: fixture login layout", (reasons) => {
      const sizes = { "1x1": [1, 1], "1280x800": [1280, 800] };
      const layouts = {};
      const completed = {};
      for (const [name, [width, height]] of Object.entries(sizes)) {
        const id = `b-born-hidden-${name}`;
        const seen = observe(id, reasons);
        if (!seen) continue;
        if (seen.slot.width !== width || seen.slot.height !== height)
          reasons.push(`${id}: view was not created at ${name}`);
        else if (!Number.isFinite(seen.page.layout?.innerWidth))
          reasons.push(`${id}: layout not reported`);
        else {
          layouts[name] = seen.page.layout;
          completed[name] = outcome(seen).completed;
        }
      }
      if (reasons.length) return null;
      const differences = ["compactQuery", "compactShown"].filter(
        (key) => layouts["1x1"][key] !== layouts["1280x800"][key],
      );
      for (const box of LAYOUT_BOXES)
        for (const key of ["width", "height", "visible", "inViewport"])
          if (layouts["1x1"][box]?.[key] !== layouts["1280x800"][box]?.[key])
            differences.push(`${box}.${key}`);
      return {
        changed: differences.length > 0,
        differences,
        loginCompleted: completed,
        ...layouts,
      };
    }),
    row(
      "M5",
      "three concurrent logins, one visible and two hidden",
      (reasons) =>
        collect(
          ["d-visible", "d-hidden-after-attach", "d-born-hidden"],
          reasons,
          (_, seen) => ({
            presentation: seen.plan.presentation,
            ...outcome(seen),
          }),
        ),
    ),
    row(
      "M6",
      "login while the top-level fixture window is not foreground",
      (reasons) =>
        Object.fromEntries(
          ["e-inactive", "e-covered", "e-minimized-hidden"].map((id) => {
            const seen = observe(id, reasons);
            if (!seen) return [id, null];
            const { slot, page } = seen;
            const moments = [seen.shell.atNavigation, seen.shell.atEnd];
            if (!moments.every((state) => state?.supported === true))
              reasons.push(`${id}: window state was not observed`);
            else if (
              !moments.every((state) => state.foreground === false) ||
              seen.shell.everForeground !== false
            )
              reasons.push(`${id}: fixture window was foreground`);
            else if (seen.shell.foregroundOwnedByFixtureProcess)
              reasons.push(
                `${id}: a window of the fixture process was foreground (${seen.shell.foregroundOwnedByFixtureProcess})`,
              );
            else if (
              id === "e-inactive" &&
              !moments.every(
                (state) => state.visible === true && state.minimized === false,
              )
            )
              reasons.push(`${id}: fixture window was not shown`);
            else if (
              id === "e-covered" &&
              !moments.every(
                (state) =>
                  state.decoy?.coversFixture === true &&
                  state.exposedPermille === 0,
              )
            )
              reasons.push(`${id}: fixture window was not shown to be covered`);
            else if (
              id === "e-minimized-hidden" &&
              !moments.every((state) => state.minimized === true)
            )
              reasons.push(`${id}: fixture window was not minimized`);
            return [
              id,
              {
                shellAtNavigation: shellAt(seen.shell.atNavigation),
                shellAtEnd: shellAt(seen.shell.atEnd),
                lifecycleAtNavigation: slot.lifecycleAtNavigation,
                initialVisibility: page.visibility?.initial,
                visibility: page.visibility?.current,
                hasFocus: page.visibility?.hasFocus,
                ticksPerSecond: page.timer?.ticksPerSecond,
                framesPerSecond: page.animationFrame?.framesPerSecond,
                usernameInput: page.keys?.username?.input,
                passwordInput: page.keys?.password?.input,
                ...outcome(seen),
              },
            ];
          }),
        ),
    ),
    row(
      "M7",
      "52 concurrent connections through one relay with its default client cap",
      (reasons) => capacityOf("f-relay-capacity", false, reasons),
    ),
    row(
      "M8",
      "relay capacity_refusals above a client cap set by the fixture",
      (reasons) => capacityOf("f-relay-capacity-capped", true, reasons),
    ),
  ];
  const measured = rows.filter((entry) => entry.status === "MEASURED").length;
  return {
    rows,
    measured,
    complete: measured === rows.length,
    productionReady: false,
    actualCefAcceptance: false,
  };
}

/** Plain-text matrix. An unmeasured row prints its reasons and nothing else. */
export function formatMeasurementMatrix(assessment) {
  const list = (values) =>
    Array.isArray(values) ? `[${values.join(",")}]` : "not reported";
  const flip = (v) =>
    v.flip ? ` ${v.flip.kind}@${v.flip.atMs}ms(native clock)` : "";
  const result = (v) =>
    `completed=${v.completed} completionMs=${v.completionMs} typed=${v.usernameLength}+${v.passwordLength} lastFeature=${v.lastFeature}`;
  const keys = (name, k) =>
    `${name}: keydown=${k.keydown} input=${k.input} trusted=${k.trustedInput} whileHidden=${k.hiddenDocument} documentFocused=${k.focusedDocument} medianGap=${k.medianGapMs}ms maxGap=${k.maxGapMs}ms`;
  const shell = (s) =>
    s
      ? `foreground=${s.foreground} minimized=${s.minimized} exposed=${s.exposedPermille}/1000 coveredBy=${s.coveringWindows}(own ${s.coveringOwnWindows}) decoyCovers=${s.decoyCovers}`
      : "window state not observed";
  const each = (value, describe) =>
    Object.entries(value).map(([id, v]) => `   ${id}: ${describe(v)}`);
  const capacityLines = (value) => [
    `   capacity_refusals=${value.capacityRefusals} requested=${value.requested.sockets + value.requested.holds} (${value.requested.sockets} sockets + ${value.requested.holds} holds) relayMaxClients=${value.relayMaxClients} (${value.relayCapExplicit ? "set by the fixture" : "default"}) relayAccepted=${value.acceptedConnections} fixtureHeldPeak=${value.heldPeak} (sockets ${value.socketsAccepted}, holds ${value.holdsAccepted})`,
    `   page: ${value.page ? `sockets open=${value.page.sockets?.open} error=${value.page.sockets?.error}; holds failed same-host=${value.page.holds?.sameHost?.failed} other-host=${value.page.holds?.otherHost?.failed}` : "no report"}`,
  ];
  const detail = {
    M1: (value) =>
      each(
        value,
        (v) =>
          `native=${v.lifecycleAtNavigation} childShown=${v.childWindowShown} initial=${v.initial} final=${v.final} hasFocus=${v.initialHasFocus}->${v.hasFocus} everForeground=${v.everForeground} processForeground=${v.processForeground === undefined ? "not recorded" : (v.processForeground ?? "never")} changes=${list((v.changes ?? []).map((c) => `${c.state}@${c.atMs}ms`))}${flip(v)} | ${shell(v.shell)}`,
      ),
    M2: (value) =>
      each(
        value,
        (v) =>
          `timer(${v.requestedMs}ms)/s=${list(v.ticksPerSecond)} median=${v.medianMs}ms p95=${v.p95Ms}ms max=${v.maxMs}ms frames/s=${list(v.framesPerSecond)} messageTasks(50 round trips)=${list((v.messageTasks ?? []).map((r) => `${r.totalMs}ms/${r.visibility}`))}${flip(v)}`,
      ),
    M3: (value) =>
      each(
        value,
        (v) =>
          `${v.adapter} native=${v.lifecycleAtNavigation} blocked=${v.inputBlockedRequested} | ${keys("username", v.username)} | ${keys("password", v.password)} | ${result(v)}`,
      ),
    M4: (value) => [
      `   changed=${value.changed} differences=${value.differences.join(",") || "none"}`,
      ...["1x1", "1280x800"].map(
        (name) =>
          `   ${name}: inner=${value[name].innerWidth}x${value[name].innerHeight} compact=${value[name].compactShown} usernameInViewport=${value[name].username?.inViewport} loginCompleted=${value.loginCompleted[name]}`,
      ),
    ],
    M5: (value) => each(value, (v) => `${v.presentation} ${result(v)}`),
    M6: (value) =>
      each(
        value,
        (v) =>
          `${shell(v.shellAtNavigation)} | native=${v.lifecycleAtNavigation} visibility=${v.initialVisibility}->${v.visibility} hasFocus=${v.hasFocus} timer/s=${list(v.ticksPerSecond)} | ${result(v)}`,
      ),
    M7: (value) => capacityLines(value),
    M8: (value) => capacityLines(value),
  };
  const lines = [
    "Real-engine measurements (local synthetic fixtures; not acceptance)",
  ];
  for (const entry of assessment.rows) {
    lines.push(`${entry.id} ${entry.title}: ${entry.status}`);
    if (entry.status === "MEASURED")
      lines.push(...detail[entry.id](entry.value));
    else lines.push(...entry.reasons.map((reason) => `   ${reason}`));
  }
  lines.push(`measured ${assessment.measured}/${assessment.rows.length}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Context-menu evidence. The native client observes; what K10 and the
// handler's unit tests say should happen is stated here, and the two are
// compared row by row. A difference is a result to report, never a failure of
// the run, and no expectation is ever adjusted to what was observed.
// ---------------------------------------------------------------------------

/**
 * Rows this client must never select: an OS dialog, a top-level window, or
 * the OS clipboard, written (Copy, Cut) or read into the page (both pastes).
 */
export const MENU_NEVER_SELECTED = [
  "Print",
  "Inspect",
  "Developer tools",
  "Copy",
  "Cut",
  "Paste",
  "Paste as plain text",
];

const EDIT_ROWS = [
  "Undo",
  "Redo",
  "Cut",
  "Copy",
  "Paste",
  "Paste as plain text",
  "Delete",
  "Select all",
];
// [label, enabled]; null means K10 and the unit tests state no value.
const withRows = (rows, over) =>
  rows.map(([label, enabled]) => [
    label,
    label in over ? over[label] : enabled,
  ]);
const navigation = (over = {}) =>
  withRows(
    [
      ["Back", false],
      ["Forward", false],
      ["Reload", true],
      ["Stop loading", false],
    ],
    over,
  );
const tail = (over = {}) =>
  withRows(
    [
      ["Print", true],
      ["Inspect", true],
      ["Developer tools", true],
    ],
    over,
  );
const linkRows = (open) => [
  ["Open link in new tab", open],
  ["Copy link address", true],
];
const mediaRows = (kind, open) => [
  [`Open ${kind} in new tab`, open],
  [`Copy ${kind} address`, true],
];
const editRows = (enabled) =>
  EDIT_ROWS.map((label) => [label, label in enabled ? enabled[label] : null]);
// Display order of the policy: link, media, navigation, edit, print, tools.
const offered = ({ link = [], media = [], edit = [], nav = {}, end = {} }) => [
  ...link,
  ...media,
  ...navigation(nav),
  ...edit,
  ...tail(end),
];
const pasteOnly = { Paste: true, "Paste as plain text": true };
const passwordRule = { Cut: false, Copy: false, ...pasteOnly };

const FIXTURE = "https://fixture.test";
const rowsFor = (id, target, rows, point = 1) => ({
  id,
  target,
  point,
  outcome: "native-menu",
  rows: offered(rows),
});
const outcomeFor = (id, target, outcome, point = 2) => ({
  id,
  target,
  point,
  outcome,
});
const command = (id, target, pick, expected = {}) => ({
  id,
  target,
  pick,
  point: 4,
  outcome: "native-menu",
  selected: true,
  ...expected,
});
const setup = (id) => ({ id, point: 0 });

/**
 * Scenarios and steps in run order. Ids, targets and picks mirror PLANS in
 * native_acceptance/src/measure/menu.rs; a tooling test compares the two.
 * Everything else here is the expectation: `outcome` (who answered the
 * right-click), `rows` (K10's rows for the target, with the enabled state the
 * unit tests in cef_context_menu_tests.rs assume), and for a selected row
 * what it must do. "page-handled" is the user's requirement: the page's own
 * menu wins and the engine never asks the host for one.
 */
export const MENU_EVIDENCE_PLAN = [
  {
    id: "menu-main",
    popups: "tabs",
    steps: [
      setup("calibrate"),
      // By keyboard, with nothing focused: the page's own rows.
      { id: "key-first", point: 1, outcome: "native-menu", rows: offered({}) },
      rowsFor("rows-plain", "plain", {}),
      rowsFor("rows-link", "link", { link: linkRows(true) }),
      rowsFor("rows-link-raw", "link-raw", { link: linkRows(true) }),
      rowsFor("rows-link-js", "link-js", { link: linkRows(false) }),
      rowsFor("rows-link-other", "link-other", { link: linkRows(false) }),
      rowsFor("rows-link-http", "link-http", { link: linkRows(false) }),
      // An origin the attempt may load in a frame: K10 states no value.
      rowsFor("rows-link-frame-origin", "link-frame", { link: linkRows(null) }),
      rowsFor("rows-image", "image", { media: mediaRows("image", true) }),
      rowsFor("rows-image-link", "image-link", {
        link: linkRows(true),
        media: mediaRows("image", true),
      }),
      rowsFor("rows-image-data", "image-data", {
        media: mediaRows("image", false),
      }),
      rowsFor("rows-video", "video", { media: mediaRows("video", true) }),
      rowsFor("rows-video-broken", "video-broken", {
        media: mediaRows("video", true),
      }),
      rowsFor("rows-audio", "audio", { media: mediaRows("audio", true) }),
      rowsFor("rows-text", "text", { edit: editRows(pasteOnly) }),
      rowsFor("rows-editable", "editable", { edit: editRows(pasteOnly) }),
      // The unit tests assume the engine reports CAN_PASTE only.
      rowsFor("rows-password-empty", "password-empty", {
        edit: editRows({
          Undo: false,
          Redo: false,
          Delete: false,
          "Select all": false,
          ...passwordRule,
        }),
      }),
      rowsFor("rows-password-filled", "password-filled", {
        edit: editRows(passwordRule),
      }),
      setup("select-word"),
      // Selected page text: CAN_COPY | CAN_SELECT_ALL outside a field.
      rowsFor("rows-selection", "prose", {
        edit: [
          ["Copy", true],
          ["Select all", true],
        ],
      }),
      outcomeFor("own-before", "plain", "native-menu"),
      outcomeFor("own-prevent", "own-prevent", "page-handled"),
      outcomeFor("own-menu", "own-menu", "page-handled"),
      outcomeFor("own-inline", "own-inline", "page-handled"),
      outcomeFor("own-document", "own-document", "page-handled"),
      // A handler that does not prevent the default leaves the native menu.
      outcomeFor("own-passive", "own-passive", "native-menu"),
      outcomeFor("own-stop", "own-stop", "native-menu"),
      outcomeFor("own-mouse", "own-mouse", "native-menu"),
      outcomeFor("own-after", "plain", "native-menu"),
      outcomeFor("frame-plain", "frame-plain", "native-menu"),
      outcomeFor("frame-own", "frame-own", "page-handled"),
      rowsFor("frame-link", "frame-link", { link: linkRows(true) }, 2),
      rowsFor("frame-text", "frame-text", { edit: editRows(pasteOnly) }, 2),
      outcomeFor("frame-after", "frame-plain", "native-menu"),
      outcomeFor("xframe-plain", "xframe-plain", "native-menu"),
      outcomeFor("xframe-own", "xframe-own", "page-handled"),
      // A link inside a frame of another origin: K10 states no Open value.
      rowsFor("xframe-link", "xframe-link", { link: linkRows(null) }, 2),
      outcomeFor("xframe-after", "xframe-plain", "native-menu"),
      setup("focus-key-plain"),
      { id: "key-plain", point: 2, outcome: "native-menu" },
      setup("focus-key-own"),
      { id: "key-own", point: 2, outcome: "page-handled" },
      command("copy-link", "link", "Copy link address", {
        copied: [`${FIXTURE}/menu-target?item=1#part`],
      }),
      // What "the link as the page wrote it" is for an unescaped relative
      // address is not stated anywhere: observed, not compared.
      command("copy-link-raw", "link-raw", "Copy link address", {
        copied: null,
      }),
      command("copy-link-js", "link-js", "Copy link address", {
        copied: ["javascript:void(0)"],
      }),
      command("copy-link-other", "link-other", "Copy link address", {
        copied: ["https://elsewhere.test/menu-target?item=6"],
      }),
      command("copy-image", "image", "Copy image address", {
        copied: [`${FIXTURE}/menu-image.png?i=1`],
      }),
      command("copy-image-in-link", "image-link", "Copy image address", {
        copied: [`${FIXTURE}/menu-image.png?i=2`],
      }),
      command("copy-link-of-image", "image-link", "Copy link address", {
        copied: [`${FIXTURE}/menu-target?item=2`],
      }),
      command("copy-image-data", "image-data", "Copy image address", {
        copied: null,
      }),
      command("copy-video", "video", "Copy video address", {
        copied: [`${FIXTURE}/menu-clip.webm`],
      }),
      command("copy-video-broken", "video-broken", "Copy video address", {
        copied: [`${FIXTURE}/menu-missing.webm`],
      }),
      command("copy-audio", "audio", "Copy audio address", {
        copied: [`${FIXTURE}/menu-tone.wav`],
      }),
      command("copy-frame-link", "frame-link", "Copy link address", {
        copied: [`${FIXTURE}/menu-target?item=3`],
      }),
      command("copy-xframe-link", "xframe-link", "Copy link address", {
        copied: ["https://frame.test/menu-target?item=3"],
      }),
      // Offered but disabled: the probe cannot run it and nothing opens.
      command("open-link-other", "link-other", "Open link in new tab", {
        selected: false,
        tabs: 0,
      }),
      command("open-link-js", "link-js", "Open link in new tab", {
        selected: false,
        tabs: 0,
      }),
      command("open-link", "link", "Open link in new tab", {
        tabs: 1,
        served: "target-1",
      }),
      command("open-image", "image", "Open image in new tab", {
        tabs: 1,
        served: "image-1",
      }),
      command("open-video", "video", "Open video in new tab", { tabs: 1 }),
      command("open-audio", "audio", "Open audio in new tab", { tabs: 1 }),
      // The second origin of the attempt: K10 states no value for it.
      command("open-link-frame-origin", "link-frame", "Open link in new tab", {
        selected: null,
        served: "target-5",
      }),
      setup("close-tabs"),
      command("select-all", "text", "Select all"),
      rowsFor(
        "rows-text-selected",
        "text",
        {
          edit: editRows({ Cut: true, Copy: true, Delete: true, ...pasteOnly }),
        },
        4,
      ),
      command("delete", "text", "Delete", { input: true }),
      command("undo", "text", "Undo", { input: true }),
      command("redo", "text", "Redo", { input: true }),
      command("select-all-password", "password-filled", "Select all"),
      rowsFor(
        "rows-password-selected",
        "password-filled",
        { edit: editRows(passwordRule) },
        4,
      ),
      setup("scroll-down"),
      {
        ...command("scrolled-link", "link-low", "Copy link address", {
          copied: [`${FIXTURE}/menu-target?item=8`],
        }),
        point: 6,
      },
      setup("scroll-up"),
      setup("zoom-in"),
      setup("calibrate-zoomed"),
      {
        ...command("zoomed-link", "link", "Copy link address", {
          copied: [`${FIXTURE}/menu-target?item=1#part`],
        }),
        point: 6,
      },
      {
        ...command("zoomed-frame-link", "frame-link", "Copy link address", {
          copied: [`${FIXTURE}/menu-target?item=3`],
        }),
        point: 6,
      },
      setup("zoom-reset"),
      setup("calibrate-reset"),
      setup("block"),
      outcomeFor("blocked", "link", "host-refused", 3),
      setup("unblock"),
      outcomeFor("unblocked", "link", "native-menu", 3),
      setup("hide"),
      outcomeFor("hidden", "link", "host-refused", 3),
      setup("show"),
      outcomeFor("shown", "link", "native-menu", 3),
      setup("focus-manual"),
      setup("manual-capture"),
      outcomeFor("manual-active", "link", "host-refused", 3),
      setup("manual-cancel"),
      outcomeFor("manual-ended", "link", "native-menu", 3),
      setup("load-second"),
      // Still loading: Stop is available and the host does not print.
      rowsFor(
        "rows-loading",
        "plain",
        {
          nav: { Back: true, "Stop loading": true },
          end: { Print: false },
        },
        4,
      ),
      command("stop", "plain", "Stop loading", { loading: [true, false] }),
      rowsFor("rows-stopped", "plain", { nav: { Back: true } }, 4),
      command("back", "plain", "Back", { served: "page-a" }),
      // While the earlier document is still loading: observed, not compared.
      rowsFor(
        "rows-back-loading",
        "plain",
        {
          nav: { Back: null, Forward: null, "Stop loading": null },
          end: { Print: null },
        },
        4,
      ),
      setup("idle-after-back"),
      rowsFor("rows-after-back", "plain", { nav: { Forward: true } }, 4),
      command("forward", "plain", "Forward", { served: "page-b" }),
      command("stop-forward", "plain", "Stop loading", {
        loading: [true, false],
      }),
      command("reload", "plain", "Reload", { served: "page-b" }),
      command("stop-reload", "plain", "Stop loading", {
        loading: [true, false],
      }),
      setup("revoke"),
      outcomeFor("revoked", "plain", "host-refused", 3),
    ],
  },
  {
    id: "menu-global",
    popups: "block",
    steps: [
      setup("calibrate"),
      outcomeFor("plain-before", "plain", "native-menu"),
      setup("idle-first"),
      // "An idle page with no history": the unit tests have Back disabled.
      rowsFor("rows-first-idle", "plain", {}, 4),
      // What Back does on the first page of a view is not stated anywhere.
      command("back-first-page", "plain", "Back", { selected: null }),
      setup("load-again"),
      // The attempt's popup policy is Block. Four launches found the link
      // row enabled and doing nothing; the handler now reads the view's
      // popup policy, so each of the four rows that would open a tab is
      // shown disabled and cannot be run. History differs by step here, so
      // no value is stated for the navigation rows.
      ...[
        ["link", linkRows(false), "link"],
        ["image", mediaRows("image", false), "media"],
        ["video", mediaRows("video", false), "media"],
        ["audio", mediaRows("audio", false), "media"],
      ].map(([target, rows, group]) =>
        command(
          `open-${target}-popups-blocked`,
          target,
          `Open ${target} in new tab`,
          {
            selected: false,
            tabs: 0,
            rows: offered({
              [group]: rows,
              nav: { Back: null, Forward: null, "Stop loading": null },
            }),
          },
        ),
      ),
      setup("load-global"),
      outcomeFor("global-plain", "plain", "page-handled"),
      outcomeFor("global-link", "link", "page-handled"),
      outcomeFor("global-image", "image", "page-handled"),
      outcomeFor("global-video", "video", "page-handled"),
      outcomeFor("global-text", "text", "page-handled"),
      // The framed document has no handler of its own; an event does not
      // leave its document, so its plain area keeps the native menu.
      outcomeFor("global-frame-plain", "frame-plain", "native-menu"),
      setup("focus-key-global"),
      { id: "key-global", point: 2, outcome: "page-handled" },
      setup("load-plain"),
      outcomeFor("plain-after", "plain", "native-menu"),
    ],
  },
];

const EDIT_FLAGS = [
  "UNDO",
  "REDO",
  "CUT",
  "COPY",
  "PASTE",
  "DELETE",
  "SELECT_ALL",
  "TRANSLATE",
  "EDIT_RICHLY",
];
// The seven bits the policy reads.
const POLICY_EDIT_FLAGS = 127;
const editFlagNames = (flags) =>
  EDIT_FLAGS.filter((_, bit) => flags & (1 << bit)).join("|") || "none";

/**
 * What the handler's unit tests (cef_context_menu_tests.rs) assume the
 * engine reports for a right-click, by step of the first scenario. Only the
 * values named here are compared, and edit flags only on the policy's bits.
 */
const MENU_ENGINE_ASSUMED = {
  "rows-plain": {
    link: "",
    shownLink: "",
    source: "",
    media: "none",
    editable: false,
    editFlags: 0,
  },
  // "None repeats link, as for an ordinary link."
  "rows-link": {
    link: `${FIXTURE}/menu-target?item=1#part`,
    shownLink: `${FIXTURE}/menu-target?item=1#part`,
    media: "none",
  },
  "rows-link-other": {
    link: "https://elsewhere.test/menu-target?item=6",
    shownLink: "https://elsewhere.test/menu-target?item=6",
  },
  "rows-link-http": {
    link: "http://fixture.test/menu-target?item=4",
    shownLink: "http://fixture.test/menu-target?item=4",
  },
  // The tests try both a repeated and a blocked validated link here.
  "rows-link-js": { shownLink: "javascript:void(0)" },
  "rows-image": {
    link: "",
    source: `${FIXTURE}/menu-image.png?i=1`,
    media: "image",
  },
  "rows-image-link": {
    link: `${FIXTURE}/menu-target?item=2`,
    source: `${FIXTURE}/menu-image.png?i=2`,
    media: "image",
  },
  "rows-image-data": { media: "image" },
  "rows-video": { source: `${FIXTURE}/menu-clip.webm`, media: "video" },
  "rows-video-broken": {
    source: `${FIXTURE}/menu-missing.webm`,
    media: "video",
  },
  "rows-audio": { source: `${FIXTURE}/menu-tone.wav`, media: "audio" },
  "rows-text": { editable: true },
  "rows-editable": { editable: true },
  // "Password field: the engine reports CAN_PASTE only."
  "rows-password-empty": { editable: true, editFlags: 16 },
  // "Selected page text: CAN_COPY | CAN_SELECT_ALL outside an editable field."
  "rows-selection": { editable: false, editFlags: 8 | 64 },
};

// What the native client prints when this mode starts, and the handler's one
// line for a command it could not run (an action name, nothing from the page).
const MENU_STDERR_START = "CEF acceptance: context-menu evidence mode";
const MENU_STDERR_LINE =
  /^(?:CEF acceptance: context-menu evidence mode|Native browser context-menu action=[A-Za-z]{1,32} failure=command-unavailable)$/;

const MENU_POINTS = {
  1: "Rows per click target",
  2: "The page's own menu",
  3: "No menu while the host must not show one",
  4: "Commands selected through the probe",
  6: "Scrolled page and zoomed view",
};

/** Who answered one right-click, from the three observations the probe allows. */
export function classifyMenuStep(step) {
  if (step?.notSent) return "not-sent";
  const asked = (step?.requests?.after ?? 0) - (step?.requests?.before ?? 0);
  const shown = Array.isArray(step?.menus) ? step.menus.length : 0;
  if (asked > 0 && shown > 0) return "native-menu";
  if (asked > 0) return "host-refused";
  if (shown > 0) return "inconsistent";
  if (step?.trace?.prevented === true) return "page-handled";
  // The page saw the event and let it through, yet the engine asked nothing.
  if (step?.trace) return "no-request";
  if (step?.mouseOnly) return "no-contextmenu-event";
  return "not-delivered";
}

function compareRows(expected, observed) {
  const differences = [];
  const seen = new Map(observed.map(([label, enabled]) => [label, enabled]));
  const wanted = new Map(expected);
  for (const [label, enabled] of expected) {
    if (!seen.has(label)) differences.push(`row missing: ${label}`);
    else if (enabled !== null && seen.get(label) !== enabled)
      differences.push(
        `${label}: ${seen.get(label) ? "enabled" : "disabled"}, expected ${enabled ? "enabled" : "disabled"}`,
      );
  }
  for (const [label, enabled] of observed)
    if (!wanted.has(label))
      differences.push(
        `row not expected: ${label} (${enabled ? "enabled" : "disabled"})`,
      );
  const order = (rows, other) =>
    rows.map(([label]) => label).filter((label) => other.has(label));
  if (
    JSON.stringify(order(expected, seen)) !==
    JSON.stringify(order(observed, wanted))
  )
    differences.push(
      `row order: ${order(observed, wanted).join(", ")}; expected ${order(expected, seen).join(", ")}`,
    );
  return differences;
}

/**
 * Compare one native menu report with MENU_EVIDENCE_PLAN. Every step keeps
 * its observed values; `differences` lists where they depart from what K10
 * and the unit tests expect. Steps that did not run are listed, not guessed.
 */
export function assessMenuReport(report) {
  const menu = report?.menu;
  // The native plan lists target and pick for a right-click on a target only.
  const comparable = MENU_EVIDENCE_PLAN.map((scenario) => ({
    id: scenario.id,
    popups: scenario.popups,
    steps: scenario.steps.map((step) =>
      step.target === undefined
        ? { id: step.id }
        : { id: step.id, target: step.target, pick: step.pick ?? null },
    ),
  }));
  const usable =
    report?.schema === 1 &&
    report.engine === "cef" &&
    report.bindingPin === "154.3.0" &&
    report.mode === "menu" &&
    report.productionReady === false &&
    menu?.schema === 1 &&
    Array.isArray(menu.scenarios) &&
    sameJson(menu.plan, comparable) &&
    sameJson(menu.neverSelected, MENU_NEVER_SELECTED);
  const scenarios = [];
  for (const plan of MENU_EVIDENCE_PLAN) {
    const native = usable
      ? menu.scenarios.find((scenario) => scenario?.id === plan.id)
      : undefined;
    const steps = [];
    for (const expected of plan.steps) {
      const step = Array.isArray(native?.steps)
        ? native.steps.find((entry) => entry?.id === expected.id)
        : undefined;
      const entry = {
        id: expected.id,
        point: expected.point,
        target: expected.target ?? null,
        pick: expected.pick ?? null,
        ran: step !== undefined,
        differences: [],
      };
      steps.push(entry);
      if (!step || expected.point === 0) {
        if (step) entry.setup = step;
        continue;
      }
      const differ = (text) => entry.differences.push(text);
      entry.outcome = classifyMenuStep(step);
      entry.expectedOutcome = expected.outcome;
      entry.requests =
        (step.requests?.after ?? 0) - (step.requests?.before ?? 0);
      entry.requestWithinMs = step.requestWithinMs ?? null;
      entry.menus = Array.isArray(step.menus) ? step.menus.length : 0;
      entry.page = step.trace
        ? {
            target: step.trace.target,
            prevented: step.trace.prevented,
            handledBy: step.trace.handledBy,
            ownMenu: step.trace.ownMenu,
            trusted: step.trace.trusted,
            button: step.trace.button,
            focus: step.trace.focus,
            visibility: step.trace.visibility,
            docSel: step.trace.docSel ?? null,
            field: step.trace.field ?? null,
          }
        : null;
      entry.mouseOnly = step.mouseOnly != null;
      entry.notSent = step.notSent ?? null;
      entry.rows = (step.menus?.[0] ?? []).map(([, label, enabled]) => [
        label,
        enabled,
      ]);
      entry.rowIds = (step.menus?.[0] ?? []).map(([id]) => id);
      entry.copied = (step.copied ?? []).map((copy) => copy.text);
      entry.tabs = [step.tabs?.before ?? null, step.tabs?.after ?? null];
      entry.served = step.served ?? {};
      entry.loading = step.host?.loading ?? null;
      entry.mainFrame = step.host?.mainFrame ?? null;
      entry.mainDocuments = step.host?.mainDocuments ?? null;
      entry.inputs = (step.pageReports ?? [])
        .filter((seen) => seen?.kind === "input")
        .map((seen) => ({
          target: seen.target,
          inputType: seen.inputType,
          trusted: seen.trusted,
          len: seen.len ?? null,
        }));
      entry.answer = step.answers?.[0] ?? null;
      // What the engine reported for this click, as the policy saw it.
      entry.engine = step.reported?.[0] ?? null;
      entry.sent = step.sent ?? null;
      entry.clipboardWritten =
        step.clipboardSequence?.before != null &&
        step.clipboardSequence.before !== step.clipboardSequence.after;
      entry.notes = step.notes ?? [];
      if (
        expected.target &&
        entry.page &&
        entry.page.target !== expected.target
      )
        differ(
          `the page saw the click on ${entry.page.target}, not ${expected.target}`,
        );
      if (entry.outcome !== expected.outcome)
        differ(`outcome ${entry.outcome}, expected ${expected.outcome}`);
      if (entry.requests > 1 || entry.menus > 1)
        differ(
          `one right-click produced ${entry.requests} requests and ${entry.menus} menus`,
        );
      if (expected.rows && entry.outcome === "native-menu")
        for (const difference of compareRows(expected.rows, entry.rows))
          differ(difference);
      // The point "Inspect" hands to the engine must be where the click was.
      if (entry.engine && entry.sent && expected.target) {
        const [x, y] = entry.engine.point;
        if (Math.abs(x - entry.sent[0]) > 1 || Math.abs(y - entry.sent[1]) > 1)
          differ(
            `the engine reported the click at (${x}, ${y}); it was sent at (${entry.sent[0]}, ${entry.sent[1]}) in view coordinates`,
          );
      }
      const assumed =
        plan.id === "menu-main" ? MENU_ENGINE_ASSUMED[expected.id] : undefined;
      if (assumed && entry.engine)
        for (const [key, value] of Object.entries(assumed)) {
          const seen =
            key === "editFlags"
              ? entry.engine.editFlags & POLICY_EDIT_FLAGS
              : entry.engine[key];
          if (seen !== value)
            differ(
              key === "editFlags"
                ? `engine edit flags ${editFlagNames(seen)}; the unit tests assume ${editFlagNames(value)}`
                : `engine ${key} ${JSON.stringify(seen)}; the unit tests assume ${JSON.stringify(value)}`,
            );
        }
      // The run itself must never write the OS clipboard.
      if (entry.clipboardWritten)
        differ("the OS clipboard sequence number changed during this step");
      if (!expected.pick) continue;
      const selected =
        entry.answer?.handedBack === true && entry.answer.enabled === true;
      entry.selected = selected;
      if (entry.answer && entry.answer.offered !== true)
        differ(`row not offered: ${expected.pick}`);
      if (expected.selected != null && selected !== expected.selected)
        differ(
          `${expected.pick} was ${selected ? "selected" : "not selectable"}, expected ${expected.selected ? "an enabled row" : "a disabled row"}`,
        );
      if (
        Array.isArray(expected.copied) &&
        !sameJson(entry.copied, expected.copied)
      )
        differ(
          `copied ${JSON.stringify(entry.copied)}, expected ${JSON.stringify(expected.copied)}`,
        );
      const opened =
        entry.tabs[0] == null || entry.tabs[1] == null
          ? null
          : entry.tabs[1] - entry.tabs[0];
      if (typeof expected.tabs === "number" && opened !== expected.tabs)
        differ(`tabs opened: ${opened}, expected ${expected.tabs}`);
      if (
        expected.served &&
        selected &&
        (entry.served[expected.served] ?? 0) !== 1
      )
        differ(
          `fixture requests for ${expected.served}: ${entry.served[expected.served] ?? 0}, expected 1`,
        );
      if (
        expected.loading &&
        selected &&
        !sameJson(entry.loading, expected.loading)
      )
        differ(
          `loading ${JSON.stringify(entry.loading)}, expected ${JSON.stringify(expected.loading)}`,
        );
      if (expected.input === true && selected && entry.inputs.length === 0)
        differ("the page reported no input event");
    }
    scenarios.push({
      id: plan.id,
      popups: plan.popups,
      ran: native !== undefined,
      inputNotDelivered: native?.inputNotDelivered === true,
      pageReady: native?.pageReady ?? null,
      steps,
      notRun: steps.filter((step) => !step.ran).map((step) => step.id),
      window: native?.window ?? null,
      clipboard: native?.clipboard ?? null,
      page: native?.page ?? null,
      engineBrowserId: native?.engineBrowserId ?? null,
      childWindowMatched: native?.childWindowMatched ?? null,
      viewUnitsPerCssPixel: native?.viewUnitsPerCssPixel ?? null,
      closed: native?.closed ?? null,
    });
  }
  const all = scenarios.flatMap((scenario) =>
    scenario.steps.map((step) => ({ scenario: scenario.id, ...step })),
  );
  const observed = all.filter((step) => step.ran && step.point !== 0);
  const pageWins = all.filter(
    (step) =>
      step.point !== 0 &&
      MENU_EVIDENCE_PLAN.find((plan) => plan.id === step.scenario).steps.find(
        (expected) => expected.id === step.id,
      ).outcome === "page-handled",
  );
  // The same difference on many steps is one finding: grouped for reading.
  const distinct = new Map();
  for (const step of all)
    for (const difference of step.differences) {
      if (!distinct.has(difference)) distinct.set(difference, []);
      distinct.get(difference).push(`${step.scenario}/${step.id}`);
    }
  return {
    usable,
    scenarios,
    distinctDifferences: [...distinct].map(([difference, steps]) => ({
      difference,
      steps,
    })),
    observedSteps: observed.length,
    plannedSteps: all.filter((step) => step.point !== 0).length,
    differences: all
      .filter((step) => step.differences.length > 0)
      .map((step) => ({
        scenario: step.scenario,
        step: step.id,
        differences: step.differences,
      })),
    // Any window of the client as the desktop's foreground window, in any
    // scenario. `null` when the client did not record it.
    foregroundTaken: scenarios.some(
      (scenario) => scenario.window?.foregroundOwnedByClient === undefined,
    )
      ? null
      : scenarios.some((scenario) =>
          scenario.window.foregroundOwnedByClient.some(
            (change) => change.window,
          ),
        ),
    pageWins: {
      planned: pageWins.length,
      observed: pageWins.filter((step) => step.outcome === "page-handled")
        .length,
      steps: pageWins.map((step) => [
        step.id,
        step.ran ? step.outcome : "not-run",
      ]),
    },
    productionReady: false,
    actualCefAcceptance: false,
  };
}

/** Plain-text evidence, one block per step, grouped by what the step is for. */
export function formatMenuEvidence(evidence) {
  const lines = [
    "Native context menu: real-engine evidence (local synthetic fixtures; not acceptance)",
  ];
  if (!evidence.usable) {
    lines.push(
      "NOT OBSERVED: no menu report from the pinned native client with this runner's plan",
    );
    return lines.join("\n");
  }
  const rows = (list) =>
    list.length
      ? list
          .map(([label, enabled]) => `${enabled ? "+" : "-"}${label}`)
          .join(" ")
      : "(none)";
  for (const scenario of evidence.scenarios) {
    lines.push("");
    lines.push(
      `Scenario ${scenario.id} (popup policy ${scenario.popups}): ${scenario.ran ? "ran" : "DID NOT RUN"}`,
    );
    if (!scenario.ran) continue;
    const window = scenario.window ?? {};
    lines.push(
      `  browser ${scenario.engineBrowserId}, child window matched ${scenario.childWindowMatched}, view units per CSS pixel ${scenario.viewUnitsPerCssPixel}, devicePixelRatio ${scenario.page?.dpr ?? "?"}, document.hasFocus() ${scenario.page?.focus ?? "?"}`,
    );
    lines.push(
      `  fixture window: foreground at start ${window.atStart?.foreground}, at end ${window.atEnd?.foreground}, ever ${window.everForeground}; windows above it at start ${window.atStart?.coveringWindows}`,
    );
    const owned = (window.foregroundOwnedByClient ?? []).filter(
      (change) => change.window,
    );
    lines.push(
      window.foregroundOwnedByClient === undefined
        ? "  foreground owned by a window of the client: not recorded"
        : owned.length === 0
          ? "  foreground owned by a window of the client: never"
          : `  FOREGROUND TAKEN by a window of the client: ${owned.map((change) => `${change.window} at ${change.atMs} ms${change.duringStep ? ` (step ${change.duringStep})` : ""}`).join("; ")}`,
    );
    // Activation and focus inside the client's own UI thread: observable on
    // any desktop, including one where nothing can be foreground.
    for (const seen of window.uiThreadWindows ?? [])
      lines.push(
        `  UI thread at ${seen.atMs} ms${seen.duringStep ? ` (step ${seen.duringStep})` : ""}: active window ${seen.windows?.active ?? "none"}${seen.windows?.active && !seen.windows.activeShown ? " (not shown)" : ""}, focus ${seen.windows?.focus ?? "none"}${seen.windows?.focus ? (seen.windows.focusInsideFixtureWindow ? " inside the fixture window" : " OUTSIDE the fixture window") : ""}`,
      );
    for (const seen of window.otherShownTopLevelWindows ?? [])
      lines.push(
        `  other shown top-level windows of the client at ${seen.atMs} ms${seen.duringStep ? ` (step ${seen.duringStep})` : ""}: ${(seen.windows ?? []).map((other) => `${other.class} ${other.width}x${other.height}${other.topmost ? " topmost" : ""}${other.noActivate ? " no-activate" : ""}`).join("; ") || "none"}`,
      );
    if (scenario.inputNotDelivered)
      lines.push(
        "  STOPPED: five right-clicks in a row reached neither the page nor the engine",
      );
    if (scenario.pageReady === false)
      lines.push("  STOPPED: the fixture page never reported its layout");
    lines.push(
      `  OS clipboard sequence number: ${scenario.clipboard?.sequenceAtStart} at start, ${scenario.clipboard?.sequenceAtEnd} at end`,
    );
    if (scenario.notRun.length)
      lines.push(`  NOT RUN: ${scenario.notRun.join(", ")}`);
    for (const [point, title] of Object.entries(MENU_POINTS)) {
      const steps = scenario.steps.filter(
        (step) => step.ran && String(step.point) === point,
      );
      if (!steps.length) continue;
      lines.push(`  ${point}. ${title}`);
      for (const step of steps) {
        const page = step.page
          ? `page saw ${step.page.target} prevented=${step.page.prevented}${step.page.handledBy ? ` by ${step.page.handledBy}` : ""}${step.page.ownMenu ? " own-menu-drawn" : ""}`
          : step.mouseOnly
            ? "page saw the button but no contextmenu event"
            : "no page report";
        lines.push(
          `    ${step.id}${step.target ? ` [${step.target}]` : ""}: ${step.outcome} | ${step.notSent ? `not sent (${step.notSent})` : page} | engine requests +${step.requests}${step.requestWithinMs != null ? ` within ${step.requestWithinMs} ms` : ""} | probe menus ${step.menus}`,
        );
        if (step.menus > 0) lines.push(`      rows: ${rows(step.rows)}`);
        if (step.engine) {
          const engine = step.engine;
          const seen = [];
          if (engine.link) seen.push(`link_url ${engine.link}`);
          if (engine.shownLink)
            seen.push(`unfiltered_link_url ${engine.shownLink}`);
          if (engine.source) seen.push(`source_url ${engine.source}`);
          seen.push(
            `media ${engine.media}`,
            `editable ${engine.editable}`,
            `edit flags ${engine.editFlags} (${editFlagNames(engine.editFlags)})`,
            `point (${engine.point.join(", ")})${step.sent ? ` sent (${step.sent.join(", ")})` : ""}`,
          );
          lines.push(`      engine: ${seen.join(" | ")}`);
        }
        if (step.pick) {
          const effects = [];
          if (step.copied.length)
            effects.push(`copied ${JSON.stringify(step.copied)}`);
          if (step.tabs[0] != null)
            effects.push(`tabs ${step.tabs[0]} -> ${step.tabs[1]}`);
          const served = Object.entries(step.served)
            .filter(([name]) => name !== "report")
            .map(([name, count]) => `${name} x${count}`);
          if (served.length)
            effects.push(`fixture served ${served.join(", ")}`);
          if (step.loading)
            effects.push(`loading ${step.loading[0]} -> ${step.loading[1]}`);
          if (step.mainFrame && step.mainFrame[0] !== step.mainFrame[1])
            effects.push(`view shows ${step.mainFrame[1]}`);
          if (step.inputs.length)
            effects.push(
              `input ${step.inputs.map((seen) => `${seen.inputType || "?"}${seen.len != null ? ` len=${seen.len}` : ""}`).join(", ")}`,
            );
          lines.push(
            `      ${step.pick}: ${step.selected ? "selected" : step.answer?.offered ? "offered disabled, not run" : "not offered"}${effects.length ? ` | ${effects.join(" | ")}` : ""}`,
          );
        }
        if (step.page?.field)
          lines.push(
            `      field selection ${step.page.field[0]}..${step.page.field[1]} of ${step.page.field[2]}`,
          );
        for (const note of step.notes) lines.push(`      note: ${note}`);
        for (const difference of step.differences)
          lines.push(`      DIFFERENCE: ${difference}`);
      }
    }
  }
  lines.push("");
  lines.push(
    `The page's own menu wins: ${evidence.pageWins.observed} of ${evidence.pageWins.planned} planned cases observed as page-handled (page trace recorded, default prevented, no engine request, probe not called)`,
  );
  for (const [id, outcome] of evidence.pageWins.steps)
    if (outcome !== "page-handled") lines.push(`   ${id}: ${outcome}`);
  lines.push(
    `Never selected: ${MENU_NEVER_SELECTED.join(", ")}. They are observed as rows only.`,
  );
  if (evidence.distinctDifferences.length) {
    lines.push("");
    lines.push("Differences from K10 and the unit tests, grouped:");
    for (const { difference, steps } of evidence.distinctDifferences)
      lines.push(`  ${difference} [${steps.length}: ${steps.join(", ")}]`);
  }
  lines.push(
    `observed ${evidence.observedSteps}/${evidence.plannedSteps} steps; ${evidence.differences.length} with differences`,
  );
  return lines.join("\n");
}

export function inspectNetlog(log) {
  const names = Object.fromEntries(
    Object.entries(log?.constants?.logEventTypes ?? {}).map(([k, v]) => [v, k]),
  );
  const unexpectedDns = [],
    unexpectedSockets = [];
  let events = 0,
    sockets = 0;
  for (const event of log?.events ?? []) {
    events++;
    const name = names[event.type] ?? String(event.type);
    const params = event.params ?? {};
    if (/HOST_RESOLVER.*(JOB|REQUEST)/.test(name)) {
      const host = params.host ?? params.hostname;
      if (
        host &&
        !/^(?:https?:\/\/)?(?:127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
      )
        unexpectedDns.push({ name, host });
    }
    if (
      /^(TCP_CONNECT_ATTEMPT|UDP_CONNECT|SOCKET_CONNECT)$/.test(name) &&
      params.address
    ) {
      sockets++;
      if (!/^(?:127\.0\.0\.1|\[::1\]):\d+$/.test(params.address))
        unexpectedSockets.push({ name, address: params.address });
    }
  }
  return {
    ok:
      events > 0 &&
      sockets > 0 &&
      !unexpectedDns.length &&
      !unexpectedSockets.length,
    events,
    sockets,
    unexpectedDns,
    unexpectedSockets,
    limitation:
      "CEF netlog only; does not attest OS-level absence of all DNS/UDP traffic",
  };
}

/** Correlate CONNECT/407/auth/abort without retaining URLs, realms or headers. */
export function summarizeProxyTrace(log) {
  const names = Object.fromEntries(
    Object.entries(log?.constants?.logEventTypes ?? {}).map(([k, v]) => [v, k]),
  );
  const sockets = new Map(),
    jobs = new Map(),
    auth = new Map(),
    streamControllers = [];
  const fixtureAuthorities = new Set([
    "fixture.test:443",
    "frame.test:443",
    "accounts.google.com:443",
  ]);
  let dropped = 0;
  const get = (id) => {
    if (!Number.isSafeInteger(id)) return undefined;
    if (!sockets.has(id)) {
      if (sockets.size >= 128) {
        dropped++;
        return undefined;
      }
      sockets.set(id, {
        source: id,
        endpoint: "not-observed",
        connects: [],
        responses: [],
        authHandlers: [],
        errors: [],
      });
    }
    return sockets.get(id);
  };
  const push = (list, value) => {
    if (list.length < 16) list.push(value);
    else dropped++;
  };
  for (const event of log?.events ?? []) {
    const name = names[event.type],
      p = event.params ?? {},
      id = event.source?.id;
    if (
      name === "HTTP_STREAM_JOB_CONTROLLER" &&
      typeof p.is_preconnect === "boolean"
    ) {
      let origin = "redacted";
      try {
        const u = new URL(p.url);
        if (
          [
            "https://fixture.test",
            "https://frame.test",
            "https://accounts.google.com",
          ].includes(u.origin)
        )
          origin = u.origin;
      } catch {}
      if (streamControllers.length < 128)
        streamControllers.push({
          source: id,
          origin,
          preconnect: p.is_preconnect,
        });
      else dropped++;
    } else if (
      name === "TCP_CONNECT_ATTEMPT" &&
      typeof p.address === "string"
    ) {
      const socket = get(id);
      if (socket)
        socket.endpoint = /^(127\.0\.0\.1|\[::1\]):\d+$/.test(p.address)
          ? p.address
          : "non-loopback-redacted";
    } else if (
      name === "CONNECT_JOB_SET_SOCKET" &&
      Number.isSafeInteger(p.source_dependency?.id)
    ) {
      if (jobs.size < 256) jobs.set(id, p.source_dependency.id);
    } else if (name === "HTTP_TRANSACTION_SEND_TUNNEL_HEADERS") {
      const socket = get(id);
      if (!socket) continue;
      const match =
        typeof p.line === "string"
          ? /^CONNECT ([^\s]+) HTTP\/1\.[01]\r?\n?$/.exec(p.line)
          : null;
      push(socket.connects, {
        authority: fixtureAuthorities.has(match?.[1]) ? match[1] : "redacted",
        authorizationHeaderPresent:
          Array.isArray(p.headers) &&
          p.headers.some(
            (h) => typeof h === "string" && /^proxy-authorization:/i.test(h),
          ),
      });
    } else if (name === "HTTP_TRANSACTION_READ_TUNNEL_RESPONSE_HEADERS") {
      const socket = get(id);
      if (!socket) continue;
      const line = Array.isArray(p.headers)
        ? p.headers.find(
            (h) =>
              typeof h === "string" &&
              /^HTTP\/\d(?:\.\d)? \d{3}(?: |$)/.test(h),
          )
        : undefined;
      const code = line ? Number(line.split(" ")[1]) : null;
      push(socket.responses, code);
    } else if (
      name === "AUTH_BOUND_TO_CONTROLLER" &&
      Number.isSafeInteger(p.source_dependency?.id)
    ) {
      if (auth.size < 256) auth.set(p.source_dependency.id, id);
      const socket = get(id);
      if (socket)
        push(socket.authHandlers, {
          source: p.source_dependency.id,
          scheme: "not-observed",
          initialized: false,
        });
    } else if (
      name === "AUTH_HANDLER_INIT" ||
      name === "AUTH_HANDLER_CREATE_RESULT"
    ) {
      const socket = sockets.get(auth.get(id));
      const handler = socket?.authHandlers.find((h) => h.source === id);
      if (handler && typeof p.succeeded === "boolean")
        handler.initialized = p.succeeded;
      if (handler && typeof p.scheme === "string")
        handler.scheme = p.scheme.toLowerCase() === "basic" ? "basic" : "other";
    } else if (
      name === "HTTP_PROXY_CONNECT_JOB_CONNECT" &&
      Number.isInteger(p.net_error)
    ) {
      const socket = sockets.get(jobs.get(id));
      if (socket) push(socket.errors, p.net_error);
    }
  }
  const connections = [...sockets.values()].filter((s) => s.connects.length);
  return {
    connections,
    streamControllers,
    dropped,
    summary: {
      tunnels: connections.length,
      challenges407: connections.reduce(
        (n, s) => n + s.responses.filter((v) => v === 407).length,
        0,
      ),
      responses200: connections.reduce(
        (n, s) => n + s.responses.filter((v) => v === 200).length,
        0,
      ),
      authenticatedRequests: connections.reduce(
        (n, s) =>
          n + s.connects.filter((v) => v.authorizationHeaderPresent).length,
        0,
      ),
      aborted: connections.filter((s) => s.errors.includes(-3)).length,
    },
    limitation:
      "Native netlog correlation, not a host callback trace; absent/redacted authorization headers alone do not prove callback rejection. Stream controllers are reported separately: speculative preconnect failures must not be equated with navigation failures.",
  };
}

// Crashed/forced-exit Chromium logs lack the closing array. Preserve their
// negative evidence while never accepting them as a complete observation.
export function decodeNetlog(source) {
  try {
    const log = JSON.parse(source);
    return {
      ...inspectNetlog(log),
      proxyTrace: summarizeProxyTrace(log),
      complete: true,
    };
  } catch {
    const lines = source.trimEnd().split("\n");
    while (lines.length > 1) {
      const prefix = lines.join("\n").replace(/,\s*$/, "");
      try {
        const log = JSON.parse(prefix + "]}");
        return {
          ...inspectNetlog(log),
          proxyTrace: summarizeProxyTrace(log),
          ok: false,
          complete: false,
        };
      } catch {
        lines.pop();
      }
    }
    return { ok: false, complete: false, error: "unreadable native netlog" };
  }
}

export function acceptanceCustomPlan(plan, target, stem) {
  if (
    !plan ||
    plan.runtimeKind !== "custom" ||
    !plan.customRuntime ||
    plan.target !== target
  )
    throw new Error(
      "Acceptance requires a matching prepared custom runtime plan",
    );
  if (
    ![
      "sorng_cef_acceptance",
      "sorng_cef_tls_acceptance",
      "sorng_cef_http2_acceptance",
    ].includes(stem)
  )
    throw new Error("Unknown acceptance client");
  return { ...plan, appName: stem };
}

export function acceptanceBundleRoot(executable) {
  const directory = path.dirname(path.resolve(executable));
  const parent = path.dirname(directory);
  return path.basename(directory) === "MacOS" &&
    path.basename(parent) === "Contents"
    ? path.dirname(parent)
    : directory;
}

export async function stageAcceptance({
  runtime,
  customPlan,
  client,
  helper,
  appPlist,
  output,
  target,
  suite = "legacy",
}) {
  if (!["legacy", "tls", "http2"].includes(suite))
    throw new Error("Unknown acceptance suite");
  const stem =
    suite === "tls"
      ? "sorng_cef_tls_acceptance"
      : suite === "http2"
        ? "sorng_cef_http2_acceptance"
        : "sorng_cef_acceptance";
  if (customPlan) {
    if (runtime) throw new Error("Choose --custom-plan or --runtime, not both");
    const plan = acceptanceCustomPlan(
      JSON.parse(await readFile(customPlan, "utf8")),
      target,
      stem,
    );
    const layout = packageManifest(target, stem);
    if (layout.platform !== "windows" && !helper)
      throw new Error("Custom Unix acceptance staging requires --helper");
    if (layout.platform === "macos" && !appPlist)
      throw new Error("Custom macOS acceptance staging requires --app-plist");
    if (plan.localRuntimeSelection)
      verifyLocalRuntimeSelection(plan.localRuntimeSelection);
    // Reuse the app's SHA-256 inventory, ABI/export and post-copy checks.
    // Never stamp official archive metadata onto locally patched bytes.
    const staging = await stageCustomRuntimePackage({
      plan,
      application: client,
      helper,
      appPlist,
      output,
    });
    if (plan.localRuntimeSelection)
      verifyLocalRuntimeSelection(plan.localRuntimeSelection);
    await writeFile(
      path.join(output, "acceptance-staging.json"),
      JSON.stringify(staging, null, 2),
      { flag: "wx" },
    );
    return {
      executable: path.join(
        output,
        layout.platform === "windows"
          ? `${stem}.exe`
          : layout.platform === "macos"
            ? `Contents/MacOS/${stem}`
            : stem,
      ),
      target,
      suite,
      productionReady: false,
    };
  }
  if (!runtime) throw new Error("Expected --custom-plan or --runtime");
  if (process.platform !== "win32" || target !== "x86_64-pc-windows-msvc")
    throw new Error(
      "Official SDK copying supports Windows x64 only; other targets require a verified custom plan",
    );
  const inspection = await inspectRuntime(runtime, target);
  if (!inspection.ok)
    throw new Error(`Pinned SDK rejected: ${inspection.errors.join("; ")}`);
  const binary = await inspectNativeBinary(client, target, { clientDll: true });
  await mkdir(output, { recursive: false });
  const manifest = packageManifest(target, stem);
  for (const file of new Set([
    ...manifest.runtimeFiles,
    ...inspection.locales,
  ])) {
    const dest = path.join(
      output,
      file === "bootstrap.exe" ? `${stem}.exe` : file,
    );
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(runtime, file), dest, constants.COPYFILE_EXCL);
  }
  await copyFile(
    client,
    path.join(output, `${stem}.dll`),
    constants.COPYFILE_EXCL,
  );
  await writeFile(
    path.join(output, "acceptance-staging.json"),
    JSON.stringify(
      {
        target,
        binary,
        inspection,
        provenance:
          "inspected existing SDK; archive-to-tree provenance remains packaging-lane evidence",
        productionReady: false,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  return {
    executable: path.join(output, `${stem}.exe`),
    target,
    suite,
    productionReady: false,
  };
}

// A window of the client must never reach the desktop a person is working on:
// in one observed launch there a client window held the foreground for about
// 52 seconds. On Windows every suite therefore starts the client on a Win32
// desktop made for the run, and the person's own desktop is used only when
// that is asked for by name.
export const INTERACTIVE_DESKTOP_OPTION = "use-interactive-desktop";
const PRIVATE_DESKTOP_LAUNCHER = fileURLToPath(
  new URL(
    "../src-tauri/crates/sorng-browser-host/tests/native_acceptance/launch-on-private-desktop.ps1",
    import.meta.url,
  ),
);
// The launcher enforces the run's timeout itself; this is how much longer the
// runner waits for the launcher to report before it kills the launcher too.
const PRIVATE_DESKTOP_GRACE_MS = 30000;

export function desktopFor({
  platform,
  interactiveDesktop = "false",
  manual = "false",
}) {
  if (!["true", "false"].includes(interactiveDesktop))
    throw new Error(`--${INTERACTIVE_DESKTOP_OPTION} must be true or false`);
  if (interactiveDesktop === "true") return "interactive";
  if (manual === "true")
    throw new Error(
      `--manual true shows a window to a person and needs --${INTERACTIVE_DESKTOP_OPTION} true`,
    );
  // Elsewhere the caller provides the display, as CI does with xvfb-run.
  return platform === "win32" ? "private" : "caller-provided";
}

export function privateDesktopLaunch({
  executable,
  output,
  timeoutMs,
  token = randomBytes(8).toString("hex"),
}) {
  if (!/^[0-9a-f]{16}$/.test(token))
    throw new Error("Invalid private desktop token");
  // Beside the run directory, which the client must find empty.
  const stdout = path.join(output, "client-stdout.txt");
  const stderr = path.join(output, "client-stderr.txt");
  const result = path.join(output, "private-desktop.json");
  const desktop = `sorng-acceptance-${token}`;
  return {
    command: "pwsh",
    args: [
      "-NoProfile",
      "-File",
      PRIVATE_DESKTOP_LAUNCHER,
      "-Executable",
      executable,
      "-WorkingDirectory",
      path.dirname(executable),
      "-Desktop",
      desktop,
      "-TimeoutMs",
      String(timeoutMs),
      "-StdoutPath",
      stdout,
      "-StderrPath",
      stderr,
      "-Result",
      result,
    ],
    desktop,
    stdout,
    stderr,
    result,
  };
}

/** What the launcher's result must show for a run on a private desktop to count. */
export function assessPrivateDesktop(result) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return ["the private-desktop launcher left no result"];
  const failures = [];
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  if (result.started !== true) {
    const reason = /^[a-z]+(-[a-z]+)*(-\d+)?$/.test(result.error ?? "")
      ? result.error
      : "no reason given";
    return [`the client was not started on a private desktop: ${reason}`];
  }
  if (
    result.foregroundViolation !== false ||
    result.clientForegroundSamples !== 0 ||
    result.clientForegroundOwnerChanges !== 0
  )
    failures.push(
      "a process of the client owned the foreground window of the desktop the run was started from; the run was stopped and does not count",
    );
  if (!count(result.samples) || result.samples === 0)
    failures.push("the desktop the run was started from was never sampled");
  if (
    !count(result.clipboardSequenceBefore) ||
    result.clipboardSequenceBefore !== result.clipboardSequenceAfter ||
    result.clipboardChanges !== 0
  )
    failures.push(
      "the clipboard sequence number changed while the client ran; the run does not count",
    );
  if (result.processesLeftInJob !== 0)
    failures.push(
      "processes of the client outlived it and had to be terminated",
    );
  if (result.desktopClosed !== true || result.desktopGone !== true)
    failures.push("the private desktop was not closed");
  if (result.error)
    failures.push("the private-desktop launcher reported an error");
  return failures;
}

function observeWindowsSandbox({ pid, executable, output, suite }) {
  const observerPath = ["tls", "http2"].includes(suite)
    ? "native_tls_acceptance"
    : "native_acceptance";
  const observer = spawn(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      fileURLToPath(
        new URL(
          `../src-tauri/crates/sorng-browser-host/tests/${observerPath}/observe-windows-sandbox.ps1`,
          import.meta.url,
        ),
      ),
      "-BrowserProcessId",
      String(pid),
      "-Executable",
      executable,
      "-Output",
      path.join(output, "sandbox.json"),
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let observerError = "";
  observer.stderr.on("data", (b) => {
    observerError = (observerError + b).slice(-8192);
  });
  return new Promise((resolve) => {
    observer.once("error", resolve);
    observer.once("exit", resolve);
  }).then(() =>
    writeFile(path.join(output, "sandbox-observer-error.txt"), observerError),
  );
}

export async function runAcceptance({
  executable,
  output,
  timeoutMs,
  suite = "legacy",
  manual = "false",
  interactiveDesktop = "false",
  windowMs,
  only,
  check,
}) {
  if (!["legacy", "tls", "http2", "measure", "menu"].includes(suite))
    throw new Error("Unknown acceptance suite");
  const controlledEnvironment = http2Environment(process.env, suite, check);
  if (
    suite === "http2" &&
    (manual !== "false" || interactiveDesktop !== "false")
  )
    throw new Error("HTTP2 acceptance requires automated isolated execution");
  if (!["true", "false"].includes(manual))
    throw new Error("--manual must be true or false");
  const desktop = desktopFor({
    platform: process.platform,
    interactiveDesktop,
    manual,
  });
  if (suite !== "measure" && (windowMs !== undefined || only !== undefined))
    throw new Error("windowMs and only apply to measure");
  let measurePlan;
  if (suite === "measure") {
    measurePlan = measurementPlan({ windowMs, only });
    timeoutMs ??= Math.min(600000, measurePlan.expectedMs + 60000);
  }
  // Two scenarios of at most five minutes each in the native client.
  if (suite === "menu") timeoutMs ??= 600000;
  // Revision-four TLS acceptance also exercises 1,025 context lifecycles.
  // Keep a finite private-run bound without confusing it with page timeouts.
  timeoutMs = Number(
    timeoutMs ?? (["tls", "http2"].includes(suite) ? 600000 : 90000),
  );
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 600000
  )
    throw new Error("Invalid timeoutMs (1000..600000)");
  executable = path.resolve(executable);
  output = path.resolve(output);
  const bundle = acceptanceBundleRoot(executable);
  let expectedPatchId;
  try {
    const staging = JSON.parse(
      await readFile(path.join(bundle, "acceptance-staging.json"), "utf8"),
    );
    if (staging?.kind === "sorng-cef-custom-package") {
      expectedPatchId = staging.preflight?.bridge?.patchId;
      if (!TLS_SUPPORTED_PATCH_IDS.includes(expectedPatchId))
        throw new Error(
          "Staged custom runtime has no supported bridge revision pin",
        );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (suite === "http2" && expectedPatchId !== TLS_PATCH_ID)
    throw new Error(
      "HTTP2 acceptance requires an exactly staged revision-four runtime",
    );
  await ensureBrowserSandboxAccess({
    bundle,
    appName: path.basename(executable, ".exe"),
  });
  // A fresh parent is mandatory; no existing application/user profile is used.
  await mkdir(output, { recursive: false });
  const run = await mkdtemp(path.join(output, "run-"));
  const runId = randomUUID();
  const env = {
    ...controlledEnvironment,
    SORNG_CEF_ACCEPTANCE_OUTPUT: run,
    SORNG_CEF_ACCEPTANCE_RUN_ID: runId,
    SORNG_CEF_TLS_MANUAL: manual,
  };
  // An inherited variable must never turn an acceptance run into measurements.
  for (const name of MEASUREMENT_VARIABLES) delete env[name];
  if (measurePlan) {
    env.SORNG_CEF_ACCEPTANCE_MODE = "measure";
    env.SORNG_CEF_MEASURE_WINDOW_MS = String(measurePlan.windowMs);
    if (measurePlan.only)
      env.SORNG_CEF_MEASURE_ONLY = measurePlan.only.join(",");
  }
  if (suite === "menu") env.SORNG_CEF_ACCEPTANCE_MODE = "menu";
  if (process.platform === "linux") env.GDK_BACKEND = "x11";
  // On a private desktop the child is the launcher, which starts the client
  // there, enforces the timeout and writes the client's output to files.
  const launch =
    desktop === "private"
      ? privateDesktopLaunch({ executable, output, timeoutMs })
      : undefined;
  const child = spawn(launch?.command ?? executable, launch?.args ?? [], {
    cwd: path.dirname(executable),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    timedOut = false;
  child.stdout.on("data", (b) => {
    stdout = (stdout + b).slice(-65536);
  });
  // The sandbox observer follows the client itself: the launcher names it in
  // its first line.
  const clientPid = launch
    ? new Promise((resolve) => {
        child.stdout.on("data", () => {
          const pid = /^\{"started":true,"pid":(\d+)\}\r?$/m.exec(stdout)?.[1];
          if (pid) resolve(Number(pid));
        });
        child.once("error", () => resolve(undefined));
        child.once("exit", () => resolve(undefined));
      })
    : Promise.resolve(child.pid);
  const observerDone =
    process.platform === "win32"
      ? clientPid.then((pid) =>
          pid
            ? observeWindowsSandbox({ pid, executable, output, suite })
            : undefined,
        )
      : Promise.resolve();
  // Fixed lines of the client and of the menu handler, kept as they arrive:
  // the tail above may lose them, and neither carries page or user text.
  const menuLines = [];
  const keepMenuLines = (lines) => {
    for (const line of lines)
      if (MENU_STDERR_LINE.test(line) && menuLines.length < 64)
        menuLines.push(line);
  };
  let partialLine = "";
  child.stderr.on("data", (b) => {
    stderr = (stderr + b).slice(-65536);
    const lines = (partialLine + b).split(/\r?\n/);
    partialLine = lines.pop().slice(-4096);
    if (!launch) keepMenuLines(lines);
  });
  const timer = setTimeout(
    () => {
      timedOut = true;
      // Killing the launcher closes its job, and with it the whole client.
      if (process.platform === "win32" && child.pid)
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else child.kill();
    },
    launch ? timeoutMs + PRIVATE_DESKTOP_GRACE_MS : timeoutMs,
  );
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  await observerDone;
  let desktopRecord = { kind: desktop };
  const desktopFailures = [];
  if (launch) {
    const text = (file) => readFile(file, "utf8").catch(() => "");
    let result;
    try {
      result = JSON.parse(await readFile(launch.result, "utf8"));
    } catch {}
    desktopFailures.push(...assessPrivateDesktop(result));
    desktopRecord = {
      ...(result && typeof result === "object" ? result : {}),
      kind: desktop,
      launcherExit: exitCode,
      launcherError: stderr.slice(-2048),
    };
    // From here on these describe the client, as they do without a launcher.
    exitCode = result?.started === true ? result.exitCode : null;
    timedOut ||= result?.timedOut === true;
    stdout = (await text(launch.stdout)).slice(-65536);
    const clientErrors = await text(launch.stderr);
    stderr = clientErrors.slice(-65536);
    keepMenuLines(clientErrors.split(/\r?\n/));
  }
  await writeFile(
    path.join(run, "process.json"),
    JSON.stringify(
      { exitCode, timedOut, stdout, stderr, desktop: desktopRecord },
      null,
      2,
    ),
  );
  let native, netlog, sandbox;
  try {
    native = JSON.parse(
      await readFile(path.join(run, "native-report.json"), "utf8"),
    );
  } catch {}
  try {
    netlog = decodeNetlog(
      await readFile(path.join(run, "netlog.json"), "utf8"),
    );
  } catch {}
  // The fixture owns an initially empty run directory. Observer errors can
  // arrive before native startup, so keep observer artifacts in its parent.
  try {
    sandbox = JSON.parse(
      await readFile(path.join(output, "sandbox.json"), "utf8"),
    );
  } catch {}
  if (sandbox?.ok === true && Array.isArray(native?.missingEvidence))
    native.missingEvidence = native.missingEvidence.filter(
      (e) => e !== "renderer-sandbox-token",
    );
  const nativeCrashSummary = await readNativeCrashSummary(
    path.join(run, "cef.log"),
  );
  await writeFile(
    path.join(run, "native-crash-summary.json"),
    JSON.stringify(nativeCrashSummary, null, 2),
    { flag: "wx" },
  );
  if (measurePlan) {
    // Measurements are observations, not a verdict. The matrix is written
    // even for a partial run and only complete rows are marked MEASURED;
    // `ok` says the tool ran cleanly, not that any login completed.
    const matrix = assessMeasurementReport(native);
    const matrixText = formatMeasurementMatrix(matrix);
    const failures = Array.isArray(native?.failures)
      ? [...native.failures]
      : ["native measurement report missing"];
    if (exitCode !== 0 || timedOut)
      failures.push(`native process exit ${exitCode}; timeout=${timedOut}`);
    failures.push(
      ...applyNativeCrashGate({ failures: [] }, nativeCrashSummary).failures,
      ...desktopFailures,
    );
    const report = {
      ok: failures.length === 0,
      measured: matrix.measured,
      complete: matrix.complete,
      matrix,
      matrixText,
      failures,
      run,
      runId,
      suite,
      windowMs: measurePlan.windowMs,
      only: measurePlan.only ?? null,
      exitCode,
      timedOut,
      desktop: desktopRecord,
      // Recorded for context. The public-egress tripwire is the acceptance
      // suite's gate and is not re-litigated by a measurement run.
      netlogOk: netlog?.ok === true,
      unexpectedSockets: netlog?.unexpectedSockets?.length ?? null,
      unexpectedDns: netlog?.unexpectedDns?.length ?? null,
      sandbox,
      nativeCrashSummary,
      platform: process.platform,
      actualCefAcceptance: false,
      publicProviderAcceptance: false,
      productionReady: false,
    };
    await writeFile(
      path.join(output, "measurement-matrix.txt"),
      `${matrixText}\n`,
    );
    await writeFile(
      path.join(output, "measurements.json"),
      JSON.stringify(report, null, 2),
    );
    return report;
  }
  if (suite === "menu") {
    // Evidence, not a verdict: every observed value is kept, and a value
    // that differs from the expectation is listed, never failed. `ok` says
    // the tool ran cleanly.
    const evidence = assessMenuReport(native);
    const evidenceText = formatMenuEvidence(evidence);
    const failures = Array.isArray(native?.failures)
      ? [...native.failures]
      : ["native menu report missing"];
    if (exitCode !== 0 || timedOut)
      failures.push(`native process exit ${exitCode}; timeout=${timedOut}`);
    failures.push(
      ...applyNativeCrashGate({ failures: [] }, nativeCrashSummary).failures,
      ...desktopFailures,
    );
    const report = {
      ok: failures.length === 0,
      observedSteps: evidence.observedSteps,
      plannedSteps: evidence.plannedSteps,
      differences: evidence.differences,
      pageWins: evidence.pageWins,
      foregroundTaken: evidence.foregroundTaken,
      evidence,
      evidenceText,
      failures,
      run,
      runId,
      suite,
      exitCode,
      timedOut,
      desktop: desktopRecord,
      // The client's own start line shows that its stderr reached this
      // runner; the handler prints one line per command it could not run.
      stderrObserved: menuLines.includes(MENU_STDERR_START),
      handlerFailures: menuLines.filter((line) => line !== MENU_STDERR_START),
      netlogOk: netlog?.ok === true,
      unexpectedSockets: netlog?.unexpectedSockets?.length ?? null,
      unexpectedDns: netlog?.unexpectedDns?.length ?? null,
      sandbox,
      nativeCrashSummary,
      platform: process.platform,
      actualCefAcceptance: false,
      publicProviderAcceptance: false,
      productionReady: false,
    };
    await writeFile(
      path.join(output, "menu-evidence.txt"),
      `${evidenceText}\n`,
    );
    await writeFile(
      path.join(output, "menu-evidence.json"),
      JSON.stringify(report, null, 2),
    );
    return report;
  }
  // Independent of positive/negative TLS outcomes and the browser exit code:
  // a crashed/restarted network service must not masquerade as a TLS rejection.
  const assessed = applyNativeCrashGate(
    suite === "tls"
      ? assessNativeTlsReport(native, runId, expectedPatchId)
      : suite === "http2"
        ? assessNativeHttp2Report(native, runId, expectedPatchId, check)
        : assessNativeReport(native, expectedPatchId),
    nativeCrashSummary,
  );
  if (exitCode !== 0 || timedOut)
    assessed.failures.push(
      `native process exit ${exitCode}; timeout=${timedOut}`,
    );
  assessed.failures.push(...desktopFailures);
  if (!netlog?.ok)
    assessed.failures.push(
      "native network log missing or unexpected DNS/socket path",
    );
  if (
    ["tls", "http2"].includes(suite) &&
    process.platform === "win32" &&
    sandbox?.ok !== true
  )
    assessed.failures.push(
      "native Windows renderer sandbox observation missing or rejected",
    );
  let nativeFailureReason;
  try {
    nativeFailureReason = (
      await readFile(path.join(run, "global-proxy-failure.txt"), "utf8")
    ).trim();
  } catch {}
  const report = {
    ...assessed,
    ok: assessed.failures.length === 0,
    run,
    runId,
    suite,
    ...(suite === "http2" ? { check, expectedPatchId } : {}),
    exitCode,
    timedOut,
    desktop: desktopRecord,
    netlog,
    sandbox,
    nativeFailureReason,
    nativeCrashSummary,
    platform: process.platform,
    nativeTlsFixtureAccepted: suite === "tls" && assessed.failures.length === 0,
    nativeHttp2FixtureAccepted:
      suite === "http2" && assessed.failures.length === 0,
    actualCefAcceptance: false,
    publicProviderAcceptance: false,
    productionReady: false,
  };
  await writeFile(
    path.join(output, "acceptance.json"),
    JSON.stringify(report, null, 2),
  );
  return report;
}

async function main(args) {
  const [command, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith("--") || !rest[i + 1])
      throw new Error("Expected --key value");
    options[rest[i].slice(2)] = rest[i + 1];
  }
  if (command === "stage")
    return stageAcceptance({
      ...options,
      customPlan: options["custom-plan"],
      appPlist: options["app-plist"],
    });
  const launch = (suite, rest) => {
    const { [INTERACTIVE_DESKTOP_OPTION]: interactiveDesktop, ...others } =
      rest;
    return runAcceptance({ ...others, suite, interactiveDesktop });
  };
  if (command === "run") return launch(options.suite, options);
  if (command === "run-tls") return launch("tls", options);
  if (command === "run-http2") return launch("http2", options);
  if (command === "measure") {
    const { "window-ms": windowMs, ...rest } = options;
    return launch("measure", { ...rest, windowMs });
  }
  if (command === "menu") return launch("menu", options);
  if (command === "trace") {
    const result = decodeNetlog(await readFile(options.netlog, "utf8"));
    if (options.output)
      await writeFile(options.output, JSON.stringify(result, null, 2), {
        flag: "wx",
      });
    return result;
  }
  throw new Error(
    "Usage: node scripts/cef-browser-acceptance.mjs stage (--custom-plan PREPARED_PLAN_JSON | --runtime OFFICIAL_SDK) --client NATIVE_CLIENT --output NEW_DIR --target TARGET [--helper UNIX_HELPER] [--app-plist MACOS_INFO_PLIST] [--suite tls|http2] | run-http2 --executable PACKAGED_EXECUTABLE --output NEW_DIR --check multiplex|deny|delay|revoke|cross-authority|wss|h1-fallback|permission-churn | run-tls --executable PACKAGED_EXECUTABLE --output NEW_DIR [--manual true] | run --executable LEGACY_EXECUTABLE --output NEW_DIR | measure --executable LEGACY_EXECUTABLE --output NEW_DIR [--window-ms 5000..40000] [--only SCENARIO_ID,...] | menu --executable LEGACY_EXECUTABLE --output NEW_DIR. On Windows every run starts the client on a private desktop; --use-interactive-desktop true puts its windows on the desktop of whoever is using the machine instead. HTTP2 runs are automated and reject the interactive override.",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2))
    .then((result) => {
      if (result.suite === "measure") {
        // The matrix is the product; the full report is in measurements.json.
        const { matrix, matrixText, sandbox, nativeCrashSummary, ...summary } =
          result;
        console.log(matrixText);
        console.log(JSON.stringify(summary, null, 2));
      } else if (result.suite === "menu") {
        // The evidence is the product; the full report is menu-evidence.json.
        const {
          evidence,
          evidenceText,
          sandbox,
          nativeCrashSummary,
          ...summary
        } = result;
        console.log(evidenceText);
        console.log(JSON.stringify(summary, null, 2));
      } else console.log(JSON.stringify(result, null, 2));
      if (result.ok === false) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 2;
    });
}
