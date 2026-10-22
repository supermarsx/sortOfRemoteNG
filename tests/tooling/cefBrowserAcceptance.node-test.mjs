import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import {
  assessNativeReport,
  assessNativeTlsReport,
  assessRegistrationRetirement,
  REGISTRATION_RETIREMENT_CASES,
  assessTlsSocketLedger,
  TLS_PATCH_ID,
  TLS_LEGACY_PATCH_ID,
  TLS_CASES,
  runAcceptance,
  inspectNetlog,
  decodeNetlog,
  summarizeProxyTrace,
  acceptanceCustomPlan,
  acceptanceBundleRoot,
  stageAcceptance,
  MEASUREMENT_SCENARIOS,
  MEASUREMENT_VARIABLES,
  measurementPlan,
  assessMeasurementReport,
  formatMeasurementMatrix,
  MENU_EVIDENCE_PLAN,
  MENU_NEVER_SELECTED,
  INTERACTIVE_DESKTOP_OPTION,
  desktopFor,
  privateDesktopLaunch,
  assessPrivateDesktop,
  classifyMenuStep,
  assessMenuReport,
  formatMenuEvidence,
} from "../../scripts/cef-browser-acceptance.mjs";
import {
  assessStorageIsolation,
  STORAGE_PLAN,
  STORAGE_CONTEXTS,
} from "../../scripts/lib/cef-storage-acceptance.mjs";
import {
  summarizeNativeCrashLog,
  readNativeCrashSummary,
  applyNativeCrashGate,
} from "../../scripts/lib/cef-native-crash-summary.mjs";
import {
  HTTP2_BRIDGE_PATCH_ID,
  PROXY_APPLIED_BRIDGE_PATCH_ID,
} from "../../scripts/lib/browser-custom-runtime.mjs";

test("acceptance metadata stays at the staged bundle root on all platforms", () => {
  const root = path.resolve("fixture-bundle");
  for (const executable of [
    "sorng_cef_tls_acceptance.exe",
    "sorng_cef_tls_acceptance",
    "Contents/MacOS/sorng_cef_tls_acceptance",
  ]) {
    assert.equal(acceptanceBundleRoot(path.join(root, executable)), root);
  }
  assert.equal(
    acceptanceBundleRoot(path.join(root, "unrelated/MacOS/client")),
    path.join(root, "unrelated/MacOS"),
  );
});

test("running a staged macOS client checks its exact bundle-root revision before launching", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cef-acceptance-macos-pin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "Contents/MacOS"), { recursive: true });
  await writeFile(
    path.join(root, "acceptance-staging.json"),
    JSON.stringify({
      kind: "sorng-cef-custom-package",
      preflight: { bridge: { patchId: "unsupported-fixture" } },
    }),
  );
  await assert.rejects(
    runAcceptance({
      executable: path.join(root, "Contents/MacOS/sorng_cef_tls_acceptance"),
      output: path.join(root, "must-not-launch"),
      suite: "tls",
    }),
    /no supported bridge revision pin/,
  );
  assert.equal(existsSync(path.join(root, "must-not-launch")), false);
});

test("custom acceptance preserves the verified plan and changes only the client name", () => {
  const target = "x86_64-pc-windows-msvc";
  const plan = {
    runtimeKind: "custom",
    target,
    appName: "sortOfRemoteNG",
    customRuntime: { sourceLockSha256: "fixture-only" },
    sdk: "prepared",
    archive: "custom.tar.bz2",
  };
  assert.deepEqual(
    acceptanceCustomPlan(plan, target, "sorng_cef_tls_acceptance"),
    { ...plan, appName: "sorng_cef_tls_acceptance" },
  );
  assert.equal(plan.appName, "sortOfRemoteNG");
  for (const invalid of [
    null,
    {},
    { ...plan, runtimeKind: "official" },
    { ...plan, customRuntime: null },
    { ...plan, target: "aarch64-pc-windows-msvc" },
  ])
    assert.throws(
      () => acceptanceCustomPlan(invalid, target, "sorng_cef_tls_acceptance"),
      /matching prepared custom/,
    );
  assert.throws(
    () => acceptanceCustomPlan(plan, target, "../other"),
    /Unknown acceptance client/,
  );
});

test("acceptance never mixes official runtime selection with a custom plan", async () => {
  await assert.rejects(
    stageAcceptance({
      runtime: "official",
      customPlan: "missing-plan.json",
      target: "x86_64-pc-windows-msvc",
    }),
    /not both/,
  );
  await assert.rejects(
    stageAcceptance({ target: "x86_64-pc-windows-msvc" }),
    /Expected --custom-plan or --runtime/,
  );
});

test("Unix acceptance requires its real helper and macOS application metadata before staging", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cef-acceptance-inputs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const planFile = path.join(root, "plan.json");
  for (const target of [
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
  ]) {
    await writeFile(
      planFile,
      JSON.stringify({
        runtimeKind: "custom",
        target,
        customRuntime: { fixtureOnly: true },
      }),
    );
    await assert.rejects(
      stageAcceptance({ customPlan: planFile, target }),
      /requires --helper/,
    );
    if (target.endsWith("apple-darwin")) {
      await assert.rejects(
        stageAcceptance({
          customPlan: planFile,
          target,
          helper: "not-a-binary",
        }),
        /requires --app-plist/,
      );
    }
  }
});

test("missing native evidence cannot become readiness", () => {
  const result = assessNativeReport();
  assert.equal(result.ok, false);
  assert.equal(result.productionReady, false);
  assert.ok(result.failures.some((s) => s.includes("pinned native CEF")));
});
test("partial browser report and explicitly unmeasured gates fail closed", () => {
  const result = assessNativeReport({
    schema: 1,
    engine: "cef",
    bindingPin: "154.3.0",
    productionReady: false,
    missingEvidence: ["sandbox"],
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("unverified: sandbox"));
});
test("empty netlog is not containment evidence", () =>
  assert.equal(inspectNetlog({}).ok, false));

test("production policy evidence requires actual configured readback and both exact stores", () => {
  const store = {
    dictionaryPresent: true,
    exactlyThreeFields: true,
    fixedServers: true,
    productionRejectingEndpoint: true,
    loopbackBypassDisabled: true,
  };
  const policy = {
    reader: "production-runtime",
    configured: true,
    readbackFailed: false,
    system: { ...store },
    global: { ...store },
  };
  const failure = "production network policy readback missing or rejected";
  assert.ok(assessNativeReport({}).failures.includes(failure));
  assert.ok(
    !assessNativeReport({ networkPolicy: policy }).failures.includes(failure),
  );
  for (const bad of [
    { ...policy, configured: false },
    { ...policy, readbackFailed: true },
    { ...policy, reader: "fixture-guard" },
    { ...policy, system: null },
    { ...policy, global: { ...store, productionRejectingEndpoint: false } },
    { ...policy, system: { ...store, loopbackBypassDisabled: false } },
  ])
    assert.ok(
      assessNativeReport({ networkPolicy: bad }).failures.includes(failure),
    );
  // Configuration evidence is not packet containment, login, or readiness.
  assert.equal(assessNativeReport({ networkPolicy: policy }).ok, false);
  assert.equal(
    assessNativeReport({ networkPolicy: policy }).productionReady,
    false,
  );
});
test("netlog detects non-loopback socket and DNS resolution", () => {
  const report = inspectNetlog({
    constants: {
      logEventTypes: { TCP_CONNECT_ATTEMPT: 1, HOST_RESOLVER_MANAGER_JOB: 2 },
    },
    events: [
      { type: 1, params: { address: "127.0.0.1:3456" } },
      { type: 1, params: { address: "192.0.2.1:443" } },
      { type: 2, params: { host: "fixture.test:443" } },
    ],
  });
  assert.equal(report.ok, false);
  assert.equal(report.unexpectedSockets.length, 1);
  assert.equal(report.unexpectedDns.length, 1);
});
test("loopback netlog has narrowly scoped passing evidence, never OS containment", () => {
  const report = inspectNetlog({
    constants: { logEventTypes: { TCP_CONNECT_ATTEMPT: 1 } },
    events: [{ type: 1, params: { address: "127.0.0.1:3456" } }],
  });
  assert.equal(report.ok, true);
  assert.match(report.limitation, /does not attest/);
});
test("truncated native netlog retains violations but cannot pass", () => {
  const result = decodeNetlog(
    '{"constants":{"logEventTypes":{"TCP_CONNECT_ATTEMPT":1}},"events":[\n{"type":1,"params":{"address":"192.0.2.1:443"}},\n',
  );
  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.unexpectedSockets.length, 1);
});
test("unreadable and incomplete clean logs are never passing evidence", () => {
  assert.equal(decodeNetlog("garbage").ok, false);
  assert.equal(decodeNetlog('{"constants":{},"events":[\n').ok, false);
});
test("failed UDP attempts still trip containment even when TCP stayed local", () => {
  const report = inspectNetlog({
    constants: {
      logEventTypes: {
        TCP_CONNECT_ATTEMPT: 1,
        UDP_CONNECT: 2,
        SOCKET_CONNECT: 3,
      },
    },
    events: [
      { type: 1, params: { address: "127.0.0.1:3456" } },
      { type: 2, params: { address: "[2001:db8::1]:443" } },
      { type: 3, params: { address: "[2001:db8::1]:443", net_error: -109 } },
    ],
  });
  assert.equal(report.ok, false);
  assert.equal(report.unexpectedSockets.length, 2);
});
test("CONNECT trace correlates 407, native Basic handler and aborted job without secrets", () => {
  const names = [
    "TCP_CONNECT_ATTEMPT",
    "CONNECT_JOB_SET_SOCKET",
    "HTTP_TRANSACTION_SEND_TUNNEL_HEADERS",
    "HTTP_TRANSACTION_READ_TUNNEL_RESPONSE_HEADERS",
    "AUTH_BOUND_TO_CONTROLLER",
    "AUTH_HANDLER_INIT",
    "AUTH_HANDLER_CREATE_RESULT",
    "HTTP_PROXY_CONNECT_JOB_CONNECT",
  ];
  const event = (name, id, params) => ({
    type: names.indexOf(name),
    source: { id },
    params,
  });
  const result = summarizeProxyTrace({
    constants: {
      logEventTypes: Object.fromEntries(names.map((v, i) => [v, i])),
    },
    events: [
      event(names[0], 34, { address: "127.0.0.1:12345" }),
      event(names[1], 33, { source_dependency: { id: 34 } }),
      event(names[2], 34, {
        line: "CONNECT fixture.test:443 HTTP/1.1\r\n",
        headers: ["Proxy-Authorization: Basic DO-NOT-RETAIN"],
      }),
      event(names[3], 34, {
        headers: [
          "HTTP/1.1 407 Proxy Authentication Required",
          'Proxy-Authenticate: Basic realm="SECRET-REALM"',
          "Set-Cookie: DO-NOT-RETAIN",
        ],
      }),
      event(names[4], 34, { source_dependency: { id: 39 } }),
      event(names[5], 39, { succeeded: true }),
      event(names[6], 39, {
        scheme: "basic",
        origin: "https://user:SECRET@private.test/path?token=SECRET",
      }),
      event(names[7], 33, { net_error: -3 }),
    ],
  });
  assert.deepEqual(result.summary, {
    tunnels: 1,
    challenges407: 1,
    responses200: 0,
    authenticatedRequests: 1,
    aborted: 1,
  });
  assert.equal(result.connections[0].connects[0].authority, "fixture.test:443");
  assert.equal(result.connections[0].authHandlers[0].initialized, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /SECRET|DO-NOT-RETAIN|private\.test|token=/,
  );
});
test("CONNECT trace bounds retained sources and per-source events", () => {
  const event = (id) => ({
    type: 1,
    source: { id },
    params: { line: "CONNECT unknown.test:443 HTTP/1.1\r\n" },
  });
  const result = summarizeProxyTrace({
    constants: { logEventTypes: { HTTP_TRANSACTION_SEND_TUNNEL_HEADERS: 1 } },
    events: [
      ...Array.from({ length: 200 }, (_, id) => event(id)),
      ...Array.from({ length: 40 }, () => event(1)),
    ],
  });
  assert.equal(result.connections.length, 128);
  assert.equal(result.connections[1].connects.length, 16);
  assert.ok(result.dropped > 0);
  assert.doesNotMatch(JSON.stringify(result), /unknown\.test/);
});
test("speculative stream controllers are explicit and do not expose URL secrets", () => {
  const trace = summarizeProxyTrace({
    constants: { logEventTypes: { HTTP_STREAM_JOB_CONTROLLER: 1 } },
    events: [
      {
        type: 1,
        source: { id: 47 },
        params: {
          is_preconnect: true,
          url: "https://fixture.test/private?token=SECRET",
        },
      },
      {
        type: 1,
        source: { id: 48 },
        params: {
          is_preconnect: false,
          url: "https://unknown.test/private?token=SECRET",
        },
      },
    ],
  });
  assert.deepEqual(trace.streamControllers, [
    { source: 47, origin: "https://fixture.test", preconnect: true },
    { source: 48, origin: "redacted", preconnect: false },
  ]);
  assert.doesNotMatch(JSON.stringify(trace), /SECRET|private\?|unknown\.test/);
});

// Deliberate validator input, never runtime evidence or a browser acceptance run.
function syntheticRetirementReport() {
  return {
    ok: true,
    sequentialContexts: 1025,
    peakRegistrations: 1,
    peakRootBytes: 1024,
    finalRegistrations: 0,
    finalRootBytes: 0,
    tokenHighWater: "9007199254741999",
    cases: REGISTRATION_RETIREMENT_CASES.map((name) => ({
      case: name,
      ok: true,
    })),
    browserCreated: false,
    networkProbe: false,
    factoryAbandonFaultInjected: false,
    partitionRecreationFaultInjected: false,
  };
}

function syntheticTlsReport() {
  const report = {
    schema: 2,
    engine: "cef",
    bindingPin: "154.3.0",
    evidenceKind: "native-cef-local-fixture",
    runId: "validator-test-only",
    patchId: TLS_PATCH_ID,
    registrationRetirementCases: syntheticRetirementReport(),
    loadedBridgeVerified: true,
    productionReady: false,
    publicProviderAcceptance: false,
    securitySwitchesClean: true,
    networkPolicyConfigured: true,
    shutdownComplete: true,
    failures: [],
    manualRequested: true,
    manualStatus: "observed",
    cases: TLS_CASES.map((name, index) => {
      const positive = ["manual", "staged", "successor"].includes(name);
      const count = positive ? 3 : 1;
      const sockets = Array.from({ length: count }, (_, i) => ({
        id: index * 10 + i + 1,
        challenge: { context: index + 1, generation: index + 1, id: i + 1 },
        decision: positive
          ? "allow-submitted"
          : name === "cancel"
            ? "cancel"
            : name === "revoke-pending"
              ? "stale-attempt"
              : "deny",
        tlsCompleted: positive,
        httpBytes: positive ? 128 : 0,
        httpBeforeAdmission: 0,
        postRevokeBytes: 0,
        outcome: positive ? "completed" : "tls-error",
      }));
      return {
        name,
        contextToken: index + 1,
        tlsInstalled: true,
        closed: true,
        routeDials: count,
        tlsHandshakes: positive ? count : 0,
        challenges: count,
        heldMs: 350,
        revokeObservedMs: 800,
        httpBeforeAdmission: 0,
        postRevokeBytes: 0,
        proxyAuthorizationLeaked: false,
        unexpectedRoute: false,
        sniExact: true,
        hostHeaderExact: true,
        evidenceExact: true,
        allowDecisionsSubmitted: positive ? count : 0,
        httpRequests: positive ? 3 : 0,
        pulseRequests: positive ? 1 : 0,
        httpBytes: positive ? 384 : 0,
        decisions: count,
        sockets,
        correlation: "unique-leaf-der-per-accepted-socket",
        correlationErrors: 0,
        taskErrors: 0,
        collectorDrained: true,
        overlapPeerToken:
          name === "revoke-pending" ? 9 : name === "successor" ? 8 : 0,
        predecessorPendingAtSuccessor: ["revoke-pending", "successor"].includes(
          name,
        )
          ? 1
          : 0,
        policyMismatch: name.startsWith("wrong-"),
        staleCompletionAttempted: name === "revoke-pending",
        revokedNavigationRejected: true,
        initialCookieEmpty: positive ? true : null,
        grants: positive && name !== "manual" ? ["Identifier", "Password"] : [],
        proof: positive
          ? {
              origin: "https://accounts.google.com",
              secure: true,
              top: true,
              tauriAbsent: true,
              cookieEmpty: true,
              storageEmpty: true,
              login: true,
              nativeCookieSent: true,
              httpOnlyHidden: true,
              trustedSubmit: name === "manual",
            }
          : null,
      };
    }),
  };
  report.storageIsolation = syntheticStorageReport(report.cases[1]);
  return report;
}

function syntheticStorageReport(source) {
  return {
    schema: 1,
    status: "completed",
    runId: "validator-test-only",
    origin: "https://accounts.google.com",
    factory: "production-create-with-tls",
    productionReady: false,
    publicProviderAcceptance: false,
    protocolErrors: 0,
    failures: [],
    identities: {
      sameOwner: true,
      distinctConnections: true,
      reconnectSameOwner: true,
      reconnectSameConnection: true,
      reconnectSameSession: true,
      freshAttempts: true,
    },
    steps: STORAGE_PLAN.map((s, index) => ({
      name: s.name,
      slot: s.slot,
      before: { cookie: s.before, localStorage: s.before, indexedDb: s.before },
      after: { cookie: s.after, localStorage: s.after, indexedDb: s.after },
      initialCookies: { native: s.before, script: s.before },
      sentCookies: { native: s.after, script: s.after },
      passed: true,
      originExact: true,
      secure: true,
      top: true,
      tauriAbsent: true,
      httpOnlyHidden: true,
      liveSlots: index < 8 ? [0, 1] : index === 8 ? [1] : [1, 2],
    })),
    contexts: STORAGE_CONTEXTS.map((name, index) => {
      const c = structuredClone(source);
      c.name = name;
      c.contextToken = 100 + index;
      c.grants = [];
      c.relayStopped = true;
      const requests = STORAGE_PLAN.filter(
        (step) => step.slot === index,
      ).reduce(
        (n, step) => n + 2 + (step.write === null ? 0 : 1),
        c.pulseRequests,
      );
      c.sockets = Array.from({ length: requests }, (_, i) => ({
        ...structuredClone(source.sockets[0]),
        id: 1000 * (index + 1) + i,
        challenge: { context: c.contextToken, generation: 1, id: i + 1 },
      }));
      for (const key of [
        "httpRequests",
        "tlsHandshakes",
        "routeDials",
        "challenges",
        "decisions",
        "allowDecisionsSubmitted",
      ])
        c[key] = requests;
      c.httpBytes = c.sockets.reduce((n, socket) => n + socket.httpBytes, 0);
      return c;
    }),
  };
}

test("a complete synthetic validator input never attests actual CEF or provider acceptance", () => {
  const result = assessNativeTlsReport(
    syntheticTlsReport(),
    "validator-test-only",
  );
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(result.actualCefAcceptance, false);
  assert.equal(result.publicProviderAcceptance, false);
  assert.equal(result.productionReady, false);
  assert.equal(result.nativeTlsFixtureAccepted, undefined);
});

