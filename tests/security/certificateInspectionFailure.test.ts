import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type {
  CertificateInspectionStage,
  NativeCertificateInspectionError,
} from "../../src/types/security/certificateInspection";
import {
  buildCertificateInspectionTimeline,
  CERTIFICATE_TRUST_CHECK_NOT_RUN,
  describeCertificateInspectionFailure,
  displayAuthority,
  formatDurationMs,
  parseNativeCertificateInspectionError,
} from "../../src/utils/security/certificateInspectionFailure";

type Wire = NativeCertificateInspectionError;
const fixtures = JSON.parse(
  readFileSync("tests/fixtures/certificate-inspection-failures.json", "utf8"),
) as { name: string; wire: Wire }[];
const wire = (name: string): Wire =>
  structuredClone(fixtures.find((entry) => entry.name === name)!.wire);
const STARTED_AT = Date.UTC(2026, 8, 15, 14, 2, 11);

function describeWire(
  error: unknown,
  host = "10.1.180.11",
  port = 443,
  route: "direct" | "proxy" = "direct",
) {
  return describeCertificateInspectionFailure({
    error,
    hookStage: "inspection",
    host,
    port,
    route,
    proxyTls: false,
    url: `https://${host}${port === 443 ? "" : `:${port}`}/`,
    startedAt: STARTED_AT,
    failedAfterMs: 10_012.4,
  });
}
function hostFor(entry: Wire) {
  const index = entry.target.lastIndexOf(":");
  return entry.target
    ? {
        host: entry.target.slice(0, index),
        port: +entry.target.slice(index + 1),
      }
    : { host: "10.1.180.11", port: 443 };
}

describe("native certificate inspection wire fixture", () => {
  const expected: Record<string, [string, string, string]> = {
    direct_connect_timeout: [
      "host_unreachable",
      "Can't reach 10.1.180.11:443",
      "No response from 10.1.180.11:443 within 10.0 s (TCP connect).",
    ],
    direct_connection_refused: [
      "connection_refused",
      "10.1.180.11:443 refused the connection",
      "The host answered, but nothing accepted connections on port 443.",
    ],
    direct_host_unreachable: [
      "host_unreachable",
      "Can't reach 10.1.180.11:443",
      "The network reported 10.1.180.11 as unreachable after 3.0 s.",
    ],
    direct_dns_failure: [
      "dns_failure",
      "Can't find nas.invalid",
      "The name nas.invalid could not be resolved.",
    ],
    proxy_unreachable: [
      "proxy_route_failure",
      "Can't reach the configured proxy",
      "The configured HTTP(S) proxy did not accept a connection within 10.0 s.",
    ],
    proxy_auth_rejected: [
      "proxy_route_failure",
      "The proxy rejected its credentials (HTTP 407)",
      "Check the proxy username and password.",
    ],
    proxy_tunnel_rejected: [
      "proxy_route_failure",
      "The proxy could not reach private.invalid:443 (HTTP 504)",
      "The proxy refused or failed to open a tunnel to the website.",
    ],
    tls_handshake_timeout: [
      "tls_handshake_failure",
      "TLS handshake with 10.1.180.11:443 timed out",
      "10.1.180.11:443 accepted TCP but did not complete TLS within 10.0 s.",
    ],
    tls_handshake_not_tls: [
      "tls_handshake_failure",
      "TLS handshake with 10.1.180.11:443 failed",
      "10.1.180.11:443 answered with data that is not TLS; the port may serve plain HTTP.",
    ],
    certificate_unreadable: [
      "tls_failure",
      "Unable to read the HTTPS certificate",
      "The server completed TLS but its certificate could not be read.",
    ],
    inspection_unavailable: [
      "inspection_unavailable",
      "HTTPS certificate check unavailable",
      "The local certificate verifier could not start. TLS verification was not bypassed.",
    ],
    invalid_target: [
      "invalid_navigation",
      "Invalid web address",
      "The saved address cannot be used for a certificate check.",
    ],
    deadline_exceeded_proxy_tunnel: [
      "proxy_route_failure",
      "The proxy did not answer within 25.0 s",
      "The certificate check did not finish within 25.0 s (proxy tunnel).",
    ],
  };

  it("covers every shared fixture entry", () => {
    expect(fixtures.map((entry) => entry.name).sort()).toEqual(
      Object.keys(expected).sort(),
    );
  });

  it.each(fixtures.map((entry) => [entry.name, entry.wire] as const))(
    "%s parses exactly and maps to its failing layer",
    (name, entry) => {
      expect(parseNativeCertificateInspectionError(entry)).toEqual(entry);
      const { host, port } = hostFor(entry);
      const failure = describeWire(entry, host, port, entry.route);
      const [kind, title, reason] = expected[name];
      expect(failure).toMatchObject({
        version: 1,
        sessionId: "local",
        status: null,
        kind,
        title,
        reason: `${reason} ${CERTIFICATE_TRUST_CHECK_NOT_RUN}`,
        detail: entry.message,
      });
      expect(failure.timeline).toMatchObject({
        startedAt: STARTED_AT,
        failedAfterMs: 10_012,
        route: entry.route,
      });
      if (kind !== "tls_failure")
        expect(`${failure.title} ${failure.reason}`).not.toMatch(
          /certificate (expiry|chain)|Unable to inspect/i,
        );
    },
  );

  it("never names the proxy or target in proxy-route timeline text", () => {
    for (const entry of fixtures.filter((item) => item.wire.route === "proxy"))
      expect(JSON.stringify(describeWire(entry.wire).timeline)).not.toContain(
        "private.invalid",
      );
  });

  it("returns a detached copy", () => {
    const entry = wire("direct_connect_timeout");
    const parsed = parseNativeCertificateInspectionError(entry)!;
    entry.completed[0].elapsed_ms = 9;
    expect(parsed.completed[0].elapsed_ms).toBe(1);
  });
});

