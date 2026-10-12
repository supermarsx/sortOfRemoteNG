import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import {
  assessNativeReport,
  assessNativeTlsReport,
  assessTlsSocketLedger,
  TLS_PATCH_ID,
  TLS_CASES,
  runAcceptance,
  inspectNetlog,
  decodeNetlog,
  summarizeProxyTrace,
  acceptanceCustomPlan,
  stageAcceptance,
  MEASUREMENT_SCENARIOS,
  MEASUREMENT_VARIABLES,
  measurementPlan,
  assessMeasurementReport,
  formatMeasurementMatrix,
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

test(
  "acceptance never mixes official runtime selection with a custom plan",
  { skip: process.platform !== "win32" },
  async () => {
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
  },
);

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
function syntheticTlsReport() {
  const report = {
    schema: 2,
    engine: "cef",
    bindingPin: "154.3.0",
    evidenceKind: "native-cef-local-fixture",
    runId: "validator-test-only",
    patchId: TLS_PATCH_ID,
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
  ]) {
    await assert.rejects(
      runAcceptance({
        executable: "never-launched",
        output: "never-created",
        ...options,
      }),
      /Unknown acceptance suite|--manual|Invalid timeoutMs/,
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
    /applyNativeCrashGate\(\s*suite === ["']tls["']\s*\? assessNativeTlsReport\(native,\s*runId\)\s*:\s*assessNativeReport\(native\),\s*nativeCrashSummary,?\s*\)/,
  );
  assert.match(
    runner,
    /nativeTlsFixtureAccepted:\s*suite === ["']tls["'] && assessed\.failures\.length\s*===\s*0/,
  );
  assert.match(runner, /nativeFailureReason,\s*nativeCrashSummary,\s*platform/);
});

// ---------------------------------------------------------------------------
// Measurement mode: scenarios (a)-(f) and the M1-M7 matrix. Every report below
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
    const final =
      plan.adapter === "manual"
        ? {
            slot: plan.id,
            kind: "final",
            reason: "capacity",
            atMs: 7000,
            capacity: {
              sockets: { requested: 40, open: 26, error: 14, closed: 14 },
              holds: {
                sameHost: { requested: 6, pending: 6, completed: 0, failed: 0 },
                otherHost: {
                  requested: 6,
                  pending: 0,
                  completed: 0,
                  failed: 6,
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
      relayMaxClients: 32,
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
        },
        slots: plan.slots.map(slot),
        ...(plan.page === "capacity"
          ? {
              capacity: {
                requested: { sockets: 40, holdsPerHost: 6, holdHosts: 2 },
                relayMaxClients: 32,
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

test("a complete synthetic report yields seven MEASURED rows carrying only observed values", () => {
  const matrix = assessMeasurementReport(syntheticMeasurementReport());
  assert.deepEqual(
    matrix.rows.map((row) => [row.id, row.status]),
    ["M1", "M2", "M3", "M4", "M5", "M6", "M7"].map((id) => [id, "MEASURED"]),
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
  assert.equal(value("M7").capacityRefusals, 20);
  assert.deepEqual(value("M7").requested, { sockets: 40, holds: 12 });
  const text = formatMeasurementMatrix(matrix);
  assert.match(
    text,
    /^Real-engine measurements \(local synthetic fixtures; not acceptance\)/,
  );
  assert.match(text, /measured 7\/7$/);
  assert.match(
    text,
    /capacity_refusals=20 requested=52 \(40 sockets \+ 12 holds\) relayMaxClients=32/,
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
    [
      "M7",
      /requested connections did not exceed the relay limit/,
      (r) =>
        (measurementScenario(r, "f-relay-capacity").capacity.relayMaxClients =
          64),
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
    /measured 0\/7$/,
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
  assert.equal(assessMeasurementReport(reordered).measured, 7);
});

test("measurement options are validated before a profile is created or a process launched", async () => {
  assert.deepEqual(measurementPlan(), {
    windowMs: 12000,
    only: undefined,
    scenarios: MEASUREMENT_SCENARIOS.map((scenario) => scenario.id),
    // Ten ordinary windows, one long window, set-up per scenario and start-up.
    expectedMs: 10 * 12000 + 30000 + 11 * 12000 + 15000,
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
  const spawned = runner.indexOf("const child = spawn(executable");
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
  const verdict = runner.indexOf("assessNativeTlsReport(native, runId)");
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