test("TLS reports preserve known legacy compatibility without substituting a staged revision", () => {
  for (const actual of [
    TLS_PATCH_ID,
    PROXY_APPLIED_BRIDGE_PATCH_ID,
    HTTP2_BRIDGE_PATCH_ID,
    TLS_LEGACY_PATCH_ID,
  ]) {
    const report = syntheticTlsReport();
    report.patchId = actual;
    assert.equal(assessNativeTlsReport(report, "validator-test-only").ok, true);
    assert.equal(
      assessNativeTlsReport(report, "validator-test-only", actual).ok,
      true,
    );
    const other = actual === TLS_PATCH_ID ? TLS_LEGACY_PATCH_ID : TLS_PATCH_ID;
    assert.equal(
      assessNativeTlsReport(report, "validator-test-only", other).ok,
      false,
    );
    assert.equal(
      assessNativeTlsReport(report, "validator-test-only", "unreviewed").ok,
      false,
    );
  }
  const unknown = syntheticTlsReport();
  unknown.patchId = "sorng-tls-v2-unreviewed";
  assert.equal(assessNativeTlsReport(unknown, "validator-test-only").ok, false);
});

test("revision four requires bounded real-registry observations while older exact revisions remain compatible", () => {
  const report = syntheticTlsReport();
  delete report.registrationRetirementCases;
  assert.equal(assessNativeTlsReport(report, "validator-test-only").ok, false);
  for (const patchId of [
    PROXY_APPLIED_BRIDGE_PATCH_ID,
    HTTP2_BRIDGE_PATCH_ID,
    TLS_LEGACY_PATCH_ID,
  ]) {
    assert.equal(
      assessNativeTlsReport(
        { ...report, patchId },
        "validator-test-only",
        patchId,
      ).ok,
      true,
    );
  }
});

test("retirement assessment rejects incomplete, unbounded or lossy native observations", () => {
  assert.equal(
    assessRegistrationRetirement(syntheticRetirementReport()).ok,
    true,
  );
  const mutations = [
    (value) => {
      value.ok = false;
    },
    (value) => {
      value.sequentialContexts = 1024;
    },
    (value) => {
      value.peakRegistrations = 3;
    },
    (value) => {
      value.peakRootBytes = 8 * 1024 * 1024 + 1;
    },
    (value) => {
      value.finalRegistrations = 1;
    },
    (value) => {
      value.finalRootBytes = 1;
    },
    (value) => {
      value.tokenHighWater = 9007199254741999;
    },
    (value) => {
      value.tokenHighWater = "18446744073709551616";
    },
    (value) => {
      value.cases.pop();
    },
    (value) => {
      value.cases[0].ok = false;
    },
    (value) => {
      value.cases[0] = value.cases[1];
    },
    (value) => {
      value.browserCreated = true;
    },
    (value) => {
      value.networkProbe = true;
    },
    (value) => {
      delete value.factoryAbandonFaultInjected;
    },
  ];
  for (const mutate of mutations) {
    const value = syntheticRetirementReport();
    mutate(value);
    assert.equal(assessRegistrationRetirement(value).ok, false);
  }
});

test("a custom bundle with an unsupported bridge pin fails before launching or creating run output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cef-bridge-pin-"));
  const output = path.join(root, "not-created");
  try {
    await writeFile(
      path.join(root, "acceptance-staging.json"),
      JSON.stringify({
        kind: "sorng-cef-custom-package",
        preflight: { bridge: { patchId: "sorng-tls-v2-unreviewed" } },
      }),
    );
    await assert.rejects(
      runAcceptance({
        executable: path.join(root, "never-launched.exe"),
        output,
        suite: "tls",
      }),
      /no supported bridge revision pin/,
    );
    assert.equal(existsSync(output), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stock, old, unrelated and replayed reports fail the V2 invocation gate", () => {
  for (const value of [
    undefined,
    {},
    [],
    { schema: 1, engine: "cef", bindingPin: "154.3.0" },
  ]) {
    assert.equal(assessNativeTlsReport(value, "validator-test-only").ok, false);
  }
  for (const mutate of [
    (r) => {
      r.patchId = "sorng-tls-v1";
    },
    (r) => {
      r.loadedBridgeVerified = false;
    },
    (r) => {
      r.evidenceKind = "mock";
    },
    (r) => {
      r.runId = "previous-run";
    },
    (r) => {
      r.schema = 1;
    },
    (r) => {
      r.engine = "jsdom";
    },
    (r) => {
      r.productionReady = true;
    },
    (r) => {
      r.publicProviderAcceptance = true;
    },
    (r) => {
      r.securitySwitchesClean = false;
    },
    (r) => {
      r.networkPolicyConfigured = false;
    },
    (r) => {
      r.shutdownComplete = false;
    },
    (r) => {
      delete r.failures;
    },
    (r) => {
      r.failures.push("native failure");
    },
  ]) {
    const r = syntheticTlsReport();
    mutate(r);
    assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
  }
  assert.equal(assessNativeTlsReport(syntheticTlsReport()).ok, false);
  assert.ok(
    assessNativeReport({}).failures.some((f) => f.includes("legacy SPKI")),
  );
});

test("every required case must have distinct context, actual TLS and bounded observation windows", () => {
  for (const name of TLS_CASES) {
    for (const [field, value] of Object.entries({
      contextToken: 0,
      tlsInstalled: false,
      closed: false,
      routeDials: 0,
      challenges: 0,
      heldMs: 0,
      revokeObservedMs: 0,
      httpBeforeAdmission: 1,
      postRevokeBytes: 1,
      proxyAuthorizationLeaked: true,
      unexpectedRoute: true,
      sniExact: false,
      hostHeaderExact: false,
      evidenceExact: false,
      grants: null,
      httpBytes: "0",
    })) {
      const r = syntheticTlsReport();
      r.cases.find((c) => c.name === name)[field] = value;
      assert.equal(
        assessNativeTlsReport(r, "validator-test-only").ok,
        false,
        `${name}.${field}`,
      );
    }
    const r = syntheticTlsReport();
    r.cases = r.cases.filter((c) => c.name !== name);
    assert.equal(
      assessNativeTlsReport(r, "validator-test-only").ok,
      false,
      name,
    );
  }
  const duplicate = syntheticTlsReport();
  duplicate.cases[1].contextToken = duplicate.cases[0].contextToken;
  assert.equal(
    assessNativeTlsReport(duplicate, "validator-test-only").ok,
    false,
  );
  const duplicateName = syntheticTlsReport();
  duplicateName.cases.push(duplicateName.cases[0]);
  assert.equal(
    assessNativeTlsReport(duplicateName, "validator-test-only").ok,
    false,
  );
});

test("rejection, cancellation, exact-policy mismatch and stale completion require zero HTTP bytes", () => {
  for (const name of TLS_CASES.filter(
    (n) => !["manual", "staged", "successor"].includes(n),
  )) {
    for (const [field, value] of Object.entries({
      httpBytes: 1,
      httpRequests: 1,
      allowDecisionsSubmitted: 1,
      decisions: 0,
      tlsHandshakes: 1,
    })) {
      const r = syntheticTlsReport();
      r.cases.find((c) => c.name === name)[field] = value;
      assert.equal(
        assessNativeTlsReport(r, "validator-test-only").ok,
        false,
        `${name}.${field}`,
      );
    }
    if (name.startsWith("wrong-")) {
      const r = syntheticTlsReport();
      r.cases.find((c) => c.name === name).policyMismatch = false;
      assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
    }
  }
  const r = syntheticTlsReport();
  r.cases.find((c) => c.name === "revoke-pending").staleCompletionAttempted =
    false;
  assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
});

test("manual and staged login require independent origin, disclosure and cookie observations", () => {
  for (const name of ["manual", "staged", "successor"]) {
    for (const [field, value] of Object.entries({
      origin: "http://accounts.google.com",
      secure: false,
      top: false,
      tauriAbsent: false,
      cookieEmpty: false,
      storageEmpty: false,
      login: false,
      nativeCookieSent: false,
      httpOnlyHidden: false,
    })) {
      const r = syntheticTlsReport();
      r.cases.find((c) => c.name === name).proof[field] = value;
      assert.equal(
        assessNativeTlsReport(r, "validator-test-only").ok,
        false,
        `${name}.${field}`,
      );
    }
    for (const [field, value] of Object.entries({
      initialCookieEmpty: false,
      revokedNavigationRejected: false,
      pulseRequests: 0,
    })) {
      const r = syntheticTlsReport();
      r.cases.find((c) => c.name === name)[field] = value;
      assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
    }
  }
  for (const mutate of [
    (c) => {
      c.proof.trustedSubmit = false;
    },
    (c) => {
      c.grants = ["Form"];
    },
  ]) {
    const r = syntheticTlsReport();
    mutate(r.cases[0]);
    assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
  }
  for (const name of ["staged", "successor"]) {
    const r = syntheticTlsReport();
    r.cases.find((c) => c.name === name).grants = ["Identifier"];
    assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
  }
});

test("invalid runner options fail before creating a profile or launching a process", async () => {
  for (const options of [
    { suite: "mock" },
    { manual: "yes" },
    { timeoutMs: "NaN" },
    { timeoutMs: 0 },
    { timeoutMs: 600001 },
    { interactiveDesktop: "yes" },
    { interactiveDesktop: true },
    // A person has to see the manual window: never on a private desktop.
    { manual: "true" },
    { manual: "true", suite: "tls" },
  ]) {
    await assert.rejects(
      runAcceptance({
        executable: "never-launched",
        output: "never-created",
        ...options,
      }),
      /Unknown acceptance suite|--manual|Invalid timeoutMs|--use-interactive-desktop/,
    );
  }
});

test("negative TLS cases pass observation validation with zero completed handshakes", () => {
  const r = syntheticTlsReport();
  for (const c of r.cases.filter(
    (c) => !["manual", "staged", "successor"].includes(c.name),
  )) {
    assert.equal(c.tlsHandshakes, 0);
    assert.equal(c.challenges, 1);
    assert.equal(c.sockets[0].outcome, "tls-error");
    assert.equal(assessTlsSocketLedger(c).ok, true);
  }
  assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, true);
});

test("per-socket validation cannot spend another socket allow decision", () => {
  const c = syntheticTlsReport().cases.find((c) => c.name === "staged");
  // Keep the aggregate allow count and byte totals plausible. One socket is
  // pending/denied while a different, unused allow is present in the inventory.
  c.sockets[0].decision = "deny";
  c.allowDecisionsSubmitted--;
  const result = assessTlsSocketLedger(c);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((s) => s.includes("borrowed")));
});

test("socket correlation rejects unknown contexts, challenge replay and dishonest aggregates", () => {
  for (const mutate of [
    (c) => {
      c.sockets[1].id = c.sockets[0].id;
    },
    (c) => {
      c.sockets[1].challenge = { ...c.sockets[0].challenge };
    },
    (c) => {
      c.sockets[0].challenge.context = 999;
    },
    (c) => {
      c.sockets[0].challenge.generation = 999;
    },
    (c) => {
      c.sockets[0].challenge = null;
    },
    (c) => {
      c.sockets[0].httpBeforeAdmission = 1;
    },
    (c) => {
      c.httpBytes++;
    },
    (c) => {
      c.challenges++;
    },
    (c) => {
      c.allowDecisionsSubmitted++;
    },
    (c) => {
      c.correlationErrors = 1;
    },
    (c) => {
      c.correlation = "aggregate-credit";
    },
    (c) => {
      c.sockets = null;
    },
    (c) => {
      c.sockets[0] = null;
    },
  ]) {
    const c = syntheticTlsReport().cases[1];
    mutate(c);
    assert.equal(assessTlsSocketLedger(c).ok, false);
  }
});

test("collector truncation, task failures, timeouts and cancellation never pass", () => {
  for (const mutate of [
    (c) => {
      c.collectorDrained = false;
    },
    (c) => {
      c.taskErrors = 1;
    },
    ...[null, "timeout", "cancelled", "panic", "unknown"].map(
      (outcome) => (c) => {
        c.sockets[0].outcome = outcome;
      },
    ),
  ]) {
    const c = syntheticTlsReport().cases[1];
    mutate(c);
    assert.equal(assessTlsSocketLedger(c).ok, false);
  }
});

test("a sequential successor or mismatched predecessor cannot claim overlap isolation", () => {
  for (const mutate of [
    (r) => {
      r.cases[7].predecessorPendingAtSuccessor = 0;
    },
    (r) => {
      r.cases[8].predecessorPendingAtSuccessor = 0;
    },
    (r) => {
      r.cases[7].overlapPeerToken = 0;
    },
    (r) => {
      r.cases[8].overlapPeerToken = 0;
    },
    (r) => {
      r.cases[8].overlapPeerToken = r.cases[8].contextToken;
    },
  ]) {
    const r = syntheticTlsReport();
    mutate(r);
    assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
  }
});

test("unattended TLS scope omits only manual input and never claims it passed", () => {
  const r = syntheticTlsReport();
  r.manualRequested = false;
  r.manualStatus = "not-run";
  r.cases = r.cases.filter((c) => c.name !== "manual");
  const assessed = assessNativeTlsReport(r, "validator-test-only");
  assert.equal(assessed.ok, true);
  assert.equal(assessed.manualAcceptance, false);
  assert.deepEqual(assessed.remainingProbes, ["trusted manual input not run"]);
  assert.match(assessed.scope, /automated only/);
  for (const mutate of [
    (r) => {
      r.manualStatus = "observed";
    },
    (r) => {
      r.cases.pop();
    },
    (r) => {
      r.manualRequested = true;
    },
    (r) => {
      delete r.manualRequested;
    },
  ]) {
    const bad = structuredClone(r);
    mutate(bad);
    assert.equal(assessNativeTlsReport(bad, "validator-test-only").ok, false);
  }
});

test("legacy, absent, interrupted, replayed and failed storage probes cannot pass", () => {
  for (const value of [
    undefined,
    {},
    null,
    { status: "not-run" },
    { status: "running" },
  ]) {
    const r = syntheticTlsReport();
    r.storageIsolation = value;
    assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
  }
  for (const mutate of [
    (r) => {
      r.runId = "old";
    },
    (r) => {
      r.status = "failed";
    },
    (r) => {
      r.factory = "stock-create";
    },
    (r) => {
      r.origin = "https://other.test";
    },
    (r) => {
      r.protocolErrors = 1;
    },
    (r) => {
      r.failures = ["deadline"];
    },
    (r) => {
      delete r.failures;
    },
    (r) => {
      r.productionReady = true;
    },
    (r) => {
      r.publicProviderAcceptance = true;
    },
  ]) {
    const r = syntheticTlsReport();
    mutate(r.storageIsolation);
    assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
  }
});

test("each native storage and cookie readback must match both before and after writes", () => {
  for (let index = 0; index < STORAGE_PLAN.length; index++) {
    for (const [container, keys] of [
      ["before", ["cookie", "localStorage", "indexedDb"]],
      ["after", ["cookie", "localStorage", "indexedDb"]],
      ["initialCookies", ["native", "script"]],
      ["sentCookies", ["native", "script"]],
    ]) {
      for (const key of keys) {
        for (const replacement of ["foreign-context", undefined]) {
          const r = syntheticTlsReport();
          r.storageIsolation.steps[index][container][key] = replacement;
          assert.equal(
            assessNativeTlsReport(r, "validator-test-only").ok,
            false,
            `${index}.${container}.${key}`,
          );
        }
      }
    }
    for (const key of [
      "passed",
      "originExact",
      "secure",
      "top",
      "tauriAbsent",
      "httpOnlyHidden",
    ]) {
      const r = syntheticTlsReport();
      r.storageIsolation.steps[index][key] = false;
      assert.equal(
        assessNativeTlsReport(r, "validator-test-only").ok,
        false,
        `${index}.${key}`,
      );
    }
  }
});

test("same-origin live overlap and fresh same-connection reconnect are mandatory", () => {
  for (const key of [
    "sameOwner",
    "distinctConnections",
    "reconnectSameOwner",
    "reconnectSameConnection",
    "reconnectSameSession",
    "freshAttempts",
  ]) {
    const r = syntheticTlsReport();
    r.storageIsolation.identities[key] = false;
    assert.equal(
      assessNativeTlsReport(r, "validator-test-only").ok,
      false,
      key,
    );
  }
  for (const mutate of [
    (r) => {
      r.steps.pop();
    },
    (r) => {
      r.steps.reverse();
    },
    (r) => {
      r.steps[3] = r.steps[2];
    },
    (r) => {
      r.steps[0].liveSlots = [0];
    },
    (r) => {
      r.steps[11].liveSlots = [2];
    },
    (r) => {
      r.steps[9].slot = 0;
    },
    (r) => {
      r.contexts[2].contextToken = r.contexts[0].contextToken;
    },
    (r) => {
      r.contexts.pop();
    },
  ]) {
    const r = syntheticTlsReport();
    mutate(r.storageIsolation);
    assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
  }
  const reused = syntheticTlsReport();
  const context = reused.storageIsolation.contexts[0];
  context.contextToken = reused.cases[0].contextToken;
  for (const socket of context.sockets)
    socket.challenge.context = context.contextToken;
  assert.ok(
    assessNativeTlsReport(reused, "validator-test-only").failures.includes(
      "storage cannot reuse a preceding TLS case context",
    ),
  );
});

test("storage cleanup, route containment and TLS socket ledger remain strict", () => {
  for (let slot = 0; slot < 3; slot++) {
    for (const [key, value] of Object.entries({
      tlsInstalled: false,
      closed: false,
      revokedNavigationRejected: false,
      relayStopped: false,
      collectorDrained: false,
      taskErrors: 1,
      sniExact: false,
      hostHeaderExact: false,
      evidenceExact: false,
      routeDials: 0,
      tlsHandshakes: 0,
      pulseRequests: 0,
      heldMs: 0,
      revokeObservedMs: 0,
      proxyAuthorizationLeaked: true,
      unexpectedRoute: true,
      httpBeforeAdmission: 1,
      postRevokeBytes: 1,
      grants: ["Form"],
    })) {
      const r = syntheticTlsReport();
      r.storageIsolation.contexts[slot][key] = value;
      assert.equal(
        assessNativeTlsReport(r, "validator-test-only").ok,
        false,
        `${slot}.${key}`,
      );
    }
    const r = syntheticTlsReport();
    r.storageIsolation.contexts[slot].sockets[0].decision = "deny";
    assert.equal(assessNativeTlsReport(r, "validator-test-only").ok, false);
  }
  const r = syntheticTlsReport();
  assert.equal(assessStorageIsolation(r.storageIsolation, r.runId).ok, false);
});