describe("classes beyond the fixture", () => {
  const variant = (name: string, patch: Partial<Wire>) => ({
    ...wire(name),
    ...patch,
  });
  it.each([
    [
      variant("direct_connection_refused", {
        kind: "connect_failed",
        stage_elapsed_ms: 4,
      }),
      "connection_failed",
      "Can't connect to 10.1.180.11:443",
      "The TCP connection failed after 4 ms.",
    ],
    [
      variant("direct_connect_timeout", { timeout_ms: null }),
      "host_unreachable",
      "Can't reach 10.1.180.11:443",
      "No response from 10.1.180.11:443 after 10.0 s (TCP connect).",
    ],
    [
      variant("proxy_unreachable", { kind: "proxy_invalid", timeout_ms: null }),
      "invalid_navigation",
      "Proxy settings are invalid",
      "The global HTTP(S) proxy is not a valid route; it will not be bypassed.",
    ],
    [
      variant("proxy_auth_rejected", {
        kind: "proxy_tls_failed",
        stage: "proxy_tls",
        proxy_status: null,
      }),
      "proxy_route_failure",
      "The proxy's HTTPS certificate was not verified",
      "The configured HTTPS proxy failed verification; the target was not contacted.",
    ],
    [
      variant("proxy_auth_rejected", {
        kind: "proxy_tls_failed",
        stage: "proxy_tls",
        proxy_status: null,
        timeout_ms: 10_000,
      }),
      "proxy_route_failure",
      "Can't reach the configured proxy",
      "The configured HTTPS proxy did not complete TLS within 10.0 s; the target was not contacted.",
    ],
    [
      variant("proxy_auth_rejected", {
        kind: "inspection_unavailable",
        stage: "proxy_tls",
        proxy_status: null,
      }),
      "inspection_unavailable",
      "HTTPS certificate check unavailable",
      "The local certificate verifier could not start. TLS verification was not bypassed.",
    ],
    [
      variant("direct_dns_failure", {
        target: "10.1.180.11:443",
        timeout_ms: 10_000,
        stage_elapsed_ms: 10_001,
      }),
      "dns_failure",
      "Can't find 10.1.180.11",
      "The name 10.1.180.11 could not be resolved.",
    ],
    [
      variant("direct_connect_timeout", {
        addresses_tried: 2,
        address: "[fd00::5]:443",
        timeout_ms: 10_000,
        message:
          "TCP connect to nas.lan:443 ([fd00::5]:443) timed out after 10.0 s (2 addresses tried)",
      }),
      "host_unreachable",
      "Can't reach 10.1.180.11:443",
      "No response from 10.1.180.11:443 within 10.0 s (TCP connect).",
    ],
    [
      variant("proxy_tunnel_rejected", {
        kind: "proxy_tunnel_timeout",
        proxy_status: null,
        timeout_ms: 10_000,
      }),
      "proxy_route_failure",
      "The proxy did not answer within 10.0 s",
      "The proxy accepted the connection but did not open the tunnel.",
    ],
    [
      variant("proxy_tunnel_rejected", {
        kind: "proxy_protocol_error",
        proxy_status: null,
      }),
      "proxy_route_failure",
      "The proxy returned an invalid response",
      "The proxy's CONNECT response was malformed or too large.",
    ],
    [
      variant("tls_handshake_not_tls", { tls_reason: "peer_closed" }),
      "tls_handshake_failure",
      "TLS handshake with 10.1.180.11:443 failed",
      "10.1.180.11:443 closed the connection during the handshake.",
    ],
    [
      variant("tls_handshake_not_tls", { tls_reason: "alert" }),
      "tls_handshake_failure",
      "TLS handshake with 10.1.180.11:443 failed",
      "10.1.180.11:443 rejected the handshake with a TLS alert.",
    ],
    [
      variant("tls_handshake_not_tls", { tls_reason: "other" }),
      "tls_handshake_failure",
      "TLS handshake with 10.1.180.11:443 failed",
      "10.1.180.11:443 could not complete a TLS handshake.",
    ],
    [
      variant("tls_handshake_not_tls", { tls_reason: null }),
      "tls_handshake_failure",
      "TLS handshake with 10.1.180.11:443 failed",
      "10.1.180.11:443 could not complete a TLS handshake.",
    ],
    [
      variant("tls_handshake_not_tls", { tls_reason: "certificate" }),
      "tls_failure",
      "Unable to verify the server's TLS handshake",
      "The server's certificate was rejected during the TLS handshake.",
    ],
  ] as const)("%#: %s", (error, kind, title, reason) => {
    const failure = describeWire(error, "10.1.180.11", 443, error.route);
    expect(failure).toMatchObject({
      kind,
      title,
      reason: `${reason} ${CERTIFICATE_TRUST_CHECK_NOT_RUN}`,
    });
  });

  it.each([
    ["direct", "resolve", [], "dns_failure", "Can't find nas.invalid"],
    [
      "direct",
      "connect",
      ["resolve"],
      "host_unreachable",
      "Can't reach nas.invalid:443",
    ],
    [
      "proxy",
      "proxy_connect",
      [],
      "proxy_route_failure",
      "Can't reach the configured proxy",
    ],
    [
      "proxy",
      "proxy_tls",
      ["proxy_connect"],
      "proxy_route_failure",
      "Can't reach the configured proxy",
    ],
    [
      "proxy",
      "proxy_tunnel",
      ["proxy_connect"],
      "proxy_route_failure",
      "The proxy did not answer within 25.0 s",
    ],
    [
      "direct",
      "tls_handshake",
      ["resolve", "connect"],
      "tls_handshake_failure",
      "TLS handshake with nas.invalid:443 timed out",
    ],
    [
      "direct",
      "certificate",
      ["resolve", "connect", "tls_handshake"],
      "inspection_unavailable",
      "HTTPS certificate check unavailable",
    ],
    [
      "proxy",
      "verifier",
      [],
      "inspection_unavailable",
      "HTTPS certificate check unavailable",
    ],
  ] as const)(
    "routes deadline_exceeded on %s %s to its failing layer",
    (route, stage, completed, kind, title) => {
      const error: Wire = {
        ...wire("deadline_exceeded_proxy_tunnel"),
        route,
        stage,
        target: "nas.invalid:443",
        completed: completed.map((name) => ({ stage: name, elapsed_ms: 5 })),
      };
      expect(parseNativeCertificateInspectionError(error)).not.toBeNull();
      const failure = describeWire(error, "nas.invalid", 443, route);
      expect(failure.kind).toBe(kind);
      expect(failure.title).toBe(title);
      expect(failure.reason).toContain(
        "The certificate check did not finish within 25.0 s",
      );
      // Same stage names as the native deadline messages.
      expect(failure.reason).toContain(
        `(${
          {
            resolve: "name resolution",
            connect: "TCP connect",
            proxy_connect: "proxy connect",
            proxy_tls: "proxy TLS",
            proxy_tunnel: "proxy tunnel",
            tls_handshake: "TLS handshake",
            certificate: "certificate read",
            verifier: "certificate verifier",
          }[stage]
        }).`,
      );
    },
  );

  it("displays IPv6 authorities with brackets from the hook's own host and port", () => {
    expect(displayAuthority("fd00::1", 8443)).toBe("[fd00::1]:8443");
    expect(displayAuthority("[fd00::1]", 8443)).toBe("[fd00::1]:8443");
    expect(displayAuthority("nas.example.test", 5001)).toBe(
      "nas.example.test:5001",
    );
    const error = {
      ...wire("direct_connect_timeout"),
      target: "[fd00::1]:8443",
      address: "[fd00::1]:8443",
    };
    const failure = describeWire(error, "[fd00::1]", 8443);
    expect(failure.title).toBe("Can't reach [fd00::1]:8443");
    // Titles use the hook's target, never the unverified wire target.
    expect(
      describeWire(
        { ...wire("direct_connect_timeout"), target: "spoofed.invalid:1" },
        "10.1.180.11",
        443,
      ).title,
    ).toBe("Can't reach 10.1.180.11:443");
  });
});

