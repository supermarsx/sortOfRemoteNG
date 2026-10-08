/** Independent actual-browser gate. Never changes production Ready or trust stores. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { stageCustomRuntimePackage } from "./lib/browser-custom-runtime.mjs";
import { ensureBrowserSandboxAccess } from "./lib/browser-sandbox-access.mjs";
import { verifyLocalRuntimeSelection } from "./lib/browser-local-runtime.mjs";
import { assessStorageIsolation } from "./lib/cef-storage-acceptance.mjs";
import {
  readNativeCrashSummary,
  applyNativeCrashGate,
} from "./lib/cef-native-crash-summary.mjs";

export const TLS_PATCH_ID = "sorng-tls-v2-682c378-1";
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

/** Validate observations, never turn a JSON document into execution provenance. */
export function assessNativeTlsReport(report, runId) {
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
  require(report?.patchId === TLS_PATCH_ID &&
    report?.loadedBridgeVerified === true, "frozen loaded V2 bridge missing");
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

export function assessNativeReport(report) {
  const failures = [...(report?.failures ?? [])];
  const require = (ok, message) => {
    if (!ok) failures.push(message);
  };
  require(report?.schema === 1 &&
    report.engine === "cef" &&
    report.bindingPin === "154.3.0", "pinned native CEF report required");
  require(report?.productionReady ===
    false, "acceptance must not grant production readiness");
  require(report?.nativeTlsAdmission?.patchId === TLS_PATCH_ID &&
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
  if (!["sorng_cef_acceptance", "sorng_cef_tls_acceptance"].includes(stem))
    throw new Error("Unknown acceptance client");
  return { ...plan, appName: stem };
}

export async function stageAcceptance({
  runtime,
  customPlan,
  client,
  output,
  target,
  suite = "legacy",
}) {
  if (!["legacy", "tls"].includes(suite))
    throw new Error("Unknown acceptance suite");
  const stem =
    suite === "tls" ? "sorng_cef_tls_acceptance" : "sorng_cef_acceptance";
  if (process.platform !== "win32" || target !== "x86_64-pc-windows-msvc")
    throw new Error(
      "Use the platform packaging lane to stage Unix/ARM bundles; this copier supports Windows x64 only",
    );
  if (customPlan) {
    if (runtime) throw new Error("Choose --custom-plan or --runtime, not both");
    const plan = acceptanceCustomPlan(
      JSON.parse(await readFile(customPlan, "utf8")),
      target,
      stem,
    );
    if (plan.localRuntimeSelection)
      verifyLocalRuntimeSelection(plan.localRuntimeSelection);
    // Reuse the app's SHA-256 inventory, ABI/export and post-copy checks.
    // Never stamp official archive metadata onto locally patched bytes.
    const staging = await stageCustomRuntimePackage({
      plan,
      application: client,
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
      executable: path.join(output, `${stem}.exe`),
      target,
      suite,
      productionReady: false,
    };
  }
  if (!runtime) throw new Error("Expected --custom-plan or --runtime");
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

export async function runAcceptance({
  executable,
  output,
  timeoutMs,
  suite = "legacy",
  manual = "false",
}) {
  if (!["legacy", "tls"].includes(suite))
    throw new Error("Unknown acceptance suite");
  if (!["true", "false"].includes(manual))
    throw new Error("--manual must be true or false");
  timeoutMs = Number(timeoutMs ?? (suite === "tls" ? 240000 : 90000));
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 600000
  )
    throw new Error("Invalid timeoutMs (1000..600000)");
  executable = path.resolve(executable);
  output = path.resolve(output);
  await ensureBrowserSandboxAccess({
    bundle: path.dirname(executable),
    appName: path.basename(executable, ".exe"),
  });
  // A fresh parent is mandatory; no existing application/user profile is used.
  await mkdir(output, { recursive: false });
  const run = await mkdtemp(path.join(output, "run-"));
  const runId = randomUUID();
  const env = {
    ...process.env,
    SORNG_CEF_ACCEPTANCE_OUTPUT: run,
    SORNG_CEF_ACCEPTANCE_RUN_ID: runId,
    SORNG_CEF_TLS_MANUAL: manual,
  };
  if (process.platform === "linux") env.GDK_BACKEND = "x11";
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let observerDone = Promise.resolve();
  if (process.platform === "win32" && child.pid) {
    const observerPath =
      suite === "tls" ? "native_tls_acceptance" : "native_acceptance";
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
        String(child.pid),
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
    observerDone = new Promise((resolve) => {
      observer.once("error", resolve);
      observer.once("exit", resolve);
    }).then(() =>
      writeFile(path.join(output, "sandbox-observer-error.txt"), observerError),
    );
  }
  let stdout = "",
    stderr = "",
    timedOut = false;
  child.stdout.on("data", (b) => {
    stdout = (stdout + b).slice(-65536);
  });
  child.stderr.on("data", (b) => {
    stderr = (stderr + b).slice(-65536);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === "win32" && child.pid)
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else child.kill();
  }, timeoutMs);
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
  await writeFile(
    path.join(run, "process.json"),
    JSON.stringify({ exitCode, timedOut, stdout, stderr }, null, 2),
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
  // Independent of positive/negative TLS outcomes and the browser exit code:
  // a crashed/restarted network service must not masquerade as a TLS rejection.
  const assessed = applyNativeCrashGate(
    suite === "tls"
      ? assessNativeTlsReport(native, runId)
      : assessNativeReport(native),
    nativeCrashSummary,
  );
  if (exitCode !== 0 || timedOut)
    assessed.failures.push(
      `native process exit ${exitCode}; timeout=${timedOut}`,
    );
  if (!netlog?.ok)
    assessed.failures.push(
      "native network log missing or unexpected DNS/socket path",
    );
  if (suite === "tls" && process.platform === "win32" && sandbox?.ok !== true)
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
    exitCode,
    timedOut,
    netlog,
    sandbox,
    nativeFailureReason,
    nativeCrashSummary,
    platform: process.platform,
    nativeTlsFixtureAccepted: suite === "tls" && assessed.failures.length === 0,
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
    return stageAcceptance({ ...options, customPlan: options["custom-plan"] });
  if (command === "run") return runAcceptance(options);
  if (command === "run-tls") return runAcceptance({ ...options, suite: "tls" });
  if (command === "trace") {
    const result = decodeNetlog(await readFile(options.netlog, "utf8"));
    if (options.output)
      await writeFile(options.output, JSON.stringify(result, null, 2), {
        flag: "wx",
      });
    return result;
  }
  throw new Error(
    "Usage: node scripts/cef-browser-acceptance.mjs stage (--custom-plan PREPARED_PLAN_JSON | --runtime OFFICIAL_SDK) --client DLL --output NEW_DIR --target x86_64-pc-windows-msvc [--suite tls] | run-tls --executable PACKAGED_EXECUTABLE --output NEW_DIR [--manual true] | run --executable LEGACY_EXECUTABLE --output NEW_DIR",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.ok === false) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 2;
    });
}