test("storage snapshots and writes require sufficient requests and per-socket payload observations", () => {
  const valid = syntheticTlsReport();
  assert.deepEqual(
    valid.storageIsolation.contexts.map((c) => c.httpRequests),
    [11, 14, 8],
  );
  for (let slot = 0; slot < 3; slot++) {
    for (const mutate of [
      (c) => {
        c.httpRequests = 3;
      },
      (c) => {
        c.httpRequests--;
      },
      (c) => {
        c.pulseRequests++;
      },
      (c) => {
        c.httpRequests++;
      },
      (c) => {
        c.sockets[0].httpBytes = 0;
        c.httpBytes = c.sockets.reduce((n, s) => n + s.httpBytes, 0);
      },
    ]) {
      const r = structuredClone(valid);
      mutate(r.storageIsolation.contexts[slot]);
      assert.equal(
        assessNativeTlsReport(r, r.runId).ok,
        false,
        `context ${slot}`,
      );
    }
    // More completed non-probe requests are legitimate; do not impose an
    // exact snapshot/request equality on pulses, retries or favicon fetches.
    const r = structuredClone(valid),
      c = r.storageIsolation.contexts[slot];
    const socket = structuredClone(c.sockets[0]);
    socket.id += 10000;
    socket.challenge.id += 10000;
    c.sockets.push(socket);
    c.httpBytes += socket.httpBytes;
    for (const key of [
      "httpRequests",
      "tlsHandshakes",
      "routeDials",
      "challenges",
      "decisions",
      "allowDecisionsSubmitted",
    ])
      c[key]++;
    assert.equal(assessNativeTlsReport(r, r.runId).ok, true);
  }
});

test("native storage fixture uses real web APIs, transaction completion and the production TLS path", () => {
  const root = new URL(
    "../../src-tauri/crates/sorng-browser-host/tests/",
    import.meta.url,
  );
  const html = readFileSync(
    new URL("native_acceptance/fixtures/storage.html", root),
    "utf8",
  );
  const script = html
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(
      "__STORAGE_CONFIG__",
      JSON.stringify({ name: "a-write", write: "a-one" }),
    );
  assert.doesNotThrow(() => new Script(script));
  for (const pattern of [
    /indexedDB\.open\(DB, 1\)/,
    /tx\.oncomplete = \(\) => resolve\(value\)/,
    /await databaseValue\(config\.write\)/,
    /localStorage\.setItem\(KEY, config\.write\)/,
    /document\.cookie =/,
    /finally \{ db\.close\(\); \}/,
  ])
    assert.match(script, pattern);
  assert.doesNotMatch(
    script,
    /deleteDatabase|localStorage\.clear|__TAURI_INTERNALS__\s*=(?!=)/,
  );
  const native = readFileSync(
    new URL("native_tls_acceptance/src/storage.rs", root),
    "utf8",
  );
  assert.match(native, /PrivateRequestContext::create_with_tls\(/);
  assert.match(native, /NativeTlsCaMode::CustomOnly/);
  assert.match(native, /cef_tls_bridge::pump_tls\(\)/);
  assert.doesNotMatch(
    native,
    /ignore-certificate|create_context_shared|request_context_get_global_context/,
  );
  const library = readFileSync(
    new URL("native_tls_acceptance/src/lib.rs", root),
    "utf8",
  );
  assert.match(library, /storage::run\(/);
  assert.match(library, /with_visible\(manual_requested\)/);
  const server = readFileSync(
    new URL("native_tls_acceptance/src/fixture.rs", root),
    "utf8",
  );
  assert.match(server, /crate::storage::response/);
});

const nativeFatalLine =
  "[123:456:1007/223313.648:FATAL:net\\socket\\ssl_client_socket_impl.cc:949] Check failed: cert_verifier_request_. https://user:SECRET@private.test/token\n";
const networkRestartLine =
  "[123:456:1007/223313.649:ERROR:content\\browser\\network_service_instance_impl.cc:653] Network service crashed or was terminated, restarting service.\n";

test("native FATAL and recovered network service failure retain only fixed labels and counts", () => {
  const summary = summarizeNativeCrashLog(
    nativeFatalLine +
      networkRestartLine +
      "Cookie: PASSWORD-SECRET\n[123:456:INFO:fixture.cc:1] later probes passed\n",
  );
  assert.equal(summary.ok, false);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.counts, {
    nativeFatal: 1,
    networkServiceCrashOrRestart: 1,
  });
  assert.deepEqual(summary.failures, [
    "native-fatal",
    "network-service-crash-or-restart",
  ]);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /SECRET|private\.test|Cookie|ssl_client_socket_impl|cert_verifier_request_|123:456/,
  );
  assert.equal(
    summarizeNativeCrashLog("[FATAL:fixture.cc(1)] failure\n").counts
      .nativeFatal,
    1,
  );
  assert.equal(
    summarizeNativeCrashLog(
      "[ERROR:content/browser/network_service_instance_impl.cc(1)] Network service crashed, restarting service.\n",
    ).counts.networkServiceCrashOrRestart,
    1,
  );
});

test("each crash marker independently rejects otherwise passing positive and negative TLS observations", () => {
  const r = syntheticTlsReport();
  // The negative case observations themselves are valid; a network process
  // crash must not be allowed to masquerade as their expected TLS rejection.
  for (const c of r.cases.filter(
    (c) => !["manual", "staged", "successor"].includes(c.name),
  ))
    assert.equal(assessTlsSocketLedger(c).ok, true);
  const passed = assessNativeTlsReport(r, r.runId);
  assert.equal(passed.ok, true);
  for (const log of [
    nativeFatalLine,
    networkRestartLine,
    nativeFatalLine + networkRestartLine,
  ]) {
    const assessed = applyNativeCrashGate(passed, summarizeNativeCrashLog(log));
    assert.equal(assessed.ok, false);
    assert.equal(assessed.productionReady, false);
    assert.match(assessed.failures.at(-1), /fatal\/service-restart/);
  }
  assert.equal(passed.ok, true);
  assert.deepEqual(passed.failures, []);
});

test("ordinary startup warnings and page text do not become native crash records", () => {
  const source =
    "[1:2:WARNING:direct_composition_support.cc:1] GetGpuDriverOverlayInfo failed\n" +
    "[1:2:ERROR:ui/gl/egl_util.cc:92] EGL Driver message (Error) eglCreateContext: Requested GLES version (3.1) is greater than max supported (3.0).\n" +
    "Warning: eglCreateContext failed with EGL_BAD_MATCH\n" +
    " - While trying to discover a BackendType::OpenGLES adapter.\n" +
    "[1:2:ERROR:leveldb_site_data_store.cc:1] Invalid DB version, recreating\n" +
    '[1:2:INFO:CONSOLE(1)] "FATAL: Network service crashed"\n';
  for (const text of [source, ""]) {
    const summary = summarizeNativeCrashLog(text);
    assert.equal(summary.ok, true);
    assert.deepEqual(summary.counts, {
      nativeFatal: 0,
      networkServiceCrashOrRestart: 0,
    });
    assert.equal(
      applyNativeCrashGate({ ok: true, failures: [] }, summary).ok,
      true,
    );
  }
});

test("missing, unterminated, oversized and byte-capped logs never attest a clean native run", () => {
  for (const text of [
    undefined,
    "[1:2:INFO:fixture.cc:1] unfinished",
    "x".repeat(65537) + "\n",
    ("x".repeat(1023) + "\n").repeat(16385),
  ]) {
    const summary = summarizeNativeCrashLog(text);
    assert.equal(summary.ok, false);
    assert.equal(summary.complete, false);
    assert.equal(
      applyNativeCrashGate({ ok: true, failures: [] }, summary).ok,
      false,
    );
  }
  const partial = summarizeNativeCrashLog(nativeFatalLine.trimEnd());
  assert.equal(partial.counts.nativeFatal, 1);
  assert.equal(partial.complete, false);
  for (const summary of [
    undefined,
    {},
    { ...summarizeNativeCrashLog(nativeFatalLine), ok: true },
    { ...summarizeNativeCrashLog(""), complete: false },
    { ...summarizeNativeCrashLog(""), counts: { nativeFatal: 0 } },
  ]) {
    assert.equal(
      applyNativeCrashGate({ ok: true, failures: [] }, summary).ok,
      false,
    );
  }
});

