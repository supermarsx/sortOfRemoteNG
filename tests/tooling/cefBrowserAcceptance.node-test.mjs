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