describe("fail-closed parser", () => {
  const base = () => wire("direct_connect_timeout");
  const tooManyCompleted = Array.from({ length: 10 }, () => ({
    stage: "resolve",
    elapsed_ms: 1,
  }));
  it.each<[string, (value: Record<string, unknown>) => unknown]>([
    ["unknown kind", (v) => ({ ...v, kind: "socket_exploded" })],
    ["prototype kind", (v) => ({ ...v, kind: "constructor" })],
    ["unknown stage", (v) => ({ ...v, stage: "dns" })],
    ["unknown route", (v) => ({ ...v, route: "vpn" })],
    ["negative integer", (v) => ({ ...v, elapsed_ms: -1 })],
    ["fractional integer", (v) => ({ ...v, stage_elapsed_ms: 1.5 })],
    ["unsafe integer", (v) => ({ ...v, addresses_tried: 2 ** 53 })],
    ["numeric string", (v) => ({ ...v, elapsed_ms: "10004" })],
    ["elapsed above bound", (v) => ({ ...v, elapsed_ms: 600_001 })],
    ["timeout above bound", (v) => ({ ...v, timeout_ms: 600_001 })],
    ["too many addresses", (v) => ({ ...v, addresses_tried: 65 })],
    ["message over 1024 bytes", (v) => ({ ...v, message: "é".repeat(513) })],
    ["empty message", (v) => ({ ...v, message: "" })],
    ["target over 300 bytes", (v) => ({ ...v, target: "a".repeat(301) })],
    ["address with path", (v) => ({ ...v, address: "10.1.180.11:443/admin" })],
    [
      "address with credentials",
      (v) => ({ ...v, address: "user:secret@10.1.180.11:443" }),
    ],
    ["hostname address", (v) => ({ ...v, address: "nas.local:443" })],
    ["address port out of range", (v) => ({ ...v, address: "10.0.0.1:99999" })],
    [
      "address over 64 chars",
      (v) => ({ ...v, address: `[${"1:".repeat(32)}1]:443` }),
    ],
    [
      "too many completed stages",
      (v) => ({ ...v, completed: tooManyCompleted }),
    ],
    [
      "completed after the failing stage",
      (v) => ({
        ...v,
        completed: [{ stage: "tls_handshake", elapsed_ms: 1 }],
      }),
    ],
    [
      "completed out of order",
      (v) => ({
        ...v,
        stage: "tls_handshake",
        completed: [
          { stage: "connect", elapsed_ms: 1 },
          { stage: "resolve", elapsed_ms: 1 },
        ],
      }),
    ],
    [
      "duplicate completed stage",
      (v) => ({
        ...v,
        completed: [
          { stage: "resolve", elapsed_ms: 1 },
          { stage: "resolve", elapsed_ms: 1 },
        ],
      }),
    ],
    [
      "extra completed key",
      (v) => ({
        ...v,
        completed: [{ stage: "resolve", elapsed_ms: 1, note: "x" }],
      }),
    ],
    ["missing key", ({ message: _message, ...rest }) => rest],
    ["extra key", (v) => ({ ...v, proxy_url: "http://user:pw@proxy:8080" })],
    [
      "proxy kind on direct route",
      (v) => ({ ...v, kind: "proxy_unreachable" }),
    ],
    [
      "direct kind on proxy route",
      (v) => ({
        ...v,
        route: "proxy",
        stage: "proxy_connect",
        address: null,
        completed: [],
      }),
    ],
    [
      "direct stage on proxy route",
      () => ({ ...wire("proxy_unreachable"), stage: "connect" }),
    ],
    [
      "address on proxy route",
      () => ({ ...wire("proxy_unreachable"), address: "10.0.0.1:8080" }),
    ],
    ["tls reason on another kind", (v) => ({ ...v, tls_reason: "not_tls" })],
    [
      "unknown tls reason",
      () => ({ ...wire("tls_handshake_not_tls"), tls_reason: "weird" }),
    ],
    ["proxy status on another kind", (v) => ({ ...v, proxy_status: 502 })],
    [
      "proxy status below range",
      () => ({ ...wire("proxy_auth_rejected"), proxy_status: 99 }),
    ],
    [
      "proxy status above range",
      () => ({ ...wire("proxy_auth_rejected"), proxy_status: 600 }),
    ],
    ["array", () => [base()]],
    ["null", () => null],
    ["string", () => "Certificate TCP connection failed"],
    ["number", () => 404],
    ["error instance", () => Object.assign(new Error("x"), base())],
    [
      "class instance",
      (v) => Object.assign(Object.create({ inherited: true }), v),
    ],
  ])("rejects %s", (_name, mutate) => {
    const value = mutate(base() as unknown as Record<string, unknown>);
    expect(parseNativeCertificateInspectionError(value)).toBeNull();
    const failure = describeWire(value);
    expect(failure.kind).toBe("tls_failure");
    expect(failure.title).toBe("Unable to inspect the HTTPS certificate");
  });

  it("maps legacy string and Error rejections to the generic inspection failure", () => {
    for (const legacy of [
      "Certificate inspection timed out after 15 seconds",
      new Error("Certificate inspection timed out after 15 seconds"),
    ]) {
      const failure = describeWire(legacy);
      expect(failure).toMatchObject({
        kind: "tls_failure",
        title: "Unable to inspect the HTTPS certificate",
        reason: `The HTTPS certificate could not be inspected. ${CERTIFICATE_TRUST_CHECK_NOT_RUN}`,
        detail: "Certificate inspection timed out after 15 seconds",
      });
      expect(failure.timeline).toEqual({
        startedAt: STARTED_AT,
        failedAfterMs: 10_012,
        route: "direct",
        steps: [],
      });
    }
  });

  it("never echoes an unrecognized object and bounds long detail", () => {
    const opaque = describeWire({ secret: "proxy-password" });
    expect(opaque.detail).not.toContain("[object Object]");
    expect(opaque.detail).not.toContain("proxy-password");
    const long = describeWire("€".repeat(5000)).detail;
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(2048);
    expect(long.endsWith("…")).toBe(true);
  });

  it("labels validator and identity failures without parsing the thrown value", () => {
    const common = {
      host: "10.1.180.11",
      port: 443,
      route: "proxy" as const,
      proxyTls: true,
      url: "https://10.1.180.11/",
      startedAt: STARTED_AT,
      failedAfterMs: 20,
    };
    const malformed = describeCertificateInspectionFailure({
      ...common,
      error: new Error("Malformed bounded certificate inspection details"),
      hookStage: "inspection_response",
    });
    expect(malformed).toMatchObject({
      kind: "tls_failure",
      title: "Unable to inspect the HTTPS certificate",
      reason: `The native certificate inspection returned malformed data. ${CERTIFICATE_TRUST_CHECK_NOT_RUN}`,
    });
    const identity = describeCertificateInspectionFailure({
      ...common,
      // A structured-looking value is not parsed outside the native stage.
      error: wire("direct_connect_timeout"),
      hookStage: "identity",
    });
    expect(identity).toMatchObject({
      kind: "tls_failure",
      title: "Invalid HTTPS certificate identity",
    });
    expect(
      identity.timeline?.steps.map((step) => [step.id, step.status]),
    ).toEqual([
      ["proxy_connect", "pass"],
      ["proxy_tls", "pass"],
      ["proxy_tunnel", "pass"],
      ["tls_handshake", "pass"],
      ["certificate", "fail"],
      ["trust", "not_started"],
      ["page", "not_started"],
    ]);
    expect(
      identity.timeline?.steps.every((step) => step.durationMs === null),
    ).toBe(true);
  });
});