test("streaming cef.log scan retains markers across chunk boundaries and missing files fail closed", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "sorng-cef-crash-summary-test-"),
  );
  try {
    const missing = await readNativeCrashSummary(
      path.join(directory, "missing.log"),
    );
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.failures, ["native-log-missing"]);
    const unreadable = await readNativeCrashSummary(directory);
    assert.equal(unreadable.ok, false);
    const file = path.join(directory, "cef.log");
    await writeFile(
      file,
      "\n".repeat(65530) + nativeFatalLine + networkRestartLine,
    );
    const summary = await readNativeCrashSummary(file);
    assert.equal(summary.complete, true);
    assert.deepEqual(summary.counts, {
      nativeFatal: 1,
      networkServiceCrashOrRestart: 1,
    });
    assert.doesNotMatch(
      JSON.stringify(summary),
      /SECRET|private\.test|sorng-cef-crash-summary-test/,
    );
    await writeFile(file, "");
    assert.equal((await readNativeCrashSummary(file)).ok, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("both runner suites apply the crash gate before their final acceptance verdict", () => {
  const source = readFileSync(
    new URL("../../scripts/cef-browser-acceptance.mjs", import.meta.url),
    "utf8",
  );
  const runner = source.slice(
    source.indexOf("export async function runAcceptance("),
    source.indexOf("async function main(args)"),
  );
  assert.match(
    runner,
    /readNativeCrashSummary\(\s*path\.join\(run,\s*["']cef\.log["']\),?\s*\)/,
  );
  assert.match(runner, /native-crash-summary\.json/);
  assert.match(
    runner,
    /applyNativeCrashGate\(\s*suite === ["']tls["']\s*\? assessNativeTlsReport\(native,\s*runId,\s*expectedPatchId\)\s*:\s*assessNativeReport\(native,\s*expectedPatchId\),\s*nativeCrashSummary,?\s*\)/,
  );
  assert.match(
    runner,
    /nativeTlsFixtureAccepted:\s*suite === ["']tls["'] && assessed\.failures\.length\s*===\s*0/,
  );
  assert.match(runner, /nativeFailureReason,\s*nativeCrashSummary,\s*platform/);
});

// ---------------------------------------------------------------------------
// Measurement mode: scenarios (a)-(f) and the M1-M8 matrix. Every report below
// is synthetic validator input; none of it is a measurement.
// ---------------------------------------------------------------------------

const acceptanceRoot = new URL(
  "../../src-tauri/crates/sorng-browser-host/tests/native_acceptance/",
  import.meta.url,
);
const acceptanceSource = (name) =>
  readFileSync(new URL(name, acceptanceRoot), "utf8").replaceAll("\r\n", "\n");
const HIDDEN_PRESENTATIONS = ["hidden-after-attach", "born-hidden"];

function syntheticMeasurementReport() {
  const box = (width) => ({
    width,
    height: 21,
    visible: true,
    inViewport: width <= 800,
  });
  const keyRow = (count, hidden) => ({
    keydown: count,
    trustedKeydown: count,
    beforeinput: count,
    input: count,
    trustedInput: count,
    focusedDocument: 0,
    hiddenDocument: hidden ? count : 0,
    activeTarget: count,
    inputAtMs: [300, 330, 360],
    firstAtMs: 300,
    lastAtMs: 900,
    medianGapMs: 30,
    maxGapMs: 45,
  });
  const page = (id, hidden, width, height) => ({
    slot: id,
    kind: "final",
    reason: "window-elapsed",
    atMs: 11700,
    windowMs: 12000,
    visibility: {
      initial: hidden ? "hidden" : "visible",
      initialHasFocus: false,
      current: hidden ? "hidden" : "visible",
      hidden,
      hasFocus: false,
      changes: [],
    },
    timer: {
      requestedMs: 20,
      count: 90,
      medianMs: 21,
      p95Ms: 30,
      maxMs: 44,
      ticksPerSecond: [45, 45],
    },
    animationFrame: {
      count: hidden ? 0 : 120,
      medianMs: hidden ? null : 16,
      p95Ms: hidden ? null : 17,
      maxMs: hidden ? null : 30,
      framesPerSecond: hidden ? [0, 0] : [60, 60],
    },
    messageTasks: {
      roundTrips: 50,
      runs: [{ atMs: 1500, visibility: "visible", totalMs: 1.5 }],
    },
    keys: {
      username: keyRow(22, hidden),
      password: keyRow(20, hidden),
      other: 0,
    },
    layout: {
      innerWidth: width,
      innerHeight: height,
      devicePixelRatio: 1,
      compactQuery: width < 600,
      compactShown: width < 600,
      form: box(300),
      username: box(150),
      password: box(150),
      submit: box(60),
      fluid: box(width),
    },
    login: {
      submitted: true,
      valuesMatch: true,
      submittedAtMs: 1500,
      usernameLength: 22,
      passwordLength: 20,
    },
  });
  const shell = (kind) => ({
    supported: true,
    visible: true,
    minimized: kind === "minimized",
    foreground: false,
    exposedPermille: ["covered", "minimized"].includes(kind) ? 0 : 1000,
    coveringWindows: kind === "covered" ? 1 : 0,
    decoy:
      kind === "covered"
        ? {
            shown: true,
            foreground: false,
            aboveFixture: true,
            coversFixture: true,
          }
        : null,
  });
  const relay = {
    state: "listening",
    acceptedConnections: 9,
    authenticationChallenges: 4,
    authenticatedRequests: 5,
    destinationDenials: 0,
    upstreamFailures: 0,
    requestRejections: 0,
    capacityRefusals: 0,
  };
  const slot = (plan) => {
    const hidden = HIDDEN_PRESENTATIONS.includes(plan.presentation);
    const [width, height] =
      plan.id === "b-born-hidden-1x1"
        ? [1, 1]
        : plan.id.startsWith("b-born-hidden-")
          ? [1280, 800]
          : [800, 600];
    // With the relay's default cap everything is admitted; with the cap the
    // fixture sets, the page sees the refused connections fail.
    const refused = plan.id === "f-relay-capacity-capped";
    const final =
      plan.adapter === "manual"
        ? {
            slot: plan.id,
            kind: "final",
            reason: "capacity",
            atMs: 7000,
            capacity: {
              sockets: refused
                ? { requested: 40, open: 26, error: 14, closed: 14 }
                : { requested: 40, open: 40, error: 0, closed: 0 },
              holds: {
                sameHost: { requested: 6, pending: 6, completed: 0, failed: 0 },
                otherHost: {
                  requested: 6,
                  pending: refused ? 0 : 6,
                  completed: 0,
                  failed: refused ? 6 : 0,
                },
              },
              settledAtMs: 7000,
            },
          }
        : page(plan.id, hidden, width, height);
    return {
      ...plan,
      width,
      height,
      navigated: true,
      navigationError: null,
      lifecycleAtNavigation: hidden ? "Hidden" : "Attached",
      inputBlockedRequested: plan.presentation === "visible-input-blocked",
      childWindow: {
        atNavigation: {
          known: true,
          visible: !hidden,
          styleVisible: !hidden,
          enabled: plan.presentation === "visible",
          width,
          height,
        },
      },
      lifecycleAtEnd: hidden ? "Hidden" : "Attached",
      reports: { final },
      reportReceivedMs: { login: 1600, final: 11900 },
      navigationToLoginReportMs: 1600,
      relay,
      native: {
        features: [
          { atMs: 20, status: "RendererInstalled", bootstrap: true },
          { atMs: 1500, status: "LoginAdapterCompleted", bootstrap: false },
        ],
        credentialCalls: { form: 44, "form-prepare": 1, "form-submit": 1 },
      },
    };
  };
  return {
    schema: 1,
    engine: "cef",
    bindingPin: "154.3.0",
    mode: "measure",
    productionReady: false,
    failures: [],
    measurements: {
      schema: 1,
      windowMs: 12000,
      only: null,
      plan: structuredClone(MEASUREMENT_SCENARIOS),
      relayMaxClients: 256,
      scenarios: MEASUREMENT_SCENARIOS.map((plan) => ({
        id: plan.id,
        shell: plan.shell,
        page: plan.page,
        windowMs: plan.longWindow ? 30000 : 12000,
        navigated: true,
        closed: true,
        windowState: {
          atNavigation: shell(plan.shell),
          atEnd: shell(plan.shell),
          everForeground: false,
          foregroundOwnedByFixtureProcess: null,
        },
        slots: plan.slots.map(slot),
        ...(plan.page === "capacity"
          ? {
              capacity:
                plan.id === "f-relay-capacity-capped"
                  ? {
                      requested: { sockets: 40, holdsPerHost: 6, holdHosts: 2 },
                      relayMaxClients: 32,
                      relayCapExplicit: true,
                      relay: {
                        ...relay,
                        acceptedConnections: 61,
                        capacityRefusals: 20,
                      },
                      fixture: {
                        socketsAccepted: 26,
                        holdsAccepted: 6,
                        heldPeak: 32,
                      },
                    }
                  : {
                      requested: { sockets: 40, holdsPerHost: 6, holdHosts: 2 },
                      relayMaxClients: 256,
                      relayCapExplicit: false,
                      relay: {
                        ...relay,
                        acceptedConnections: 61,
                        capacityRefusals: 0,
                      },
                      fixture: {
                        socketsAccepted: 40,
                        holdsAccepted: 12,
                        heldPeak: 52,
                      },
                    },
            }
          : {}),
      })),
    },
  };
}

const measurementRow = (report, id) =>
  assessMeasurementReport(report).rows.find((row) => row.id === id);
const measurementSlot = (report, id) =>
  report.measurements.scenarios
    .flatMap((scenario) => scenario.slots)
    .find((slot) => slot.id === id);
const measurementScenario = (report, id) =>
  report.measurements.scenarios.find((scenario) => scenario.id === id);
const relayOf = (report) =>
  measurementScenario(report, "f-relay-capacity").capacity.relay;

test("measurement scenario table mirrors the native client's table and covers (a)-(f)", () => {
  const rust = acceptanceSource("src/measure.rs");
  const labels = Object.fromEntries(
    [...rust.matchAll(/Self::(\w+) => "([a-z-]+)"/g)].map((m) => [m[1], m[2]]),
  );
  const table = rust.slice(
    rust.indexOf("pub(crate) const SCENARIOS: &[ScenarioPlan] = &["),
    rust.indexOf("impl Presentation {"),
  );
  const native = table
    .split("ScenarioPlan {")
    .slice(1)
    .map((block) => {
      const slots = [
        ...block.matchAll(
          /login\(\s*"([^"]+)",\s*Presentation::(\w+)|SlotPlan \{\s*id: "([^"]+)",\s*presentation: Presentation::(\w+),[^}]*?adapter: Adapter::(\w+)/g,
        ),
      ].map((m) =>
        m[1]
          ? { id: m[1], presentation: labels[m[2]], adapter: "modular-form" }
          : { id: m[3], presentation: labels[m[4]], adapter: labels[m[5]] },
      );
      return {
        id: /id: "([^"]+)"/.exec(block)[1],
        shell: labels[/shell: Shell::(\w+)/.exec(block)[1]],
        page: labels[/page: Page::(\w+)/.exec(block)[1]],
        longWindow: /long_window: (true|false)/.exec(block)[1] === "true",
        slots,
      };
    });
  assert.deepEqual(native, MEASUREMENT_SCENARIOS);
  // Only the capped capacity scenario sets its relay's cap, to a number the
  // page exceeds; every other relay keeps the default, whatever it is.
  assert.equal(rust.match(/relay_clients: Some\(/g).length, 1);
  assert.match(
    table,
    /id: "f-relay-capacity-capped",[\s\S]*?relay_clients: Some\(CAPACITY_SMALL_CAP\),/,
  );
  assert.match(rust, /const CAPACITY_SMALL_CAP: usize = 32;/);
  assert.match(
    rust,
    /Some\(max_clients\) => ProxyLimits \{\s*max_clients,\s*\.\.ProxyLimits::default\(\)\s*\},\s*None => ProxyLimits::default\(\),/,
  );
  assert.match(
    rust,
    /assert!\(requested <= ProxyLimits::default\(\)\.max_clients\);\s*assert!\(requested > CAPACITY_SMALL_CAP\);/,
  );
  // The helper used by most rows must stay the key-pipeline adapter.
  assert.match(
    rust,
    /const fn login\([^)]*\) -> SlotPlan \{[^}]*adapter: Adapter::ModularForm,/s,
  );
  const slots = MEASUREMENT_SCENARIOS.flatMap((scenario) => scenario.slots);
  assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length);
  for (const required of [
    "a-hidden-after-attach",
    "b-born-hidden-1x1",
    "b-born-hidden-1280x800",
    "c-visible-input-blocked",
    "d-visible",
    "d-hidden-after-attach",
    "d-born-hidden",
    "e-inactive",
    "f-relay-capacity",
    "f-relay-capacity-capped",
  ])
    assert.ok(
      slots.some((slot) => slot.id === required),
      required,
    );
  const concurrent = MEASUREMENT_SCENARIOS.find((s) => s.id === "d-concurrent");
  assert.deepEqual(
    concurrent.slots.map((slot) =>
      HIDDEN_PRESENTATIONS.includes(slot.presentation),
    ),
    [false, true, true],
  );
  // Window-state scenarios run last: they change the fixture window.
  const changed = MEASUREMENT_SCENARIOS.findIndex(
    (s) => s.shell !== "as-launched",
  );
  assert.ok(
    MEASUREMENT_SCENARIOS.slice(changed).every(
      (s) => s.shell !== "as-launched",
    ),
  );
});

test("a measurement report is never acceptance evidence and never claims readiness", () => {
  const report = syntheticMeasurementReport();
  const acceptance = assessNativeReport(report);
  assert.equal(acceptance.ok, false);
  assert.ok(
    acceptance.failures.includes(
      "measurement report is not acceptance evidence",
    ),
  );
  const matrix = assessMeasurementReport(report);
  assert.equal(matrix.productionReady, false);
  assert.equal(matrix.actualCefAcceptance, false);
  // The same guard must not fire for an ordinary acceptance report.
  assert.ok(
    !assessNativeReport({ schema: 1 }).failures.includes(
      "measurement report is not acceptance evidence",
    ),
  );
});

test("a complete synthetic report yields eight MEASURED rows carrying only observed values", () => {
  const matrix = assessMeasurementReport(syntheticMeasurementReport());
  assert.deepEqual(
    matrix.rows.map((row) => [row.id, row.status]),
    ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"].map((id) => [
      id,
      "MEASURED",
    ]),
  );
  assert.equal(matrix.complete, true);
  const value = (id) => matrix.rows.find((row) => row.id === id).value;
  assert.equal(value("M1")["a-hidden-after-attach"].initial, "hidden");
  assert.equal(value("M1")["baseline-visible"].initial, "visible");
  assert.equal(value("M1")["b-born-hidden-1x1"].childWindowShown, false);
  assert.deepEqual(
    value("M2")["b-born-hidden-1280x800"].framesPerSecond,
    [0, 0],
  );
  assert.equal(value("M3")["b-born-hidden-generic"].adapter, "generic");
  assert.equal(value("M3")["b-born-hidden-1x1"].username.hiddenDocument, 22);
  // Per-key timestamps stay in the raw report, not in the matrix.
  assert.equal("inputAtMs" in value("M3")["baseline-visible"].username, false);
  assert.equal(value("M4").changed, true);
  assert.ok(value("M4").differences.includes("compactShown"));
  assert.deepEqual(Object.keys(value("M5")), [
    "d-visible",
    "d-hidden-after-attach",
    "d-born-hidden",
  ]);
  assert.equal(value("M6")["e-covered"].shellAtNavigation.decoyCovers, true);
  // The same 52 connections: all admitted under the relay's default cap,
  // twenty refused under the cap the fixture sets.
  assert.deepEqual(
    [value("M7").capacityRefusals, value("M7").relayMaxClients],
    [0, 256],
  );
  assert.equal(value("M7").relayCapExplicit, false);
  assert.deepEqual(value("M7").requested, { sockets: 40, holds: 12 });
  assert.deepEqual(
    [value("M7").page.sockets.open, value("M7").page.sockets.error],
    [40, 0],
  );
  assert.deepEqual(
    [value("M8").capacityRefusals, value("M8").relayMaxClients],
    [20, 32],
  );
  assert.equal(value("M8").relayCapExplicit, true);
  assert.deepEqual(value("M8").requested, { sockets: 40, holds: 12 });
  const text = formatMeasurementMatrix(matrix);
  assert.match(
    text,
    /^Real-engine measurements \(local synthetic fixtures; not acceptance\)/,
  );
  assert.match(text, /measured 8\/8$/);
  assert.match(text, /everForeground=false processForeground=never changes=/);
  // A report of a client that did not record it says so instead of "never".
  const unrecorded = syntheticMeasurementReport();
  for (const scenario of unrecorded.measurements.scenarios)
    delete scenario.windowState.foregroundOwnedByFixtureProcess;
  assert.match(
    formatMeasurementMatrix(assessMeasurementReport(unrecorded)),
    /everForeground=false processForeground=not recorded changes=/,
  );
  assert.match(
    text,
    /M7 [^\n]*: MEASURED\n {3}capacity_refusals=0 requested=52 \(40 sockets \+ 12 holds\) relayMaxClients=256 \(default\) [^\n]*\n {3}page: sockets open=40 error=0; holds failed same-host=0 other-host=0/,
  );
  assert.match(
    text,
    /M8 [^\n]*: MEASURED\n {3}capacity_refusals=20 requested=52 \(40 sockets \+ 12 holds\) relayMaxClients=32 \(set by the fixture\) [^\n]*\n {3}page: sockets open=26 error=14; holds failed same-host=0 other-host=6/,
  );
});

test("a login that did not complete is a measured result, not a missing measurement", () => {
  const report = syntheticMeasurementReport();
  const slot = measurementSlot(report, "c-visible-input-blocked");
  Object.assign(slot.reports.final.login, {
    submitted: false,
    valuesMatch: false,
    submittedAtMs: null,
    usernameLength: 0,
    passwordLength: 0,
  });
  Object.assign(slot.reports.final.keys.username, { keydown: 0, input: 0 });
  slot.native.features.push({
    atMs: 900,
    status: "LoginAdapterRejected",
    bootstrap: false,
  });
  const row = measurementRow(report, "M3");
  assert.equal(row.status, "MEASURED");
  const seen = row.value["c-visible-input-blocked"];
  assert.equal(seen.completed, false);
  assert.equal(seen.completionMs, null);
  assert.equal(seen.username.input, 0);
  assert.equal(seen.lastFeature, "LoginAdapterRejected");
});

test("rows without a window-complete report or the planned native condition are NOT MEASURED and carry no value", () => {
  const cases = [
    [
      "M1",
      /baseline-visible: no window-complete page report/,
      (r) => delete measurementSlot(r, "baseline-visible").reports.final,
    ],
    [
      "M2",
      /a-hidden-after-attach: native view was not Hidden at navigation/,
      (r) =>
        (measurementSlot(r, "a-hidden-after-attach").lifecycleAtNavigation =
          "Attached"),
    ],
    [
      "M3",
      /b-born-hidden-1x1: native child window was shown at navigation/,
      (r) =>
        (measurementSlot(
          r,
          "b-born-hidden-1x1",
        ).childWindow.atNavigation.styleVisible = true),
    ],
    [
      "M3",
      /c-visible-input-blocked: input-blocked state was not as planned/,
      (r) =>
        (measurementSlot(r, "c-visible-input-blocked").inputBlockedRequested =
          false),
    ],
    [
      "M3",
      /baseline-visible: native child window was hidden at navigation/,
      (r) =>
        (measurementSlot(
          r,
          "baseline-visible",
        ).childWindow.atNavigation.styleVisible = false),
    ],
    [
      "M4",
      /b-born-hidden-1x1: view was not created at 1x1/,
      (r) => (measurementSlot(r, "b-born-hidden-1x1").width = 800),
    ],
    [
      "M5",
      /d-born-hidden: navigation was not admitted/,
      (r) => (measurementSlot(r, "d-born-hidden").navigated = false),
    ],
    [
      "M5",
      /d-visible: scenario did not run/,
      (r) =>
        (r.measurements.scenarios = r.measurements.scenarios.filter(
          (scenario) => scenario.id !== "d-concurrent",
        )),
    ],
    [
      "M6",
      /e-inactive: fixture window was foreground/,
      (r) =>
        (measurementScenario(r, "e-inactive").windowState.atEnd.foreground =
          true),
    ],
    [
      "M6",
      // Foreground between the two sampled states still disqualifies the row.
      /e-covered: fixture window was foreground/,
      (r) =>
        (measurementScenario(r, "e-covered").windowState.everForeground = true),
    ],
    [
      "M6",
      /e-minimized-hidden: fixture window was foreground/,
      (r) =>
        delete measurementScenario(r, "e-minimized-hidden").windowState
          .everForeground,
    ],
    [
      "M6",
      /e-covered: fixture window was not shown to be covered/,
      (r) =>
        (measurementScenario(
          r,
          "e-covered",
        ).windowState.atNavigation.decoy.coversFixture = false),
    ],
    [
      "M6",
      /e-covered: fixture window was not shown to be covered/,
      (r) =>
        (measurementScenario(r, "e-covered").windowState.atEnd.exposedPermille =
          40),
    ],
    [
      "M6",
      /e-minimized-hidden: fixture window was not minimized/,
      (r) =>
        (measurementScenario(
          r,
          "e-minimized-hidden",
        ).windowState.atNavigation.minimized = false),
    ],
    [
      "M6",
      /e-minimized-hidden: scenario skipped \(shell-control-unavailable\)/,
      (r) =>
        (measurementScenario(r, "e-minimized-hidden").skipped =
          "shell-control-unavailable"),
    ],
    [
      "M6",
      /e-inactive: window state was not observed/,
      (r) =>
        (measurementScenario(r, "e-inactive").windowState.atNavigation = {
          supported: false,
        }),
    ],
    // The fixture window is not the only window its process owns: another
    // one of them as the foreground window disqualifies the row as well.
    [
      "M6",
      /e-inactive: a window of the fixture process was foreground \(Tao Thread Event Target\)/,
      (r) =>
        (measurementScenario(
          r,
          "e-inactive",
        ).windowState.foregroundOwnedByFixtureProcess =
          "Tao Thread Event Target"),
    ],
    [
      "M7",
      /f-relay-capacity: the relay's cap was not its default/,
      (r) =>
        (measurementScenario(r, "f-relay-capacity").capacity.relayCapExplicit =
          true),
    ],
    [
      "M8",
      /requested connections did not exceed the relay limit/,
      (r) =>
        (measurementScenario(
          r,
          "f-relay-capacity-capped",
        ).capacity.relayMaxClients = 64),
    ],
    [
      "M8",
      /f-relay-capacity-capped: the relay's cap was not set by the fixture/,
      (r) =>
        (measurementScenario(
          r,
          "f-relay-capacity-capped",
        ).capacity.relayCapExplicit = false),
    ],
    [
      "M8",
      /f-relay-capacity-capped: scenario did not run/,
      (r) =>
        r.measurements.scenarios.splice(
          r.measurements.scenarios.findIndex(
            (scenario) => scenario.id === "f-relay-capacity-capped",
          ),
          1,
        ),
    ],
    [
      "M7",
      /no long-lived connection reached the fixture/,
      (r) =>
        Object.assign(
          measurementScenario(r, "f-relay-capacity").capacity.fixture,
          { socketsAccepted: 0, holdsAccepted: 0 },
        ),
    ],
    [
      "M7",
      /relay diagnostics not reported/,
      (r) =>
        delete measurementScenario(r, "f-relay-capacity").capacity.relay
          .capacityRefusals,
    ],
  ];
  for (const [id, reason, mutate] of cases) {
    const report = syntheticMeasurementReport();
    mutate(report);
    const matrix = assessMeasurementReport(report);
    const row = matrix.rows.find((entry) => entry.id === id);
    assert.equal(row.status, "NOT MEASURED", String(reason));
    assert.equal(row.value, null, String(reason));
    assert.ok(
      row.reasons.some((text) => reason.test(text)),
      `${reason}: ${row.reasons}`,
    );
    assert.equal(matrix.complete, false);
    const lines = formatMeasurementMatrix(matrix).split("\n");
    const at = lines.findIndex((line) => line.startsWith(`${id} `));
    assert.match(lines[at], /: NOT MEASURED$/);
    // Reasons only: no observed value is printed under an unmeasured row.
    for (
      let next = at + 1;
      next < lines.length && lines[next].startsWith("   ");
      next++
    )
      assert.ok(row.reasons.includes(lines[next].trim()), lines[next]);
  }
  // The capacity page's own report is supporting detail, not a condition.
  const unreported = syntheticMeasurementReport();
  delete measurementSlot(unreported, "f-relay-capacity").reports.final;
  assert.equal(measurementRow(unreported, "M7").status, "MEASURED");
  assert.equal(measurementRow(unreported, "M7").value.page, null);
  // The default cap is whatever the relay under test has. A relay whose
  // default is below the page's 52 connections is measured as it is, with
  // its refusals: that is the row's value, not a reason to withhold it.
  const before = syntheticMeasurementReport();
  Object.assign(measurementScenario(before, "f-relay-capacity").capacity, {
    relayMaxClients: 32,
    relay: { ...relayOf(before), capacityRefusals: 20 },
  });
  assert.equal(measurementRow(before, "M7").status, "MEASURED");
  assert.deepEqual(
    [
      measurementRow(before, "M7").value.capacityRefusals,
      measurementRow(before, "M7").value.relayMaxClients,
    ],
    [20, 32],
  );
  // Each row reads its own scenario only.
  assert.equal(measurementRow(before, "M8").value.capacityRefusals, 20);
  const uncapped = syntheticMeasurementReport();
  delete measurementScenario(uncapped, "f-relay-capacity").capacity;
  assert.equal(measurementRow(uncapped, "M7").status, "NOT MEASURED");
  assert.equal(measurementRow(uncapped, "M8").status, "MEASURED");
});

test("stale, foreign or differently planned reports measure nothing", () => {
  for (const mutate of [
    (r) => (r.mode = "acceptance"),
    (r) => delete r.mode,
    (r) => (r.bindingPin = "154.2.0"),
    (r) => (r.productionReady = true),
    (r) => (r.measurements.schema = 2),
    (r) => (r.measurements.scenarios = null),
    (r) => r.measurements.plan.pop(),
    (r) => (r.measurements.plan[0].slots[0].presentation = "born-hidden"),
    (r) => (r.measurements.plan[3].longWindow = false),
  ]) {
    const report = syntheticMeasurementReport();
    mutate(report);
    const matrix = assessMeasurementReport(report);
    assert.equal(matrix.measured, 0);
    assert.ok(
      matrix.rows.every(
        (row) =>
          row.value === null &&
          row.reasons.some((reason) =>
            reason.includes("no measurement report"),
          ),
      ),
    );
  }
  assert.equal(assessMeasurementReport(undefined).measured, 0);
  assert.match(
    formatMeasurementMatrix(assessMeasurementReport(undefined)),
    /measured 0\/8$/,
  );
  // Key order must not matter: the native serializer sorts object keys.
  const reordered = syntheticMeasurementReport();
  reordered.measurements.plan = reordered.measurements.plan.map((plan) => ({
    slots: plan.slots.map((slot) => ({
      adapter: slot.adapter,
      presentation: slot.presentation,
      id: slot.id,
    })),
    shell: plan.shell,
    page: plan.page,
    longWindow: plan.longWindow,
    id: plan.id,
  }));
  assert.equal(assessMeasurementReport(reordered).measured, 8);
});

test("measurement options are validated before a profile is created or a process launched", async () => {
  assert.deepEqual(measurementPlan(), {
    windowMs: 12000,
    only: undefined,
    scenarios: MEASUREMENT_SCENARIOS.map((scenario) => scenario.id),
    // Eleven ordinary windows, one long window, set-up per scenario and start-up.
    expectedMs: 11 * 12000 + 30000 + 12 * 12000 + 15000,
  });
  assert.deepEqual(
    measurementPlan({ windowMs: "5000", only: "e-covered,baseline-visible" }),
    {
      windowMs: 5000,
      only: ["e-covered", "baseline-visible"],
      // Run order is the table's, whatever order was asked for.
      scenarios: ["baseline-visible", "e-covered"],
      expectedMs: 2 * 5000 + 2 * 12000 + 15000,
    },
  );
  assert.equal(
    measurementPlan({ windowMs: 40000, only: "b-born-hidden-1280x800" })
      .expectedMs,
    60000 + 12000 + 15000,
  );
  for (const options of [
    { windowMs: 4999 },
    { windowMs: 40001 },
    { windowMs: "12s" },
    { only: "" },
    { only: "unknown" },
    { only: "baseline-visible,baseline-visible" },
    { only: "baseline-visible, e-covered" },
  ]) {
    assert.throws(
      () => measurementPlan(options),
      /Invalid windowMs|measurement scenario/,
    );
    await assert.rejects(
      runAcceptance({
        executable: "never-launched",
        output: "never-created",
        suite: "measure",
        ...options,
      }),
      /Invalid windowMs|measurement scenario/,
    );
  }
  for (const options of [{ windowMs: 12000 }, { only: "baseline-visible" }])
    for (const suite of ["legacy", "tls"])
      await assert.rejects(
        runAcceptance({
          executable: "never-launched",
          output: "never-created",
          suite,
          ...options,
        }),
        /apply to measure/,
      );
});

test("the runner scrubs inherited mode variables, starts hidden and returns measurements before any acceptance verdict", () => {
  const source = readFileSync(
    new URL("../../scripts/cef-browser-acceptance.mjs", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const runner = source.slice(
    source.indexOf("export async function runAcceptance("),
    source.indexOf("async function main(args)"),
  );
  assert.deepEqual(MEASUREMENT_VARIABLES, [
    "SORNG_CEF_ACCEPTANCE_MODE",
    "SORNG_CEF_MEASURE_WINDOW_MS",
    "SORNG_CEF_MEASURE_ONLY",
  ]);
  const scrub = runner.indexOf(
    "for (const name of MEASUREMENT_VARIABLES) delete env[name];",
  );
  const set = runner.indexOf('env.SORNG_CEF_ACCEPTANCE_MODE = "measure";');
  const spawned = runner.indexOf(
    "const child = spawn(launch?.command ?? executable",
  );
  assert.ok(scrub > 0 && scrub < set && set < spawned);
  // The mode is set only inside the measure branch.
  assert.match(
    runner.slice(scrub, spawned),
    /if \(measurePlan\) \{\s*env\.SORNG_CEF_ACCEPTANCE_MODE = "measure";/,
  );
  // Hidden at start: the native client then shows its window without
  // activating it, so a run never takes the foreground.
  assert.match(runner.slice(spawned, spawned + 200), /windowsHide: true,/);
  assert.doesNotMatch(runner, /windowsHide: (?!true)/);
  const branch = runner.indexOf("if (measurePlan) {", spawned);
  const verdict = runner.indexOf("assessNativeTlsReport(");
  assert.ok(branch > 0 && verdict > branch);
  const measured = runner.slice(branch, verdict);
  assert.match(
    measured,
    /return report;\s*\}\s*\/\/ Independent of positive\/negative TLS outcomes/,
  );
  assert.doesNotMatch(measured, /nativeTlsFixtureAccepted|acceptance\.json/);
  assert.match(
    measured,
    /actualCefAcceptance: false,\s*publicProviderAcceptance: false,\s*productionReady: false,/,
  );
});

test("the native measurement client sends no input, takes no focus and uses only synthetic loopback fixtures", () => {
  const library = acceptanceSource("src/lib.rs");
  const measure = acceptanceSource("src/measure.rs");
  const server = acceptanceSource("src/fixture.rs");
  // Mode selection precedes window creation, and a measuring window is built
  // unfocused; an unknown mode is an error, not a silent acceptance run.
  const requested = library.indexOf("let measuring = measure::requested()?;");
  const window = library.indexOf("WindowBuilder::new()");
  assert.ok(requested > 0 && requested < window);
  assert.match(library, /\.with_focused\(!measuring\)/);
  assert.match(measure, /_ => Err\("unknown acceptance mode"\.into\(\)\)/);
  assert.match(measure, /\.with_focused\(false\)/);
  // The fixture window is disabled before it is first shown, so a navigating
  // view cannot pull native focus (and with it the foreground) into it.
  assert.match(
    measure,
    /pub\(super\) fn present_inert\(window: &Window\) \{\s*if let Some\(window\) = hwnd\(window\) \{\s*unsafe \{\s*EnableWindow\(window, 0\);\s*ShowWindow\(window, SW_SHOWNOACTIVATE\);/,
  );
  assert.ok(
    measure.indexOf("shell::present_inert(&run.parent);") <
      measure.indexOf("for plan in SCENARIOS {"),
  );
  assert.equal(measure.match(/EnableWindow\(/g).length, 2);
  // No synthetic input, cursor, clipboard or cross-process focus API.
  assert.doesNotMatch(
    measure,
    /SendInput|keybd_event|mouse_event|SetCursorPos|PostMessage|SendMessage|OpenClipboard|SetClipboardData|AttachThreadInput|BringWindowToTop|SwitchToThisWindow|\.set_focus\(/,
  );
  // Whether any window of this process is the foreground window is sampled
  // on every turn of the loop, before anything can return early.
  assert.match(
    measure,
    /runtime\.work\(\)\?;\s*if own_foreground\.is_none\(\) \{\s*own_foreground = shell::foreground_own\(&parent\);/,
  );
  assert.match(
    measure,
    /if foreground\.is_null\(\) \|\| !own\(foreground\) \{\s*return None;/,
  );
  // The foreground is only ever handed to this process's own decoy window.
  assert.deepEqual(
    [...measure.matchAll(/SetForegroundWindow\(([^)]*)\)/g)].map((m) => m[1]),
    ["window: Hwnd", "decoy"],
  );
  assert.match(
    measure,
    /Shell::Inactive if !foreground => vec!\["already-inactive"\]/,
  );
  // Synthetic credentials and a fixture-only route.
  assert.match(measure, /const USERNAME: &str = "synthetic@example\.test";/);
  assert.match(measure, /const PASSWORD: &str = "synthetic-local-only";/);
  assert.match(
    measure,
    /\["fixture\.test", "frame\.test"\]\s*\.contains\(&authority\.host\(\)\)/,
  );
  assert.match(measure, /tokio::net::TcpStream::connect\(address\)/);
  assert.doesNotMatch(
    measure,
    /lookup_host|ToSocketAddrs|std::fs::|std::env::(?!var\(|VarError)/,
  );
  // Measurement routes are served before the legacy trace and never reach it.
  assert.match(
    server,
    /if crate::measure::serves\(route\) \{\s*return crate::measure::serve\(/,
  );
  assert.match(
    measure,
    /"\/measure-login" \| "\/measure-capacity" \| "\/measure-report" \| "\/measure-hold" \| "\/measure-socket"/,
  );
  // The report marks its mode only when a measurement document exists.
  assert.match(
    server,
    /if let Some\(measurements\) = &state\.measure\.document \{\s*report\["mode"\] = "measure"\.into\(\);/,
  );
});

test("measurement fixture pages observe passively and report counts, never typed values", () => {
  const login = acceptanceSource("fixtures/measure-login.html");
  const capacity = acceptanceSource("fixtures/measure-capacity.html");
  for (const page of [login, capacity]) {
    assert.doesNotMatch(
      page,
      /clipboard|execCommand|document\.cookie|localStorage|sessionStorage|window\.open|eval\(/i,
    );
    // Relative fixture routes or the two synthetic hosts only.
    for (const [, url] of page.matchAll(
      /["'`]((?:https?|wss?):\/\/[^"'`]+)["'`]/g,
    ))
      assert.match(url, /^(?:https|wss):\/\/(?:fixture|frame)\.test\//, url);
  }
  // The only default action prevented is the form's own submission.
  assert.equal(login.match(/preventDefault\(\)/g).length, 1);
  assert.match(
    login,
    /form\.addEventListener\('submit', event => \{\s*event\.preventDefault\(\);/,
  );
  assert.doesNotMatch(
    login,
    /\.focus\(|\.blur\(|\.click\(|dispatchEvent|\.value\s*=[^=]/,
  );
  // Field values are only measured or compared with the synthetic literals.
  for (const [use] of login.matchAll(/\.value\b[^\n;,)}]*/g))
    assert.match(
      use,
      /^\.value(?:\.length| === '(?:synthetic@example\.test|synthetic-local-only)')/,
      use,
    );
  assert.match(login, /setTimeout\(tick, 20\)/);
  assert.match(login, /requestAnimationFrame\(frame\)/);
  assert.match(login, /document\.addEventListener\('visibilitychange'/);
  // Capacity: both socket pools and two hosts, released before the report.
  assert.match(
    capacity,
    /new WebSocket\('wss:\/\/fixture\.test\/measure-socket'\)/,
  );
  assert.match(capacity, /'https:\/\/frame\.test\/measure-hold\?i=' \+ index/);
  const release = capacity.indexOf("abort.abort();");
  assert.ok(
    release > 0 && release < capacity.indexOf("fetch('/measure-report'"),
  );
});

// ---------------------------------------------------------------------------
// Context-menu evidence mode. Every report below is synthetic validator
// input; none of it is an observation of the engine.
// ---------------------------------------------------------------------------

const MENU_ROW_IDS = [
  "Back",
  "Forward",
  "Reload",
  "Stop loading",
  "Undo",
  "Redo",
  "Cut",
  "Copy",
  "Paste",
  "Delete",
  "Select all",
  "Developer tools",
  "Open link in new tab",
  "Copy link address",
  "Open image in new tab",
  "Copy image address",
  "Open video in new tab",
  "Copy video address",
  "Open audio in new tab",
  "Copy audio address",
  "Paste as plain text",
  "Print",
  "Inspect",
];
const menuRow = ([label, enabled]) => [
  26500 + MENU_ROW_IDS.indexOf(label),
  label,
  enabled !== false,
];

// Engine values for the steps whose assumptions the assessor compares.
const MENU_SYNTHETIC_ENGINE = {
  "rows-link": {
    link: "https://fixture.test/menu-target?item=1#part",
    shownLink: "https://fixture.test/menu-target?item=1#part",
  },
  "rows-link-other": {
    link: "https://elsewhere.test/menu-target?item=6",
    shownLink: "https://elsewhere.test/menu-target?item=6",
  },
  "rows-link-http": {
    link: "http://fixture.test/menu-target?item=4",
    shownLink: "http://fixture.test/menu-target?item=4",
  },
  "rows-link-js": {
    link: "about:blank#blocked",
    shownLink: "javascript:void(0)",
  },
  "rows-image": {
    source: "https://fixture.test/menu-image.png?i=1",
    media: "image",
  },
  "rows-image-link": {
    link: "https://fixture.test/menu-target?item=2",
    source: "https://fixture.test/menu-image.png?i=2",
    media: "image",
  },
  "rows-image-data": { source: "data:image/png;base64,AAAA", media: "image" },
  "rows-video": {
    source: "https://fixture.test/menu-clip.webm",
    media: "video",
  },
  "rows-video-broken": {
    source: "https://fixture.test/menu-missing.webm",
    media: "video",
  },
  "rows-audio": {
    source: "https://fixture.test/menu-tone.wav",
    media: "audio",
  },
  "rows-text": { editable: true, editFlags: 16 | 64 },
  "rows-editable": { editable: true, editFlags: 16 | 64 | 256 },
  "rows-password-empty": { editable: true, editFlags: 16 },
  // Bits the policy does not read are reported and not compared.
  "rows-selection": { editFlags: 8 | 64 | 128 },
};

// A native report in which every step went exactly as the plan expects.
function syntheticMenuReport() {
  let requests = 0;
  const step = (expected) => {
    if (expected.point === 0) return { id: expected.id };
    const before = requests;
    const record = {
      id: expected.id,
      requests: { before, after: before },
      menus: [],
      answers: [],
      copied: [],
      clipboardSequence: { before: 41, after: 41 },
      tabs: { before: 0, after: 0, views: [] },
      served: { report: 1 },
      host: {
        lifecycle: ["Attached", "Attached"],
        loading: expected.loading ?? [false, false],
        mainDocuments: [1, 1],
      },
      pageReports: [],
      elapsedMs: 400,
    };
    if (expected.id !== "revoked")
      record.trace = {
        kind: "trace",
        target: expected.target ?? "key-plain",
        prevented: expected.outcome === "page-handled",
        handledBy: expected.outcome === "page-handled" ? "page" : "",
        ownMenu: expected.id === "own-menu",
        trusted: true,
        button: 2,
        focus: true,
        visibility: "visible",
      };
    if (expected.outcome === "page-handled") return record;
    record.requests.after = ++requests;
    record.requestWithinMs = 12;
    if (expected.outcome === "host-refused") return record;
    const rows =
      expected.rows ??
      (expected.pick
        ? [[expected.pick, expected.selected !== false]]
        : [["Reload", true]]);
    record.menus = [rows.map(menuRow)];
    record.sent = [70, 32];
    record.reported = [
      {
        link: "",
        shownLink: "",
        source: "",
        media: "none",
        editFlags: 0,
        editable: false,
        point: [70, 32],
        ...(MENU_SYNTHETIC_ENGINE[expected.id] ?? {}),
      },
    ];
    if (!expected.pick) {
      record.answers = [
        {
          asked: null,
          offered: false,
          enabled: false,
          handedBack: false,
          withheld: false,
        },
      ];
      return record;
    }
    const enabled = expected.selected !== false;
    record.answers = [
      {
        asked: expected.pick,
        offered: true,
        enabled,
        handedBack: true,
        withheld: false,
      },
    ];
    if (Array.isArray(expected.copied))
      record.copied = expected.copied.map((text) => ({
        text,
        clipboardSequence: 41,
      }));
    if (expected.tabs) record.tabs.after = expected.tabs;
    if (expected.served) record.served[expected.served] = 1;
    if (expected.input === true)
      record.pageReports = [
        {
          kind: "input",
          target: expected.target,
          inputType: "deleteContentBackward",
          trusted: true,
          len: 0,
        },
      ];
    return record;
  };
  return {
    schema: 1,
    engine: "cef",
    bindingPin: "154.3.0",
    mode: "menu",
    productionReady: false,
    failures: [],
    menu: {
      schema: 1,
      neverSelected: [...MENU_NEVER_SELECTED],
      plan: MENU_EVIDENCE_PLAN.map((plan) => ({
        id: plan.id,
        popups: plan.popups,
        steps: plan.steps.map((expected) =>
          expected.target === undefined
            ? { id: expected.id }
            : {
                id: expected.id,
                target: expected.target,
                pick: expected.pick ?? null,
              },
        ),
      })),
      scenarios: MENU_EVIDENCE_PLAN.map((plan) => ({
        id: plan.id,
        popups: plan.popups,
        engineBrowserId: 1,
        childWindowMatched: true,
        viewUnitsPerCssPixel: 1,
        navigated: true,
        closed: true,
        notRun: [],
        window: {
          atStart: { supported: true, foreground: false, coveringWindows: 3 },
          atEnd: { supported: true, foreground: false, coveringWindows: 3 },
          everForeground: false,
          foregroundOwnedByClient: [],
          otherShownTopLevelWindows: [{ atMs: 0, windows: [] }],
        },
        clipboard: { sequenceAtStart: 41, sequenceAtEnd: 41 },
        page: { dpr: 1, focus: true, visibility: "visible" },
        steps: plan.steps.map(step),
      })),
    },
  };
}

const menuNativeStep = (report, id) =>
  report.menu.scenarios
    .flatMap((scenario) => scenario.steps)
    .find((step) => step.id === id);
const menuStep = (report, id) =>
  assessMenuReport(report)
    .scenarios.flatMap((scenario) => scenario.steps)
    .find((step) => step.id === id);
const menuSource = () => acceptanceSource("src/measure/menu.rs");

test("menu evidence plan mirrors the native client's plan and covers every K10 target", () => {
  const rust = menuSource();
  const table = rust.slice(
    rust.indexOf("pub(crate) static PLANS: [Plan; 2] = ["),
    rust.indexOf("/// `true` when this run collects context-menu evidence"),
  );
  const native = table
    .split("Plan {")
    .slice(1)
    .map((block) => ({
      id: /view: view\("([^"]+)"\)/.exec(block)[1],
      popups: /popups: Popups::(\w+)/.exec(block)[1].toLowerCase(),
      steps: [
        ...block.matchAll(
          /\b(menu|pick|step)\(\s*"([^"]+)"(?:,\s*"([^"]+)")?(?:,\s*"([^"]+)")?/g,
        ),
      ].map(([, kind, id, target, row]) =>
        kind === "step" ? { id } : { id, target, pick: row ?? null },
      ),
    }));
  assert.deepEqual(
    native,
    MENU_EVIDENCE_PLAN.map((plan) => ({
      id: plan.id,
      popups: plan.popups,
      steps: plan.steps.map((expected) =>
        expected.target === undefined
          ? { id: expected.id }
          : {
              id: expected.id,
              target: expected.target,
              pick: expected.pick ?? null,
            },
      ),
    })),
  );
  // The same five rows are withheld on both sides, and no step asks for one.
  const never = /pub\(crate\) const NEVER_SELECTED: &\[&str\] = &\[([^\]]+)\];/
    .exec(rust)[1]
    .split(",")
    .map((label) => label.trim().replaceAll('"', ""));
  assert.deepEqual(never, MENU_NEVER_SELECTED);
  assert.deepEqual(MENU_NEVER_SELECTED, [
    "Print",
    "Inspect",
    "Developer tools",
    "Copy",
    "Cut",
    "Paste",
    "Paste as plain text",
  ]);
  const steps = MENU_EVIDENCE_PLAN.flatMap((plan) => plan.steps);
  for (const expected of steps)
    assert.ok(!MENU_NEVER_SELECTED.includes(expected.pick), expected.id);
  // Every click target K10 names has a rows step, and each gets its group.
  const main = MENU_EVIDENCE_PLAN[0].steps;
  for (const [id, labels] of Object.entries({
    "rows-plain": [],
    "rows-selection": ["Copy", "Select all"],
    "rows-link": ["Open link in new tab", "Copy link address"],
    "rows-image": ["Open image in new tab", "Copy image address"],
    "rows-image-link": [
      "Open link in new tab",
      "Copy link address",
      "Open image in new tab",
      "Copy image address",
    ],
    "rows-video": ["Open video in new tab", "Copy video address"],
    "rows-audio": ["Open audio in new tab", "Copy audio address"],
    "rows-text": ["Paste", "Paste as plain text"],
    "rows-password-empty": ["Paste", "Paste as plain text"],
  })) {
    const expected = main.find((entry) => entry.id === id);
    assert.equal(expected.outcome, "native-menu", id);
    const rows = expected.rows.map(([label]) => label);
    for (const label of labels)
      assert.ok(rows.includes(label), `${id}: ${label}`);
    // Navigation, Print, Inspect and Developer tools are on every menu.
    for (const label of [
      "Back",
      "Reload",
      "Print",
      "Inspect",
      "Developer tools",
    ])
      assert.ok(rows.includes(label), `${id}: ${label}`);
  }
  // In a password field Copy and Cut stay disabled and both pastes work.
  for (const id of [
    "rows-password-empty",
    "rows-password-filled",
    "rows-password-selected",
  ]) {
    const rows = new Map(main.find((entry) => entry.id === id).rows);
    assert.deepEqual(
      ["Cut", "Copy", "Paste", "Paste as plain text"].map((l) => rows.get(l)),
      [false, false, true, true],
      id,
    );
  }
  // The page's own handling: on the element, inline, on document, in a frame
  // of the same and of another origin, by keyboard, and for a whole document.
  assert.deepEqual(
    steps
      .filter((expected) => expected.outcome === "page-handled")
      .map((expected) => expected.id),
    [
      "own-prevent",
      "own-menu",
      "own-inline",
      "own-document",
      "frame-own",
      "xframe-own",
      "key-own",
      "global-plain",
      "global-link",
      "global-image",
      "global-video",
      "global-text",
      "key-global",
    ],
  );
  // A handler that does not prevent the default leaves the native menu.
  for (const id of ["own-passive", "own-stop", "own-mouse"])
    assert.equal(main.find((entry) => entry.id === id).outcome, "native-menu");
  assert.deepEqual(
    steps
      .filter((expected) => expected.outcome === "host-refused")
      .map((expected) => expected.id),
    ["blocked", "hidden", "manual-active", "revoked"],
  );
});

test("one right-click is classified from the page trace, the engine request and the probe call", () => {
  const trace = { prevented: false };
  const asked = { before: 3, after: 4 };
  const quiet = { before: 3, after: 3 };
  for (const [step, outcome] of [
    [{ trace, requests: asked, menus: [[]] }, "native-menu"],
    [{ requests: asked, menus: [[]] }, "native-menu"],
    [{ trace, requests: asked, menus: [] }, "host-refused"],
    [{ requests: asked, menus: [] }, "host-refused"],
    [
      { trace: { prevented: true }, requests: quiet, menus: [] },
      "page-handled",
    ],
    // The page let the event through and still nothing was asked.
    [{ trace, requests: quiet, menus: [] }, "no-request"],
    [{ mouseOnly: {}, requests: quiet, menus: [] }, "no-contextmenu-event"],
    [{ requests: quiet, menus: [] }, "not-delivered"],
    [{}, "not-delivered"],
    [{ notSent: "target outside the viewport" }, "not-sent"],
    // A probe call without an engine request cannot happen in the handler.
    [{ trace, requests: quiet, menus: [[]] }, "inconsistent"],
  ])
    assert.equal(classifyMenuStep(step), outcome, JSON.stringify(step));
  // A page that prevented the default while the engine still asked is not
  // "page-handled": that is exactly the defect this mode exists to catch.
  assert.equal(
    classifyMenuStep({
      trace: { prevented: true },
      requests: asked,
      menus: [[]],
    }),
    "native-menu",
  );
});

test("a synthetic report that matches the plan has no differences and counts the page-handled cases", () => {
  const evidence = assessMenuReport(syntheticMenuReport());
  assert.equal(evidence.usable, true);
  assert.deepEqual(evidence.differences, []);
  assert.equal(evidence.observedSteps, evidence.plannedSteps);
  assert.deepEqual(
    [evidence.pageWins.planned, evidence.pageWins.observed],
    [13, 13],
  );
  assert.equal(evidence.productionReady, false);
  assert.equal(evidence.actualCefAcceptance, false);
  const text = formatMenuEvidence(evidence);
  assert.match(text, /^Native context menu: real-engine evidence/);
  assert.match(
    text,
    /own-prevent \[own-prevent\]: page-handled \| page saw own-prevent prevented=true by page \| engine requests \+0 \| probe menus 0/,
  );
  assert.match(
    text,
    /rows-link \[link\]: native-menu .*\n {6}rows: \+Open link in new tab \+Copy link address -Back -Forward \+Reload -Stop loading \+Print \+Inspect \+Developer tools/,
  );
  assert.match(
    text,
    /Copy link address: selected \| copied \["https:\/\/fixture\.test\/menu-target\?item=1#part"\]/,
  );
  assert.match(text, /Open link in new tab: offered disabled, not run/);
  assert.match(
    text,
    /rows-link-js \[link-js\][^\n]*\n[^\n]*\n {6}engine: link_url about:blank#blocked \| unfiltered_link_url javascript:void\(0\) \| media none \| editable false \| edit flags 0 \(none\) \| point \(70, 32\) sent \(70, 32\)/,
  );
  assert.match(
    text,
    /engine: media none \| editable true \| edit flags 336 \(PASTE\|SELECT_ALL\|EDIT_RICHLY\)/,
  );
  assert.match(text, /The page's own menu wins: 13 of 13 planned cases/);
  assert.match(
    text,
    /fixture window: foreground at start false, at end false, ever false; windows above it at start 3\n {2}foreground owned by a window of the client: never\n {2}other shown top-level windows of the client at 0 ms: none/,
  );
  assert.deepEqual(evidence.distinctDifferences, []);
  assert.doesNotMatch(text, /grouped:|STOPPED|FOREGROUND TAKEN/);
  assert.equal(evidence.foregroundTaken, false);
  assert.equal(
    text.match(/foreground owned by a window of the client: never/g).length,
    2,
  );
  assert.match(text, /observed \d+\/\d+ steps; 0 with differences$/);
  assert.doesNotMatch(text, /DIFFERENCE|NOT RUN|DID NOT RUN/);
});

test("every departure from the plan is listed and no expectation bends to an observation", () => {
  const differencesOf = (mutate, id) => {
    const report = syntheticMenuReport();
    mutate(menuNativeStep(report, id), report);
    return menuStep(report, id).differences;
  };
  // The engine asked for a native menu although the page prevented the default.
  const overridden = syntheticMenuReport();
  const step = menuNativeStep(overridden, "own-menu");
  step.requests.after = step.requests.before + 1;
  step.menus = [[menuRow(["Reload", true])]];
  assert.deepEqual(menuStep(overridden, "own-menu").differences, [
    "outcome native-menu, expected page-handled",
  ]);
  const evidence = assessMenuReport(overridden);
  assert.deepEqual(
    [evidence.pageWins.planned, evidence.pageWins.observed],
    [13, 12],
  );
  assert.match(
    formatMenuEvidence(evidence),
    /12 of 13 planned cases[^\n]*\n {3}own-menu: native-menu/,
  );
  // A menu where the host had to refuse one, and no menu where one is due.
  assert.deepEqual(
    differencesOf((entry) => {
      entry.menus = [[menuRow(["Reload", true])]];
    }, "hidden"),
    ["outcome native-menu, expected host-refused"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.requests.after = entry.requests.before;
      entry.menus = [];
    }, "own-passive"),
    ["outcome no-request, expected native-menu"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      delete entry.trace;
      entry.requests.after = entry.requests.before;
      entry.menus = [];
    }, "rows-plain"),
    ["outcome not-delivered, expected native-menu"],
  );
  // Rows: an extra row, a missing row, a wrong state and a wrong order.
  assert.deepEqual(
    differencesOf((entry) => {
      entry.menus[0].splice(4, 0, menuRow(["Select all", true]));
    }, "rows-plain"),
    ["row not expected: Select all (enabled)"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.menus[0] = entry.menus[0].filter(([, label]) => label !== "Print");
    }, "rows-link"),
    ["row missing: Print"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.menus[0].find(([, label]) => label === "Copy")[2] = true;
    }, "rows-password-empty"),
    ["Copy: enabled, expected disabled"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.menus[0].reverse();
    }, "rows-image"),
    [
      "row order: Developer tools, Inspect, Print, Stop loading, Reload, Forward, Back, Copy image address, Open image in new tab; expected Open image in new tab, Copy image address, Back, Forward, Reload, Stop loading, Print, Inspect, Developer tools",
    ],
  );
  // A value K10 does not state is reported and never compared.
  const unstated = syntheticMenuReport();
  menuNativeStep(unstated, "rows-link-frame-origin").menus[0][0][2] = false;
  assert.deepEqual(
    menuStep(unstated, "rows-link-frame-origin").differences,
    [],
  );
  assert.deepEqual(menuStep(unstated, "rows-link-frame-origin").rows[0], [
    "Open link in new tab",
    false,
  ]);
  // Commands.
  assert.deepEqual(
    differencesOf((entry) => {
      entry.copied = [];
    }, "copy-link"),
    ['copied [], expected ["https://fixture.test/menu-target?item=1#part"]'],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.tabs.after = 2;
    }, "open-link"),
    ["tabs opened: 2, expected 1"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.tabs.after = 0;
      entry.served = {};
    }, "open-link"),
    [
      "tabs opened: 0, expected 1",
      "fixture requests for target-1: 0, expected 1",
    ],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.answers[0].enabled = true;
      entry.tabs.after = 1;
    }, "open-link-other"),
    [
      "Open link in new tab was selected, expected a disabled row",
      "tabs opened: 1, expected 0",
    ],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.answers[0].offered = false;
      entry.answers[0].handedBack = false;
    }, "reload"),
    [
      "row not offered: Reload",
      "Reload was not selectable, expected an enabled row",
    ],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.host.loading = [true, true];
    }, "stop"),
    ["loading [true,true], expected [true,false]"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.pageReports = [];
    }, "delete"),
    ["the page reported no input event"],
  );
  // The run must never write the OS clipboard, whatever the step.
  for (const id of ["copy-image", "rows-text", "own-prevent"])
    assert.ok(
      differencesOf((entry) => {
        entry.clipboardSequence.after = 42;
      }, id).includes(
        "the OS clipboard sequence number changed during this step",
      ),
      id,
    );
  // What the engine reported against what the unit tests assume of it.
  assert.deepEqual(
    differencesOf((entry) => {
      entry.reported[0].editFlags = 16 | 64 | 128;
    }, "rows-password-empty"),
    ["engine edit flags PASTE|SELECT_ALL; the unit tests assume PASTE"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.reported[0].editFlags = 64 | 128;
    }, "rows-plain"),
    ["engine edit flags SELECT_ALL; the unit tests assume none"],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.reported[0].media = "audio";
    }, "rows-video"),
    ['engine media "audio"; the unit tests assume "video"'],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.reported[0].link = "about:blank#blocked";
    }, "rows-link-other"),
    [
      'engine link "about:blank#blocked"; the unit tests assume "https://elsewhere.test/menu-target?item=6"',
    ],
  );
  // The click point is the one "Inspect" would hand to the engine.
  assert.deepEqual(
    differencesOf((entry) => {
      entry.reported[0].point = [56, 26];
    }, "frame-link"),
    [
      "the engine reported the click at (56, 26); it was sent at (70, 32) in view coordinates",
    ],
  );
  assert.deepEqual(
    differencesOf((entry) => {
      entry.reported[0].point = [71, 31];
    }, "frame-link"),
    [],
  );
  // The same difference on several steps is listed once, with its steps.
  const repeated = syntheticMenuReport();
  for (const id of ["rows-plain", "rows-link", "frame-link"])
    menuNativeStep(repeated, id).menus[0].find(
      ([, label]) => label === "Back",
    )[2] = true;
  menuNativeStep(repeated, "open-link").tabs.after = 2;
  const grouped = assessMenuReport(repeated);
  assert.deepEqual(grouped.distinctDifferences, [
    {
      difference: "Back: enabled, expected disabled",
      steps: [
        "menu-main/rows-plain",
        "menu-main/rows-link",
        "menu-main/frame-link",
      ],
    },
    {
      difference: "tabs opened: 2, expected 1",
      steps: ["menu-main/open-link"],
    },
  ]);
  assert.match(
    formatMenuEvidence(grouped),
    /Differences from K10 and the unit tests, grouped:\n {2}Back: enabled, expected disabled \[3: menu-main\/rows-plain, menu-main\/rows-link, menu-main\/frame-link\]\n {2}tabs opened: 2, expected 1 \[1: menu-main\/open-link\]/,
  );
  // A window of the client other than the fixture window is named.
  const windowed = syntheticMenuReport();
  windowed.menu.scenarios[0].window.otherShownTopLevelWindows.push({
    atMs: 1200,
    duringStep: "rows-audio",
    windows: [
      {
        class: "Chrome_WidgetWin_1",
        width: 320,
        height: 40,
        topmost: true,
        noActivate: true,
      },
    ],
  });
  windowed.menu.scenarios[0].inputNotDelivered = true;
  const windowedText = formatMenuEvidence(assessMenuReport(windowed));
  assert.match(
    windowedText,
    /other shown top-level windows of the client at 1200 ms \(step rows-audio\): Chrome_WidgetWin_1 320x40 topmost no-activate/,
  );
  assert.match(
    windowedText,
    /STOPPED: five right-clicks in a row reached neither the page nor the engine/,
  );
  // Any window of the client as the foreground window is stated, with the
  // step during which it happened; the fixture window alone is not the test.
  const taken = syntheticMenuReport();
  taken.menu.scenarios[0].window.foregroundOwnedByClient = [
    { atMs: 31600, duringStep: "open-link", window: "Tao Thread Event Target" },
    { atMs: 52000, duringStep: null, window: null },
  ];
  const takenEvidence = assessMenuReport(taken);
  assert.equal(takenEvidence.foregroundTaken, true);
  assert.equal(takenEvidence.scenarios[0].window.everForeground, false);
  assert.match(
    formatMenuEvidence(takenEvidence),
    /FOREGROUND TAKEN by a window of the client: Tao Thread Event Target at 31600 ms \(step open-link\)\n/,
  );
  const unknown = syntheticMenuReport();
  delete unknown.menu.scenarios[1].window.foregroundOwnedByClient;
  assert.equal(assessMenuReport(unknown).foregroundTaken, null);
  assert.match(
    formatMenuEvidence(assessMenuReport(unknown)),
    /foreground owned by a window of the client: not recorded/,
  );
  // Where a history step left the view is printed with the step.
  const effects = syntheticMenuReport();
  menuNativeStep(effects, "back-first-page").host.mainFrame = [
    "fixture-page",
    "about:blank",
  ];
  const effectsText = formatMenuEvidence(assessMenuReport(effects));
  assert.match(effectsText, /Back: selected[^\n]*view shows about:blank/);
  // One right-click, one request, one menu.
  assert.deepEqual(
    differencesOf((entry) => {
      entry.requests.after += 1;
    }, "rows-plain"),
    ["one right-click produced 2 requests and 1 menus"],
  );
  // The click landed elsewhere.
  assert.deepEqual(
    differencesOf((entry) => {
      entry.trace.target = "plain";
    }, "rows-link"),
    ["the page saw the click on plain, not link"],
  );
});

test("steps that did not run are listed and a foreign, stale or re-planned report observes nothing", () => {
  const partial = syntheticMenuReport();
  partial.menu.scenarios[0].steps = partial.menu.scenarios[0].steps.slice(0, 6);
  partial.menu.scenarios.pop();
  const evidence = assessMenuReport(partial);
  assert.equal(evidence.usable, true);
  assert.equal(evidence.observedSteps, 5);
  assert.equal(evidence.scenarios[0].notRun.includes("own-prevent"), true);
  assert.equal(evidence.scenarios[1].ran, false);
  assert.deepEqual(
    [evidence.pageWins.planned, evidence.pageWins.observed],
    [13, 0],
  );
  const text = formatMenuEvidence(evidence);
  assert.match(text, /NOT RUN: rows-link-other, /);
  assert.match(
    text,
    /Scenario menu-global \(popup policy block\): DID NOT RUN/,
  );
  assert.match(text, / {3}own-prevent: not-run/);
  for (const mutate of [
    (report) => (report.mode = "measure"),
    (report) => delete report.mode,
    (report) => (report.bindingPin = "153.0.0"),
    (report) => (report.productionReady = true),
    (report) => (report.menu.schema = 2),
    (report) => report.menu.plan[0].steps.pop(),
    (report) => (report.menu.plan[0].steps[3].target = "plain"),
    (report) => report.menu.neverSelected.pop(),
    (report) => delete report.menu,
  ]) {
    const report = syntheticMenuReport();
    mutate(report);
    const foreign = assessMenuReport(report);
    assert.equal(foreign.usable, false);
    assert.equal(foreign.observedSteps, 0);
    assert.equal(foreign.pageWins.observed, 0);
    assert.match(formatMenuEvidence(foreign), /\nNOT OBSERVED: /);
  }
  for (const report of [null, undefined, {}, { menu: {} }])
    assert.equal(assessMenuReport(report).usable, false);
});

test("rows that open a tab: one tab each where popups open tabs, shown disabled where popups are blocked", () => {
  const [main, blocked] = MENU_EVIDENCE_PLAN;
  assert.equal(main.popups, "tabs");
  assert.equal(blocked.popups, "block");
  const kinds = ["link", "image", "video", "audio"];
  for (const kind of kinds) {
    const expected = main.steps.find((step) => step.id === `open-${kind}`);
    assert.equal(expected.target, kind);
    assert.equal(expected.pick, `Open ${kind} in new tab`);
    assert.equal(expected.selected, true);
    assert.equal(expected.tabs, 1);
  }
  // Blocked: the same four rows, each asked for and none to run.
  assert.deepEqual(
    blocked.steps
      .filter((step) => step.pick?.startsWith("Open "))
      .map((step) => [
        step.id,
        step.target,
        step.pick,
        step.selected,
        step.tabs,
      ]),
    kinds.map((kind) => [
      `open-${kind}-popups-blocked`,
      kind,
      `Open ${kind} in new tab`,
      false,
      0,
    ]),
  );
  for (const kind of kinds) {
    const id = `open-${kind}-popups-blocked`;
    const rows = new Map(blocked.steps.find((step) => step.id === id).rows);
    // Shown, disabled, beside a Copy row that still works.
    assert.equal(rows.get(`Open ${kind} in new tab`), false, id);
    assert.equal(rows.get(`Copy ${kind} address`), true, id);
    // A handler that leaves the row enabled there is reported for that row.
    const enabled = syntheticMenuReport();
    const step = menuNativeStep(enabled, id);
    step.menus[0].find(([, label]) => label === `Open ${kind} in new tab`)[2] =
      true;
    step.answers[0].enabled = true;
    assert.deepEqual(menuStep(enabled, id).differences, [
      `Open ${kind} in new tab: enabled, expected disabled`,
      `Open ${kind} in new tab was selected, expected a disabled row`,
    ]);
    // So is a tab that opens anyway.
    const opened = syntheticMenuReport();
    menuNativeStep(opened, id).tabs.after = 1;
    assert.deepEqual(menuStep(opened, id).differences, [
      "tabs opened: 1, expected 0",
    ]);
    // Where popups open tabs: no tab, or two, is a difference.
    for (const [tabs, text] of [
      [0, "tabs opened: 0, expected 1"],
      [2, "tabs opened: 2, expected 1"],
    ]) {
      const counted = syntheticMenuReport();
      menuNativeStep(counted, `open-${kind}`).tabs.after = tabs;
      assert.ok(
        menuStep(counted, `open-${kind}`).differences.includes(text),
        `${kind}: ${text}`,
      );
    }
  }
});

test("the evidence lists what the client's UI thread activated and focused, on any desktop", () => {
  const quiet = formatMenuEvidence(assessMenuReport(syntheticMenuReport()));
  assert.doesNotMatch(quiet, /UI thread at /);
  const report = syntheticMenuReport();
  report.menu.scenarios[0].window.uiThreadWindows = [
    {
      atMs: 0,
      duringStep: null,
      windows: {
        active: null,
        activeShown: false,
        focus: null,
        focusInsideFixtureWindow: false,
      },
    },
    {
      atMs: 310,
      duringStep: "calibrate",
      windows: {
        active: "fixture-window",
        activeShown: true,
        focus: "Chrome_RenderWidgetHostHWND",
        focusInsideFixtureWindow: true,
      },
    },
    {
      atMs: 31600,
      duringStep: "open-link",
      windows: {
        active: "Chrome_WidgetWin_0",
        activeShown: false,
        focus: "Chrome_WidgetWin_0",
        focusInsideFixtureWindow: false,
      },
    },
  ];
  const evidence = assessMenuReport(report);
  // Passed through untouched, and never a difference or a verdict.
  assert.equal(evidence.scenarios[0].window.uiThreadWindows.length, 3);
  assert.deepEqual(evidence.differences, []);
  const text = formatMenuEvidence(evidence);
  assert.match(
    text,
    /^ {2}UI thread at 0 ms: active window none, focus none$/m,
  );
  assert.match(
    text,
    /^ {2}UI thread at 310 ms \(step calibrate\): active window fixture-window, focus Chrome_RenderWidgetHostHWND inside the fixture window$/m,
  );
  assert.match(
    text,
    /^ {2}UI thread at 31600 ms \(step open-link\): active window Chrome_WidgetWin_0 \(not shown\), focus Chrome_WidgetWin_0 OUTSIDE the fixture window$/m,
  );
  // The native side reads it from its own thread and changes nothing.
  const menu = menuSource();
  assert.match(menu, /let held = os::ui_thread_windows\(&parent\);/);
  assert.match(menu, /"uiThreadWindows":ui_windows,/);
  assert.match(
    menu,
    /if unsafe \{ GetGUIThreadInfo\(GetCurrentThreadId\(\), &mut info\) \} == 0 \{/,
  );
});

test("a menu report is never acceptance evidence, nor a measurement, and never claims readiness", () => {
  const report = syntheticMenuReport();
  const acceptance = assessNativeReport(report);
  assert.equal(acceptance.ok, false);
  assert.ok(
    acceptance.failures.includes(
      "context-menu evidence report is not acceptance evidence",
    ),
  );
  assert.ok(
    !assessNativeReport({ schema: 1 }).failures.includes(
      "context-menu evidence report is not acceptance evidence",
    ),
  );
  assert.equal(assessMeasurementReport(report).measured, 0);
  assert.equal(assessMenuReport(syntheticMeasurementReport()).usable, false);
});

test("the menu suite takes no measurement options, sets its mode only in its own branch and returns before any acceptance verdict", async () => {
  for (const options of [{ windowMs: 12000 }, { only: "baseline-visible" }])
    await assert.rejects(
      runAcceptance({
        executable: "never-launched",
        output: "never-created",
        suite: "menu",
        ...options,
      }),
      /apply to measure/,
    );
  await assert.rejects(
    runAcceptance({
      executable: "never-launched",
      output: "never-created",
      suite: "menus",
    }),
    /Unknown acceptance suite/,
  );
  const source = readFileSync(
    new URL("../../scripts/cef-browser-acceptance.mjs", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const runner = source.slice(
    source.indexOf("export async function runAcceptance("),
    source.indexOf("async function main(args)"),
  );
  const scrub = runner.indexOf(
    "for (const name of MEASUREMENT_VARIABLES) delete env[name];",
  );
  const set = runner.indexOf(
    'if (suite === "menu") env.SORNG_CEF_ACCEPTANCE_MODE = "menu";',
  );
  const spawned = runner.indexOf(
    "const child = spawn(launch?.command ?? executable",
  );
  assert.ok(scrub > 0 && scrub < set && set < spawned);
  assert.equal(runner.match(/SORNG_CEF_ACCEPTANCE_MODE = /g).length, 2);
  const branch = runner.indexOf('if (suite === "menu") {', spawned);
  const verdict = runner.indexOf("assessNativeTlsReport(");
  assert.ok(branch > 0 && verdict > branch);
  const evidence = runner.slice(branch, verdict);
  assert.match(
    evidence,
    /return report;\s*\}\s*\/\/ Independent of positive\/negative TLS outcomes/,
  );
  assert.doesNotMatch(evidence, /nativeTlsFixtureAccepted|acceptance\.json/);
  assert.match(
    evidence,
    /actualCefAcceptance: false,\s*publicProviderAcceptance: false,\s*productionReady: false,/,
  );
  // A difference is a result: only the tool's own failures clear `ok`.
  assert.match(evidence, /ok: failures\.length === 0,/);
  assert.doesNotMatch(evidence, /failures\.push\([^)]*differences/);
  assert.match(
    source,
    /if \(command === "menu"\) return launch\("menu", options\);/,
  );
});

test("the native menu client clicks only its own browser through the engine and writes no clipboard", () => {
  const menu = menuSource();
  const measure = acceptanceSource("src/measure.rs");
  const server = acceptanceSource("src/fixture.rs");
  const manifest = acceptanceSource("Cargo.toml");
  // The probe feature is compiled into this client only.
  assert.match(
    manifest,
    /sorng-browser-host = \{ path = "\.\.\/\.\.", features = \["cef-host", "acceptance-probe"\] \}/,
  );
  // The mode shares the measurement window: unfocused, disabled, not activated.
  assert.match(
    measure,
    /Ok\(mode\) if mode == "measure" \|\| mode == "menu" => Ok\(true\),/,
  );
  assert.match(
    measure,
    /if menu::requested\(\) \{\s*return menu::run\(&mut run, failures\);\s*\}/,
  );
  assert.match(
    menu,
    /os::lower\(&run\.parent\);\s*shell::present_inert\(&run\.parent\);\s*os::lower\(&run\.parent\);\s*for plan in &PLANS \{/,
  );
  // No OS-level input, no clipboard write, no focus or foreground call.
  assert.doesNotMatch(
    menu,
    /SendInput|keybd_event|\bmouse_event\b|SetCursorPos|PostMessage|SendMessage|OpenClipboard|SetClipboardData|EmptyClipboard|GetClipboardData|AttachThreadInput|BringWindowToTop|SwitchToThisWindow|SetForegroundWindow|SetActiveWindow|SetFocus\b|ShowWindow|EnableWindow|\.set_focus\(/,
  );
  // The clipboard is only ever asked for its sequence number: nothing of
  // its content or formats is read, and no step pastes.
  assert.deepEqual(
    [...new Set(menu.match(/\b\w*Clipboard\w*\(/g))],
    ["GetClipboardSequenceNumber("],
  );
  assert.doesNotMatch(menu, /\bpick\([^)]*"Paste/);
  // The fixture window only moves down the Z order, never up, never active.
  assert.equal(menu.match(/SetWindowPos\(/g).length, 2);
  assert.match(
    menu,
    /SetWindowPos\(\s*window,\s*HWND_BOTTOM as Hwnd,\s*0,\s*0,\s*0,\s*0,\s*KEEP_PLACE_AND_FOCUS,\s*\);/,
  );
  // Other windows of the client are listed by class and size; a title can
  // carry page text and is never read.
  assert.doesNotMatch(menu, /GetWindowText|WM_GETTEXT|GetDlgItemText/);
  assert.match(menu, /const KEEP_PLACE_AND_FOCUS: u32 = 0x1 \| 0x2 \| 0x10;/);
  assert.match(menu, /const HWND_BOTTOM: isize = 1;/);
  // Engine input exists in four functions, each on a browser handed to it.
  const senders = [
    ...menu.matchAll(
      /fn (\w+)\(engine: &Browser[^\n]*\) -> bool \{([\s\S]*?)\n\}\n/g,
    ),
  ];
  assert.deepEqual(
    senders.map(([, name]) => name),
    ["press", "hover", "wheel", "key"],
  );
  const calls =
    /host\.send_(?:mouse_click|mouse_move|mouse_wheel|key)_event\(/g;
  assert.equal(
    senders.reduce((sum, [, , body]) => sum + body.match(calls).length, 0),
    menu.match(calls).length,
  );
  assert.equal(menu.match(/\.send_\w+\(/g).length, menu.match(calls).length);
  for (const [, , body] of senders)
    assert.match(
      body,
      /engine\.host\(\)\.filter\(\|_\| engine\.is_valid\(\) == 1\)/,
    );
  // That browser is the one the host created for this scenario.
  assert.equal(
    menu.match(/browser_host_get_browser_by_identifier\(/g).length,
    2,
  );
  assert.match(
    menu,
    /let \[id\] = created\[\.\.\] else \{\s*return Err\("the scenario's own browser could not be identified"\.into\(\)\);/,
  );
  assert.match(
    menu,
    /if matched == Some\(false\) \{\s*return Err\("the identified browser is not the scenario's child window"\.into\(\)\);/,
  );
  // The probe is installed before the first navigation, so no view that can
  // be clicked is ever without it.
  const prepare = menu.slice(
    menu.indexOf("fn prepare(&mut self"),
    menu.indexOf("fn absorb(&mut self"),
  );
  const probed = prepare.indexOf("browser.probe_context_menu(");
  const observed = prepare.indexOf("browser.observe_context_menu_targets(");
  assert.ok(probed > 0 && probed < observed);
  assert.ok(observed < prepare.indexOf("self.slot.navigate("));
  // The observer alone would leave the OS popup in place: it is never
  // installed without the stand-in for the popup.
  assert.equal(menu.match(/\.probe_context_menu\(/g).length, 1);
  assert.equal(menu.match(/\.observe_context_menu_targets\(/g).length, 1);
  assert.equal(menu.match(/\.navigate\(/g).length, 2);
  assert.match(
    prepare,
    /self\.record\.insert\("probeInstalled"\.into\(\), true\.into\(\)\);/,
  );
  // The fixture window is not the only window of this process: whichever
  // of them is the foreground window is recorded at every change.
  assert.match(
    menu,
    /let owner = shell::foreground_own\(&parent\);\s*if owner != own_foreground_now && own_foreground\.len\(\) < 64 \{/,
  );
  assert.match(menu, /"foregroundOwnedByClient":own_foreground,/);
  // A withheld row is never handed back to the probe.
  assert.match(
    menu,
    /handed: row\.filter\(\|_\| !withheld\)\.map\(\|row\| row\.0\),/,
  );
  // Fixture-only resources, served before the legacy trace, and a report that
  // is marked only when a menu document exists.
  assert.match(measure, /\) \|\| menu::serves\(route\)\n\}/);
  assert.match(
    measure,
    /if menu::serves\(route\) \{\s*return menu::serve\(tls, state, route, header, body\)\.await;\s*\}/,
  );
  assert.match(
    server,
    /if let Some\(menu\) = &state\.measure\.menu\.document \{\s*report\["mode"\] = "menu"\.into\(\);/,
  );
  assert.doesNotMatch(
    menu,
    /lookup_host|ToSocketAddrs|std::fs::|std::env::(?!var\(|consts)/,
  );
});

test("menu fixture pages observe passively, hold no paste target and name only fixture hosts", () => {
  const page = acceptanceSource("fixtures/menu-page.html");
  const frame = acceptanceSource("fixtures/menu-frame.html");
  const target = acceptanceSource("fixtures/menu-target.html");
  for (const source of [page, frame, target]) {
    assert.doesNotMatch(
      source,
      /navigator\.clipboard|clipboardData|execCommand|document\.cookie|localStorage|sessionStorage|window\.open|eval\(|dispatchEvent|\.click\(|\.focus\(|\.blur\(|\.select\(|showModal|alert\(|confirm\(|prompt\(|print\(/i,
    );
    for (const [, url] of source.matchAll(
      /["'`]((?:https?|wss?):\/\/[^"'`]+)["'`]/g,
    ))
      assert.match(
        url,
        /^https?:\/\/(?:fixture|frame|elsewhere)\.test(?:\/|$)/,
        url,
      );
  }
  assert.doesNotMatch(target, /<script/);
  // A field's value is only ever measured. No field is there to be pasted
  // into: every field holds text this page wrote.
  for (const source of [page, frame])
    for (const [use] of source.matchAll(/\.value\b[^\n;,)}\]]*/g))
      assert.match(use, /^\.value\.length/, use);
  for (const source of [page, frame])
    assert.doesNotMatch(
      source,
      /id="paste|data-private|addEventListener\('paste'/,
    );
  // The trace is registered in the capture phase before any handler of the
  // page's own, and reports what became of the event after they all ran.
  const trace = page.indexOf("addEventListener('contextmenu', event => {");
  assert.ok(trace > 0 && trace < page.indexOf("const own = (id, handle)"));
  assert.match(
    page,
    /setTimeout\(\(\) => post\('trace', Object\.assign\(seen, \{\s*prevented: event\.defaultPrevented, handledBy, ownMenu: !pageMenu\.hidden,/,
  );
  // The default is prevented only where the page plays a site with its own
  // menu; the passive, stop-only and mouse-only regions leave contextmenu.
  assert.match(
    page,
    /own\('own-prevent', event => event\.preventDefault\(\)\);/,
  );
  assert.match(
    page,
    /own\('own-menu', event => \{ event\.preventDefault\(\); pageMenu\.hidden = false; \}\);/,
  );
  assert.match(page, /own\('own-passive', \(\) => \{\}\);/);
  assert.match(page, /own\('own-stop', event => event\.stopPropagation\(\)\);/);
  assert.match(page, /oncontextmenu="handledBy = 'own-inline'; return false"/);
  assert.match(
    page,
    /for \(const type of \['pointerdown', 'mousedown', 'mouseup', 'auxclick'\]\)\s*document\.getElementById\('own-mouse'\)/,
  );
  assert.match(
    page,
    /else if \(GLOBAL\) \{\s*handledBy = 'document-global';\s*event\.preventDefault\(\);/,
  );
  assert.match(
    frame,
    /document\.getElementById\('own'\)\.addEventListener\('contextmenu', event => \{\s*handledBy = PREFIX \+ 'own';\s*event\.preventDefault\(\);/,
  );
  // Nothing in either page asks for a menu or re-dispatches an event.
  assert.equal(page.match(/preventDefault\(\)/g).length, 6);
  assert.equal(frame.match(/preventDefault\(\)/g).length, 1);
});

// ---------------------------------------------------------------------------
// Where the client's windows go. On Windows every suite starts the client on
// a desktop made for the run; the desktop of whoever uses the machine is
// reached only through an option that says so. The launcher tests below start
// cmd.exe, never the client, and never a window.
// ---------------------------------------------------------------------------
const LAUNCHER = new URL(
  "../../src-tauri/crates/sorng-browser-host/tests/native_acceptance/launch-on-private-desktop.ps1",
  import.meta.url,
);
const cleanDesktopResult = () => ({
  schema: 1,
  desktop: "sorng-acceptance-0123456789abcdef",
  windowStation: "WinSta0",
  desktopSecurity: "access-list-and-label-of-current-desktop",
  started: true,
  error: null,
  pid: 4242,
  exitCode: 0,
  timedOut: false,
  foregroundViolation: false,
  foregroundViolationWindowClass: null,
  samples: 180,
  clientForegroundSamples: 0,
  clientForegroundOwnerChanges: 0,
  foregroundOwnerChanges: 3,
  clipboardSequenceBefore: 77,
  clipboardSequenceAfter: 77,
  clipboardChanges: 0,
  peakProcessesInJob: 6,
  processesLeftInJob: 0,
  leftoversTerminated: false,
  desktopClosed: true,
  desktopGone: true,
  elapsedMs: 9000,
});

test("the desktop of whoever uses the machine is reached only through its own option", () => {
  assert.equal(INTERACTIVE_DESKTOP_OPTION, "use-interactive-desktop");
  assert.equal(desktopFor({ platform: "win32" }), "private");
  assert.equal(
    desktopFor({ platform: "win32", interactiveDesktop: "false" }),
    "private",
  );
  assert.equal(
    desktopFor({ platform: "win32", interactiveDesktop: "true" }),
    "interactive",
  );
  // Elsewhere there is no launcher; the caller's display is used as before.
  for (const platform of ["linux", "darwin"]) {
    assert.equal(desktopFor({ platform }), "caller-provided");
    assert.equal(
      desktopFor({ platform, interactiveDesktop: "true" }),
      "interactive",
    );
  }
  for (const interactiveDesktop of ["yes", "1", "TRUE", "", true, 1, null])
    assert.throws(
      () => desktopFor({ platform: "win32", interactiveDesktop }),
      /--use-interactive-desktop must be true or false/,
    );
  // The manual TLS window is for a person, who cannot see a private desktop.
  for (const platform of ["win32", "linux", "darwin"])
    assert.throws(
      () => desktopFor({ platform, manual: "true" }),
      /--manual true shows a window to a person and needs --use-interactive-desktop true/,
    );
  assert.equal(
    desktopFor({
      platform: "win32",
      manual: "true",
      interactiveDesktop: "true",
    }),
    "interactive",
  );

  const source = readFileSync(
    new URL("../../scripts/cef-browser-acceptance.mjs", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const decision = source.slice(
    source.indexOf("export function desktopFor("),
    source.indexOf("export function privateDesktopLaunch("),
  );
  // Nothing inherited decides it: no environment variable, no CI detection.
  assert.doesNotMatch(decision, /process\.|env\b/);
  const runner = source.slice(
    source.indexOf("export async function runAcceptance("),
    source.indexOf("async function main(args)"),
  );
  assert.match(runner, /interactiveDesktop = "false",/);
  const decided = runner.indexOf("const desktop = desktopFor({");
  const created = runner.indexOf("await mkdir(output, { recursive: false });");
  assert.ok(decided > 0 && decided < created);
  // One spawn of the client, and the launcher is used whenever the decision
  // is "private"; nothing else in the runner chooses.
  assert.match(
    runner,
    /const launch =\s*desktop === "private"\s*\? privateDesktopLaunch\(\{ executable, output, timeoutMs \}\)\s*: undefined;\s*const child = spawn\(launch\?\.command \?\? executable, launch\?\.args \?\? \[\], \{/,
  );
  assert.equal(runner.match(/desktop === /g).length, 1);
  assert.equal(runner.match(/desktopFor\(/g).length, 1);
  assert.equal(runner.match(/interactiveDesktop/g).length, 2);
  // The command line passes the opt-in on under its own name only.
  const main = source.slice(source.indexOf("async function main(args)"));
  assert.match(
    main,
    /const \{ \[INTERACTIVE_DESKTOP_OPTION\]: interactiveDesktop, \.\.\.others \} =\s*rest;\s*return runAcceptance\(\{ \.\.\.others, suite, interactiveDesktop \}\);/,
  );
  assert.equal(main.match(/runAcceptance\(/g).length, 1);
  assert.match(
    main,
    /--use-interactive-desktop true puts its windows on the desktop of whoever is using the machine instead\./,
  );
  // Every report says where the client ran, and a run that does not count
  // on a private desktop fails in every suite.
  assert.equal(runner.match(/desktop: desktopRecord\b/g).length, 4);
  assert.equal(runner.match(/\.\.\.desktopFailures/g).length, 3);
});

test("the private-desktop launch names a fresh desktop and keeps its files beside the run directory", () => {
  const output = path.resolve("out", "fresh");
  const executable = path.resolve("bundle", "sorng_cef_acceptance.exe");
  const launch = privateDesktopLaunch({
    executable,
    output,
    timeoutMs: 90000,
    token: "0123456789abcdef",
  });
  assert.equal(launch.command, "pwsh");
  assert.equal(launch.desktop, "sorng-acceptance-0123456789abcdef");
  assert.deepEqual(launch.args, [
    "-NoProfile",
    "-File",
    path.resolve(
      "src-tauri/crates/sorng-browser-host/tests/native_acceptance/launch-on-private-desktop.ps1",
    ),
    "-Executable",
    executable,
    "-WorkingDirectory",
    path.dirname(executable),
    "-Desktop",
    "sorng-acceptance-0123456789abcdef",
    "-TimeoutMs",
    "90000",
    "-StdoutPath",
    path.join(output, "client-stdout.txt"),
    "-StderrPath",
    path.join(output, "client-stderr.txt"),
    "-Result",
    path.join(output, "private-desktop.json"),
  ]);
  // The client must find its run directory empty: nothing goes inside it.
  for (const file of [launch.stdout, launch.stderr, launch.result])
    assert.equal(path.dirname(file), output);
  // The client itself takes no arguments, from the runner or anyone else.
  assert.equal(launch.args.includes("-Arguments"), false);
  const names = new Set();
  for (let index = 0; index < 64; index += 1) {
    const { desktop } = privateDesktopLaunch({
      executable,
      output,
      timeoutMs: 1000,
    });
    assert.match(desktop, /^sorng-acceptance-[0-9a-f]{16}$/);
    names.add(desktop);
  }
  assert.equal(names.size, 64);
  for (const token of [
    "",
    "0123456789ABCDEF",
    "0123456789abcde",
    "../../../x",
    "0123456789abcdef0",
  ])
    assert.throws(
      () =>
        privateDesktopLaunch({ executable, output, timeoutMs: 1000, token }),
      /Invalid private desktop token/,
    );
});

test("a run on a private desktop counts only with a clean foreground, clipboard and shutdown record", () => {
  assert.deepEqual(assessPrivateDesktop(cleanDesktopResult()), []);
  // Foreground changes between other programs are the person's own business.
  assert.deepEqual(
    assessPrivateDesktop({
      ...cleanDesktopResult(),
      foregroundOwnerChanges: 40,
    }),
    [],
  );
  for (const missing of [undefined, null, "", 0, [], "{}"])
    assert.deepEqual(assessPrivateDesktop(missing), [
      "the private-desktop launcher left no result",
    ]);
  const foreground =
    "a process of the client owned the foreground window of the desktop the run was started from; the run was stopped and does not count";
  const clipboard =
    "the clipboard sequence number changed while the client ran; the run does not count";
  for (const [change, expected] of [
    [{ clientForegroundSamples: 1 }, foreground],
    [{ clientForegroundOwnerChanges: 1 }, foreground],
    [{ foregroundViolation: true }, foreground],
    [{ foregroundViolation: undefined }, foreground],
    [{ clientForegroundSamples: undefined }, foreground],
    [{ samples: 0 }, "the desktop the run was started from was never sampled"],
    [
      { samples: undefined },
      "the desktop the run was started from was never sampled",
    ],
    [{ clipboardSequenceAfter: 78 }, clipboard],
    [{ clipboardChanges: 2 }, clipboard],
    [{ clipboardSequenceBefore: -1, clipboardSequenceAfter: -1 }, clipboard],
    [
      { clipboardSequenceBefore: undefined, clipboardSequenceAfter: undefined },
      clipboard,
    ],
    [
      { processesLeftInJob: 2, leftoversTerminated: true },
      "processes of the client outlived it and had to be terminated",
    ],
    [
      { processesLeftInJob: -1 },
      "processes of the client outlived it and had to be terminated",
    ],
    [{ desktopClosed: false }, "the private desktop was not closed"],
    [{ desktopGone: false }, "the private desktop was not closed"],
    [
      { error: "did-not-end" },
      "the private-desktop launcher reported an error",
    ],
  ])
    assert.deepEqual(
      assessPrivateDesktop({ ...cleanDesktopResult(), ...change }),
      [expected],
      JSON.stringify(change),
    );
  // Not started: one reason, and only the launcher's own fixed words.
  assert.deepEqual(
    assessPrivateDesktop({
      ...cleanDesktopResult(),
      started: false,
      error: "create-desktop-failed-5",
    }),
    [
      "the client was not started on a private desktop: create-desktop-failed-5",
    ],
  );
  for (const error of [undefined, null, "", "Access is denied.", "x\ny", "<b>"])
    assert.deepEqual(
      assessPrivateDesktop({ ...cleanDesktopResult(), started: false, error }),
      ["the client was not started on a private desktop: no reason given"],
    );
  // Several things wrong: every one is listed.
  assert.equal(
    assessPrivateDesktop({
      ...cleanDesktopResult(),
      clientForegroundSamples: 9,
      clipboardChanges: 1,
      desktopGone: false,
    }).length,
    3,
  );
});

test("the launcher only creates a desktop, starts the program on it, watches and closes its handles", () => {
  const source = readFileSync(LAUNCHER, "utf8").replaceAll("\r\n", "\n");
  const imported = [...source.matchAll(/static extern \S+ (\w+)\(/g)].map(
    (match) => match[1],
  );
  // Everything the launcher can ask of the system, by name.
  assert.deepEqual(imported, [
    "CreateDesktopW",
    "OpenDesktopW",
    "CloseDesktop",
    "GetThreadDesktop",
    "GetProcessWindowStation",
    "GetUserObjectInformationW",
    "GetUserObjectSecurity",
    "GetForegroundWindow",
    "GetWindowThreadProcessId",
    "GetClassNameW",
    "GetClipboardSequenceNumber",
    "GetCurrentThreadId",
    "CreateJobObjectW",
    "SetInformationJobObject",
    "QueryInformationJobObject",
    "AssignProcessToJobObject",
    "TerminateJobObject",
    "InitializeProcThreadAttributeList",
    "UpdateProcThreadAttribute",
    "DeleteProcThreadAttributeList",
    "CreateProcessW",
    "ResumeThread",
    "WaitForSingleObject",
    "GetExitCodeProcess",
    "TerminateProcess",
    "CloseHandle",
    "CreateFileW",
  ]);
  assert.equal(source.match(/DllImport\(/g).length, imported.length);
  // Nothing that changes which desktop a person sees or types into, sends
  // input, activates a window or touches clipboard content.
  for (const never of [
    "SwitchDesktop",
    "SetThreadDesktop",
    "SetProcessWindowStation",
    "SetForegroundWindow",
    "SetActiveWindow",
    "SetFocus",
    "BringWindowToTop",
    "ShowWindow",
    "SetWindowPos",
    "SendInput",
    "keybd_event",
    "mouse_event",
    "SendMessage",
    "PostMessage",
    "AttachThreadInput",
    "OpenClipboard",
    "GetClipboardData",
    "SetClipboardData",
    "EmptyClipboard",
    "Get-Clipboard",
    "Set-Clipboard",
  ]) {
    assert.equal(imported.includes(never), false, never);
    assert.equal(source.includes(`${never}(`), false, never);
  }
  assert.deepEqual(
    imported
      .filter((name) =>
        /Desktop|WindowStation|Foreground|Clipboard|Window|ClassName/.test(
          name,
        ),
      )
      .sort(),
    [
      "CloseDesktop",
      "CreateDesktopW",
      "GetClassNameW",
      "GetClipboardSequenceNumber",
      "GetForegroundWindow",
      "GetProcessWindowStation",
      "GetThreadDesktop",
      "GetWindowThreadProcessId",
      "OpenDesktopW",
    ],
  );
  // Every refusal comes before any native code is loaded or anything is made.
  const loaded = source.indexOf("Add-Type -TypeDefinition");
  assert.ok(loaded > 0);
  assert.equal(source.lastIndexOf("Refuse '") < loaded, true);
  assert.equal(source.match(/\{ Refuse '/g).length, 9);
  assert.match(
    source,
    /if \(\$Desktop -cnotmatch '\^\[A-Za-z0-9\]\[A-Za-z0-9-\]\{0,63\}\$'\)/,
  );
  assert.match(
    source,
    /if \(\$TimeoutMs -lt 1000 -or \$TimeoutMs -gt 600000\)/,
  );
  // The program is started on the new desktop of this window station, in a
  // job that dies with the launcher, before its first instruction runs.
  assert.match(source, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000/);
  assert.match(
    source,
    /limits\.Basic\.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;/,
  );
  assert.match(
    source,
    /startup\.StartupInfo\.lpDesktop = outcome\.windowStation \+ "\\\\" \+ name;/,
  );
  const created = source.indexOf("if (!CreateProcessW(null, command,");
  const assigned = source.indexOf(
    "if (!AssignProcessToJobObject(job, process.hProcess))",
  );
  const resumed = source.indexOf("ResumeThread(process.hThread);");
  assert.ok(created > 0 && created < assigned && assigned < resumed);
  assert.match(
    source.slice(created, assigned),
    /CREATE_SUSPENDED \| CREATE_UNICODE_ENVIRONMENT \| CREATE_NO_WINDOW \| EXTENDED_STARTUPINFO_PRESENT/,
  );
  // A name already in use is refused: it would be somebody else's desktop.
  assert.ok(
    source.indexOf('outcome.error = "desktop-name-in-use"') <
      source.indexOf(
        "desktop = CreateLikeCurrent(name, outcome, out descriptor);",
      ),
  );
  // The new desktop gets the access list of the current one and no flag of
  // the program is changed: the launcher passes it no argument of its own.
  assert.match(
    source,
    /GetUserObjectSecurity\(current, ref requested, block, needed, out needed\)/,
  );
  assert.doesNotMatch(
    source,
    /--no-sandbox|--disable-gpu|--in-process-gpu|--single-process/,
  );
  // A client process in the foreground, or the timeout, kills the whole job.
  assert.match(
    source,
    /if \(ownerIsClient\) \{\s*outcome\.clientForegroundSamples\+\+;\s*if \(!outcome\.foregroundViolation\) \{\s*outcome\.foregroundViolation = true;[\s\S]{0,400}?TerminateJobObject\(job, 0xF1\);/,
  );
  assert.match(
    source,
    /if \(!exited && !outcome\.timedOut && clock\.ElapsedMilliseconds > timeoutMs\) \{ outcome\.timedOut = true; TerminateJobObject\(job, 0xF0\); \}/,
  );
  // Handles are closed however it ends, the desktop last, and its absence is
  // then checked by name.
  const cleanup = source.slice(
    source.indexOf("} finally {\n      if (process.hThread"),
  );
  assert.ok(cleanup.indexOf("if (job != IntPtr.Zero) CloseHandle(job);") > 0);
  assert.ok(
    cleanup.indexOf("if (job != IntPtr.Zero) CloseHandle(job);") <
      cleanup.indexOf("outcome.desktopClosed = CloseDesktop(desktop);"),
  );
  assert.match(
    cleanup,
    /if \(probe == IntPtr\.Zero\) outcome\.desktopGone = true;/,
  );
  assert.match(
    source,
    /if \(\$outcome\.foregroundViolation\) \{ exit 11 \}\s*if \(\$outcome\.timedOut\) \{ exit 10 \}\s*exit 0\s*$/,
  );
});

const onWindows = process.platform === "win32";
function launcher(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pwsh",
      ["-NoProfile", "-File", fileURLToPath(LAUNCHER), ...args],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}
const cmd = () =>
  path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
function launcherArgs(directory, name, overrides = {}) {
  const values = {
    Executable: cmd(),
    WorkingDirectory: directory,
    Desktop: `sorng-test-${name}-${process.pid}`,
    TimeoutMs: "20000",
    StdoutPath: path.join(directory, `${name}.out`),
    StderrPath: path.join(directory, `${name}.err`),
    Result: path.join(directory, `${name}.json`),
    ...overrides,
  };
  return Object.entries(values).flatMap(([key, value]) => [`-${key}`, value]);
}

test(
  "the launcher refuses bad arguments before it creates anything",
  { skip: !onWindows },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "sorng-desktop-refuse-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(path.join(directory, "taken.txt"), "kept");
    await writeFile(path.join(directory, "not-a-program.txt"), "");
    const cases = [
      ["name", { Desktop: "Default\\x" }, /desktop name must be/],
      ["name-space", { Desktop: "two words" }, /desktop name must be/],
      ["name-long", { Desktop: "a".repeat(65) }, /desktop name must be/],
      ["short", { TimeoutMs: "999" }, /timeout must be 1000\.\.600000 ms/],
      ["long", { TimeoutMs: "600001" }, /timeout must be 1000\.\.600000 ms/],
      [
        "lines",
        { Arguments: "/c echo a\necho b" },
        /arguments must be one line/,
      ],
      [
        "absent",
        { Executable: path.join(directory, "absent.exe") },
        /executable not found/,
      ],
      [
        "kind",
        { Executable: path.join(directory, "not-a-program.txt") },
        /executable not found/,
      ],
      [
        "cwd",
        { WorkingDirectory: path.join(directory, "absent") },
        /working directory not found/,
      ],
      [
        "relative",
        { StdoutPath: "relative.out" },
        /output paths must be absolute/,
      ],
      [
        "nowhere",
        { StderrPath: path.join(directory, "absent", "x.err") },
        /output directory not found/,
      ],
      [
        "taken",
        { Result: path.join(directory, "taken.txt") },
        /an output file already exists/,
      ],
      [
        "same",
        { StderrPath: path.join(directory, "same.out") },
        /output paths must differ/,
      ],
    ];
    const results = await Promise.all(
      cases.map(([name, overrides]) =>
        launcher(launcherArgs(directory, name, overrides)),
      ),
    );
    cases.forEach(([name, , message], index) => {
      const { code, stdout, stderr } = results[index];
      assert.equal(code, 2, `${name}: ${stderr}`);
      assert.match(stderr, message, name);
      assert.match(stderr, /^launch-on-private-desktop: /, name);
      // Nothing was started and nothing was written.
      assert.equal(stdout, "", name);
      for (const kind of ["out", "err", "json"])
        assert.equal(
          existsSync(path.join(directory, `${name}.${kind}`)),
          false,
          name,
        );
    });
    assert.equal(
      await readFile(path.join(directory, "taken.txt"), "utf8"),
      "kept",
    );
  },
);

test(
  "the launcher runs a program and its children on the new desktop only, and leaves nothing behind",
  { skip: !onWindows },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "sorng-desktop-run-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    // Prints the desktop a process runs on, whether it sees a foreground
    // window from there, and which desktop receives input. Reads only.
    const where = path.join(directory, "where.ps1");
    await writeFile(
      where,
      [
        "Add-Type -Namespace SorngTest -Name Where -MemberDefinition @'",
        '[DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint thread);',
        '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
        '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformationW(IntPtr handle, int index, System.Text.StringBuilder information, uint length, out uint needed);',
        '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
        '[DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);',
        "'@",
        "$needed = [uint32]0",
        "$name = [Text.StringBuilder]::new(256)",
        "[void][SorngTest.Where]::GetUserObjectInformationW([SorngTest.Where]::GetThreadDesktop([SorngTest.Where]::GetCurrentThreadId()), 2, $name, 512, [ref]$needed)",
        "$receiving = [Text.StringBuilder]::new(256)",
        "[void][SorngTest.Where]::GetUserObjectInformationW([SorngTest.Where]::OpenInputDesktop(0, $false, 1), 2, $receiving, 512, [ref]$needed)",
        '"desktop=$name"',
        '"foreground=$([SorngTest.Where]::GetForegroundWindow() -ne [IntPtr]::Zero)"',
        '"input=$receiving"',
      ].join("\r\n"),
    );
    const here = await new Promise((resolve, reject) => {
      const child = spawn("pwsh", ["-NoProfile", "-File", where], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let stdout = "";
      child.stdout.on("data", (b) => (stdout += b));
      child.once("error", reject);
      child.once("close", () => resolve(stdout));
    });
    // Empty when the input desktop cannot be opened, as on a locked session.
    const receiving = /^input=(.*)$/m.exec(here)?.[1].trim();
    assert.equal(typeof receiving, "string", here);

    // A child of the started program: it inherits the desktop.
    const inside = await launcher(
      launcherArgs(directory, "inside", {
        Arguments: `/c pwsh -NoProfile -File "${where}"`,
      }),
    );
    assert.equal(inside.code, 0, inside.stderr);
    assert.match(inside.stdout, /^\{"started":true,"pid":\d+\}\r?\n$/);
    const desktop = `sorng-test-inside-${process.pid}`;
    const seen = await readFile(path.join(directory, "inside.out"), "utf8");
    assert.match(seen, new RegExp(`^desktop=${desktop}\\r?$`, "m"));
    // From there no window is in the foreground, and input still goes where
    // it went before: the launcher switched nothing.
    assert.match(seen, /^foreground=False\r?$/m);
    assert.equal(/^input=(.*)$/m.exec(seen)?.[1].trim(), receiving);
    assert.notEqual(receiving, desktop);
    const result = JSON.parse(
      await readFile(path.join(directory, "inside.json"), "utf8"),
    );
    assert.equal(result.desktop, desktop);
    assert.equal(result.started, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.ok(result.samples > 0);
    assert.ok(result.peakProcessesInJob >= 2);
    assert.equal(result.clientForegroundSamples, 0);
    assert.equal(result.clientForegroundOwnerChanges, 0);
    assert.equal(result.foregroundViolation, false);
    assert.equal(result.processesLeftInJob, 0);
    assert.equal(result.desktopClosed, true);
    assert.equal(result.desktopGone, true);
    assert.equal(Number(/"pid":(\d+)/.exec(inside.stdout)[1]), result.pid);

    // The program's exit code and both of its streams come back through files.
    const coded = await launcher(
      launcherArgs(directory, "coded", {
        Arguments: "/c echo to-stdout& echo to-stderr 1>&2& exit 7",
      }),
    );
    assert.equal(coded.code, 0, coded.stderr);
    const codedResult = JSON.parse(
      await readFile(path.join(directory, "coded.json"), "utf8"),
    );
    assert.equal(codedResult.exitCode, 7);
    assert.equal(codedResult.desktopGone, true);
    assert.match(
      await readFile(path.join(directory, "coded.out"), "utf8"),
      /^to-stdout\r?\n$/,
    );
    assert.match(
      await readFile(path.join(directory, "coded.err"), "utf8"),
      /^to-stderr\s*\r?\n$/,
    );
    // The same name is free again afterwards, and a second run may use it.
    await rm(path.join(directory, "coded.out"));
    await rm(path.join(directory, "coded.err"));
    await rm(path.join(directory, "coded.json"));
    const again = await launcher(
      launcherArgs(directory, "coded", { Arguments: "/c exit 3" }),
    );
    assert.equal(again.code, 0, again.stderr);
    assert.equal(
      JSON.parse(await readFile(path.join(directory, "coded.json"), "utf8"))
        .exitCode,
      3,
    );
  },
);

test(
  "the launcher's timeout kills the program with its children and still closes the desktop",
  { skip: !onWindows },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "sorng-desktop-timeout-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const started = Date.now();
    const slow = await launcher(
      launcherArgs(directory, "slow", {
        TimeoutMs: "1000",
        // cmd starts ping and waits for it: two processes, half a minute.
        Arguments: "/c ping -n 30 127.0.0.1",
      }),
    );
    assert.equal(slow.code, 10, slow.stderr);
    assert.ok(Date.now() - started < 15000);
    const result = JSON.parse(
      await readFile(path.join(directory, "slow.json"), "utf8"),
    );
    assert.equal(result.started, true);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 0xf0);
    assert.ok(result.peakProcessesInJob >= 2);
    assert.equal(result.processesLeftInJob, 0);
    assert.equal(result.leftoversTerminated, false);
    assert.equal(result.desktopClosed, true);
    assert.equal(result.desktopGone, true);
    assert.ok(result.elapsedMs >= 1000 && result.elapsedMs < 5000);
    // The runner fails such a run through the client's exit and timeout, and
    // the desktop record itself is clean unless the person copied something.
    assert.deepEqual(
      assessPrivateDesktop({
        ...result,
        clipboardSequenceAfter: result.clipboardSequenceBefore,
        clipboardChanges: 0,
      }),
      [],
    );
  },
);

test(
  "the launcher accepts exactly the arguments the runner builds",
  { skip: !onWindows },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "sorng-desktop-runner-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    // cmd.exe stands in for the client: with no arguments and an empty input
    // it ends at once.
    const launch = privateDesktopLaunch({
      executable: cmd(),
      output: directory,
      timeoutMs: 20000,
    });
    const done = await new Promise((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: path.dirname(cmd()),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (b) => (stdout += b));
      child.stderr.on("data", (b) => (stderr += b));
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(done.code, 0, done.stderr);
    // The line the runner reads the client's process id from.
    const pid = /^\{"started":true,"pid":(\d+)\}\r?$/m.exec(done.stdout)?.[1];
    assert.ok(pid, done.stdout);
    const result = JSON.parse(await readFile(launch.result, "utf8"));
    assert.equal(result.pid, Number(pid));
    assert.equal(result.desktop, launch.desktop);
    assert.equal(result.exitCode, 0);
    assert.equal(result.processesLeftInJob, 0);
    assert.equal(result.desktopGone, true);
    assert.equal(existsSync(launch.stdout), true);
    assert.equal(existsSync(launch.stderr), true);
  },
);