describe("formatDurationMs", () => {
  it.each([
    [0, "0 ms"],
    [42, "42 ms"],
    [999, "999 ms"],
    [1000, "1.0 s"],
    [1049, "1.0 s"],
    [1050, "1.1 s"],
    [2087, "2.1 s"],
    [10_003, "10.0 s"],
    [15_013, "15.0 s"],
    [59_949, "59.9 s"],
    [60_000, "1 min 0 s"],
    [125_400, "2 min 5 s"],
    [-5, "0 ms"],
    [Number.NaN, "0 ms"],
  ])("%s ms → %s", (ms, text) => {
    expect(formatDurationMs(ms)).toBe(text);
  });
});

describe("attempt timeline builder", () => {
  const steps = (error: Wire | null, proxyTls = false) =>
    buildCertificateInspectionTimeline({
      error,
      hookStage: "inspection",
      route: error?.route ?? "direct",
      proxyTls,
      startedAt: STARTED_AT,
      failedAfterMs: 1_234.6,
    });

  it("orders direct stages with measured pass, fail and not-started steps", () => {
    const timeline = steps(wire("direct_connect_timeout"));
    expect(timeline.failedAfterMs).toBe(1_235);
    expect(timeline.startedAt).toBe(STARTED_AT);
    expect(timeline.steps).toEqual([
      {
        id: "resolve",
        label: "Resolve address",
        status: "pass",
        durationMs: 1,
        detail: null,
      },
      {
        id: "connect",
        label: "TCP connect",
        status: "fail",
        durationMs: 10_003,
        detail: "no response from 10.1.180.11:443 after 10.0 s",
      },
      {
        id: "tls_handshake",
        label: "TLS handshake",
        status: "not_started",
        durationMs: null,
        detail: null,
      },
      {
        id: "certificate",
        label: "Read certificate",
        status: "not_started",
        durationMs: null,
        detail: null,
      },
      {
        id: "trust",
        label: "Certificate trust check",
        status: "not_started",
        durationMs: null,
        detail: null,
      },
      {
        id: "page",
        label: "Open page",
        status: "not_started",
        durationMs: null,
        detail: null,
      },
    ]);
  });

  it("orders proxy stages and adds proxy TLS only for an HTTPS proxy", () => {
    const summary = (error: Wire, proxyTls = false) =>
      steps(error, proxyTls).steps.map((step) => [
        step.id,
        step.status,
        step.durationMs,
      ]);
    expect(summary(wire("proxy_auth_rejected"))).toEqual([
      ["proxy_connect", "pass", 8],
      ["proxy_tunnel", "fail", 4],
      ["tls_handshake", "not_started", null],
      ["certificate", "not_started", null],
      ["trust", "not_started", null],
      ["page", "not_started", null],
    ]);
    const viaHttpsProxy = {
      ...wire("proxy_auth_rejected"),
      completed: [
        { stage: "proxy_connect" as const, elapsed_ms: 8 },
        { stage: "proxy_tls" as const, elapsed_ms: 30 },
      ],
    };
    expect(summary(viaHttpsProxy, true).slice(0, 3)).toEqual([
      ["proxy_connect", "pass", 8],
      ["proxy_tls", "pass", 30],
      ["proxy_tunnel", "fail", 4],
    ]);
    expect(steps(wire("proxy_auth_rejected")).steps[1].detail).toBe(
      "the proxy rejected authentication (HTTP 407)",
    );
  });

  it("fails the trust step for the local verifier and the first step for an invalid target", () => {
    const verifier = steps(wire("inspection_unavailable")).steps;
    expect(verifier.find((step) => step.status === "fail")?.id).toBe("trust");
    expect(
      verifier.filter((step) => step.status === "not_started").map((s) => s.id),
    ).toEqual(["resolve", "connect", "tls_handshake", "certificate", "page"]);
    const target = steps(wire("invalid_target")).steps;
    expect(target[0]).toMatchObject({ id: "resolve", status: "fail" });
    const unreadable = steps(wire("certificate_unreadable")).steps;
    expect(unreadable.map((step) => step.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "fail",
      "not_started",
      "not_started",
    ]);
  });

  it("uses measured wire durations with injected attempt clocks", () => {
    const stage: CertificateInspectionStage = "tls_handshake";
    const timeline = buildCertificateInspectionTimeline({
      error: { ...wire("tls_handshake_timeout"), stage },
      hookStage: "inspection",
      route: "direct",
      proxyTls: false,
      startedAt: 5,
      failedAfterMs: 10_016.49,
    });
    expect(timeline).toMatchObject({ startedAt: 5, failedAfterMs: 10_016 });
    expect(timeline.steps.map((step) => step.durationMs)).toEqual([
      1,
      14,
      10_000,
      null,
      null,
      null,
    ]);
  });
});
