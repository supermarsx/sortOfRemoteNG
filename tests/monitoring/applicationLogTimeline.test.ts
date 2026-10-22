import { describe, expect, it } from "vitest";
import {
  logRowsText,
  newestLogRows,
  parseLogTimeline,
} from "../../src/utils/monitoring/applicationLogTimeline";
const file = {
  id: "journal",
  name: "browser-startup-fixture.jsonl",
  modifiedUnixMs: 3000,
  sizeBytes: 200,
  encrypted: false,
};
const browser = (row: unknown) =>
  parseLogTimeline(JSON.stringify(row), "browser", file)[0];
describe("bounded application log timeline", () => {
  it("preserves proxy acknowledgement observation time in the application sink", () => {
    const row = parseLogTimeline(
      "[2026-10-22T11:00:01Z][INFO][native_browser::proxy] Native browser proxy: timestampUnixMs=1792663200000 source=native event=private-proxy-applied",
      "application",
      file,
    )[0];
    expect(row).toMatchObject({
      category: "proxy",
      timestampMs: 1792663200000,
      level: "INFO",
    });
  });
  it("shows a timestamped native proxy acknowledgement as an observation", () => {
    expect(
      browser({
        version: 1,
        timestampUnixMs: 1792663200000,
        navigation: { event: "private-proxy-applied" },
      }),
    ).toMatchObject({
      category: "proxy",
      message: "Private proxy configuration acknowledged",
      timestampMs: 1792663200000,
      level: "INFO",
    });
  });
  it("keeps proxy application failures timestamped and filterable without raw configuration", () => {
    const row = browser({
      version: 1,
      timestampUnixMs: 1792663200000,
      navigation: {
        event: "tls-bridge-failed",
        reason: "proxy-configuration",
        config: "private-sentinel",
      },
    });
    expect(row).toMatchObject({
      category: "proxy",
      message: "Private proxy configuration failed",
      timestampMs: 1792663200000,
      level: "WARN",
    });
    expect(row.details).toContain("Reason: proxy configuration");
    expect(logRowsText([row])).not.toContain("private-sentinel");
  });
  it("shows bounded TLS phase timings from journals without disclosing unrelated fields", () => {
    const row = browser({
      version: 1,
      timestampUnixMs: 1792663200000,
      navigation: {
        event: "tls-timing",
        phase_ms: [1, 2, 3, 0, 2, 17, 0],
        outcome: 3,
        last_phase: 6,
        password: "private-sentinel",
        url: "https://private-sentinel.invalid",
      },
    });
    expect(row).toMatchObject({
      category: "tls",
      message: "TLS timing: admitted",
      timestampMs: 1792663200000,
      level: "INFO",
    });
    expect(row.details).toContain("Owner check before: 2 ms");
    expect(row.details).toContain("Certificate verification: 3 ms");
    expect(row.details).toContain("UI queue: 17 ms");
    expect(logRowsText([row])).not.toContain("private-sentinel");
  });

  it("rejects malformed TLS metrics and preserves a denied outcome", () => {
    const valid = {
      event: "tls-timing",
      phase_ms: [0, 1, 0, 0, 0, 0, 0],
      outcome: 1,
      last_phase: 1,
    };
    expect(browser({ version: 1, navigation: valid })).toMatchObject({
      message: "TLS timing: owner denied",
      level: "WARN",
    });
    for (const changed of [
      { phase_ms: [0] },
      { phase_ms: [-1, 0, 0, 0, 0, 0, 0] },
      { phase_ms: [86_400_001, 0, 0, 0, 0, 0, 0] },
      { outcome: 5 },
      { last_phase: 7 },
    ]) {
      const row = browser({
        version: 1,
        navigation: { ...valid, ...changed, secret: "private-sentinel" },
      });
      expect(row.message).not.toContain("TLS timing:");
      expect(logRowsText([row])).not.toContain("private-sentinel");
    }
  });
  it("keeps persistent browser failures filterable and preserves observed time across queued logging", () => {
    const rows = parseLogTimeline(
      [
        '[2026-10-19T12:01:00Z][ERROR][native_browser::proxy] Native browser failure: timestampUnixMs=1792411200000 source=native {"event":"load-error","code":-130,"main_frame":true}',
        "[2026-10-19T12:01:00Z][ERROR][native_browser::startup] Native browser client failure: timestampUnixMs=1792411200001 source=frontend sample=4 stage=Create category=Runtime",
        "[2026-10-19T12:01:00Z][ERROR][other_module] Native browser failure: timestampUnixMs=1 ordinary message",
        "[2026-10-19T12:01:00Z][ERROR][native_browser::tls] Native browser failure: timestampUnixMs=9999999999999999 invalid time",
      ].join("\n"),
      "application",
      file,
    );
    expect(rows[0]).toMatchObject({
      source: "application",
      category: "proxy",
      timestampMs: 1792411200000,
      level: "ERROR",
    });
    expect(rows[1]).toMatchObject({
      category: "startup",
      timestampMs: 1792411200001,
    });
    expect(rows[2]).toMatchObject({
      category: "application",
      timestampMs: Date.parse("2026-10-19T12:01:00Z"),
    });
    expect(rows[3]).toMatchObject({
      category: "tls",
      timestampMs: Date.parse("2026-10-19T12:01:00Z"),
    });
    expect(logRowsText(rows)).toContain("[Browser proxy]");
    expect(logRowsText(rows)).toContain('"code":-130');
  });
  it("splits encrypted tracing RDP events, reads fractional dates and keeps real multiline blocks", () => {
    const rows = parseLogTimeline(
      [
        "2026-10-15T10:53:03.615315Z  INFO connect_begin: ironrdp_blocking::connector: Begin connection procedure",
        "2026-10-15T10:53:03.798477Z  INFO connect_finalize: ironrdp_blocking::connector: CredSSP: starting perform_credssp_step",
        '2026-10-15T10:53:03.803993Z  INFO connect_finalize:initialize_security_context{protocol="NTLM"}: sspi::negotiate::client: return=Ok(ContinueNeeded)',
        "2026-10-15T10:56:38.710581Z  INFO ironrdp_cliprdr: CLIPRDR(clipboard) virtual channel has been initialized",
        "2026-10-15T10:57:08.666816Z  WARN ironrdp_cliprdr: clipboard response",
        "  continuation with diagnostic details",
      ].join("\r\n"),
      "application",
      { ...file, name: "encrypted-2026-10-15.log.enc", encrypted: true },
    );
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      timestampMs: Date.parse("2026-10-15T10:53:03.615Z"),
      level: "INFO",
      category: "sessions",
      message: "Begin connection procedure",
    });
    expect(rows[0].details).toContain("Span: connect_begin");
    expect(rows[2]).toMatchObject({
      category: "security",
      message: "return=Ok(ContinueNeeded)",
    });
    expect(rows[2].details).toContain(
      'initialize_security_context{protocol="NTLM"}',
    );
    const sorted = newestLogRows(rows);
    expect(sorted[0]).toMatchObject({
      level: "WARN",
      message: "clipboard response",
    });
    expect(sorted[0].details).toContain("continuation with diagnostic details");
    expect(logRowsText(sorted)).not.toContain("Recorded order");
    expect(logRowsText(sorted)).toContain("[Application sessions] [WARN]");
  });

  it("handles colored headers, nanosecond fractions, offsets and colon-rich span fields", () => {
    const esc = String.fromCharCode(27);
    const rows = parseLogTimeline(
      [
        `${esc}[2m2026-10-15T11:53:03.615315999+01:00${esc}[0m ${esc}[33m WARN${esc}[0m request{url="https://[::1]:443/path", value="escaped\\\"}:field"}:connect_begin: ironrdp_session::x224: sspi::message: body stays a message`,
        "[2026-10-15T10:53:03.616253Z][DEBUG][sorng_ssh] bracketed microseconds",
        "INFO existing level-only entry",
      ].join("\n"),
      "application",
      file,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      timestampMs: Date.parse("2026-10-15T10:53:03.615Z"),
      level: "WARN",
      category: "sessions",
      message: "sspi::message: body stays a message",
    });
    expect(rows[0].details).toContain('url="https://[::1]:443/path"');
    expect(logRowsText(rows)).not.toContain(esc);
    expect(rows[1].timestampMs).toBe(Date.parse("2026-10-15T10:53:03.616Z"));
    expect(rows[2]).toMatchObject({ timestampMs: null, level: "INFO" });
  });

  it("keeps malformed times and leading tail fragments untimed without swallowing the next tracing event", () => {
    const rows = parseLogTimeline(
      [
        "tail fragment from an earlier record",
        "2026-99-15T10:53:03.615315Z INFO other_module: invalid date",
        "2026-10-15T10:53:04.615315Z DEBUG ironrdp_dvc::client: DVC Create Request",
        "  PRIVATE INFO continuation, not another header",
      ].join("\n"),
      "application",
      file,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].timestampMs).toBeNull();
    expect(rows[1]).toMatchObject({
      timestampMs: null,
      category: "application",
      level: "INFO",
    });
    expect(rows[2]).toMatchObject({
      category: "sessions",
      level: "DEBUG",
      message: "DVC Create Request",
    });
    expect(rows[2].details).toContain("PRIVATE INFO continuation");
  });

  it.each(["other_module", "tokio"])(
    "does not promote module-looking message text over the real %s target",
    (target) => {
      const row = parseLogTimeline(
        `2026-10-15T10:53:03.615315Z INFO ${target}: sspi::message: sorng_ssh: message stays intact`,
        "application",
        file,
      )[0];
      expect(row.category).toBe("application");
      expect(row.message).toBe(
        "sspi::message: sorng_ssh: message stays intact",
      );
      expect(row.details).toBe(`Module: ${target}`);
    },
  );

  it("renders fixed journal events without unknown account/page/URL fields", () => {
    const row = browser({
      version: 1,
      timestampUnixMs: 2000,
      stage: "failed",
      failure: "private-proxy",
      url: "PRIVATE_URL",
      account: "PRIVATE_ACCOUNT",
    });
    expect(row.message).toBe("Native browser startup failed");
    expect(row.details).toBe("Reason: private proxy");
    expect(logRowsText([row])).not.toContain("PRIVATE_");
    expect(browser({ version: 1, stage: "PRIVATE_STAGE" }).message).toBe(
      "Unrecognized browser journal record",
    );
    expect(
      parseLogTimeline("PRIVATE_PAGE_TEXT", "browser", file)[0].details,
    ).not.toContain("PRIVATE_");
  });
  it("reads the actual camelCase relay snapshot and fixed state", () => {
    const row = browser({
      version: 1,
      timestampUnixMs: 1000,
      navigation: {
        event: "private-relay",
        code: -130,
        snapshot: {
          state: "listener-failed",
          acceptedConnections: 3,
          authenticationChallenges: 2,
          authenticatedRequests: 1,
          upstreamFailures: 4,
          arbitrary: "PRIVATE",
        },
      },
    });
    expect(row.category).toBe("proxy");
    expect(row.details).toContain("Relay: listener failed");
    expect(row.details).toContain("Connections: 3");
    expect(row.details).toContain("Authentication challenges: 2");
    expect(row.details).toContain("Upstream failures: 4");
    expect(row.details).not.toContain("PRIVATE");
  });
  it("orders newest records first with stable timestamp ties while preserving multiline blocks", () => {
    const rows = parseLogTimeline(
      "[2026-10-14T10:00:00Z][ERROR][sorng_ssh] First failure\n  stack first\n  stack second\n[2026-10-14T10:00:00Z][INFO][sorng_ssh] Later record",
      "application",
      file,
    );
    const sorted = newestLogRows(rows);
    expect(sorted[0].message).toBe("Later record");
    expect(sorted[1].details).toContain("stack first\n  stack second");
    expect(sorted[1].category).toBe("network");
    expect(sorted[1].details).toContain("Module: sorng_ssh");
  });
  it("keeps journal timing31 prewarm elapsed-only, without inventing a timestamp", () => {
    const elapsed = Array(31).fill(0);
    elapsed[0] = 0;
    elapsed[1] = 1000;
    const row = browser({
      timing_version: 1,
      kind: 2,
      stage: 1,
      outcome: 255,
      total_us: 1000,
      reached: 3,
      elapsed_us: elapsed,
    });
    expect(row.message).toBe("Prewarm timing: checkpoint");
    expect(row.timestampMs).toBeNull();
    expect(row.details).toContain("Command entered: 0.00 ms from start");
    expect(row.details).toContain(
      "Command validated: 1.00 ms from start (+1.00 ms)",
    );
    expect(logRowsText([row])).toContain("Recorded order");
  });
  it("orders timestamped native timing with lifecycle records by event time, not file modification time", () => {
    const rows = parseLogTimeline(
      [
        {
          timing_version: 1,
          timestampUnixMs: 1000,
          kind: 2,
          outcome: 255,
          reached: 1,
          elapsed_us: Array(31).fill(0),
        },
        { version: 1, timestampUnixMs: 2000, stage: "ready" },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
      "browser",
      { ...file, modifiedUnixMs: 9000 },
    );
    expect(rows[0]).toMatchObject({
      category: "timing",
      timestampMs: 1000,
      orderMs: 1000,
    });
    expect(newestLogRows(rows).map((row) => row.timestampMs)).toEqual([
      2000, 1000,
    ]);
    expect(logRowsText(rows)).toContain("1970-01-01T00:00:01.000Z");
    expect(logRowsText(rows)).not.toContain("Recorded order");
  });

  it.each([undefined, -1, 1.5, "2000", Number.MAX_SAFE_INTEGER])(
    "keeps missing or invalid timing timestamps %s untimed",
    (timestampUnixMs) => {
      const row = browser({ timing_version: 1, timestampUnixMs });
      expect(row.timestampMs).toBeNull();
      expect(row.orderMs).toBe(file.modifiedUnixMs);
      expect(logRowsText([row])).toContain("Recorded order");
    },
  );

  it("retains only a validated wall timestamp for unrecognized browser records", () => {
    const row = browser({
      version: 42,
      timestampUnixMs: 2000,
      stage: "PRIVATE_STAGE",
      url: "PRIVATE_URL",
      message: "PRIVATE_MESSAGE",
    });
    expect(row).toMatchObject({
      timestampMs: 2000,
      orderMs: 2000,
      message: "Unrecognized browser journal record",
    });
    expect(logRowsText([row])).toContain("1970-01-01T00:00:02.000Z");
    expect(logRowsText([row])).not.toContain("PRIVATE_");
  });

  it("decodes the distinct16slot owner recheck schema instead of journal prewarm", () => {
    const elapsed = Array(16).fill(0);
    elapsed[0] = 1000;
    elapsed[1] = 3000;
    const row = parseLogTimeline(
      `INFO Native browser timing: kind=2 outcome=1 total_us=3000 reached=3 us=${JSON.stringify(elapsed)}`,
      "application",
      file,
    )[0];
    expect(row.message).toBe("Owner recheck timing (outcome code 1)");
    expect(row.details).toContain("Memory checks: 1.00 ms");
    expect(row.details).toContain(
      "Database guard acquired: 3.00 ms from start (+2.00 ms)",
    );
    expect(row.message).not.toContain("Prewarm");
  });
  it("prettifies the exact safe TLS timing phases", () => {
    const row = parseLogTimeline(
      "INFO Native browser TLS timing: outcome=3 last_phase=6 worker_queue_ms=1 owner_before_ms=2 certificate_ms=3 review_ms=4 owner_after_ms=5 ui_queue_ms=6 ui_completion_ms=7",
      "application",
      file,
    )[0];
    expect(row.category).toBe("tls");
    expect(row.message).toBe("TLS timing: admitted");
    expect(row.details).toContain("Certificate verification: 3 ms");
    expect(row.details).toContain("Certificate review: 4 ms");
    expect(row.details).toContain("UI completion: 7 ms");
  });
  it.each(["[,,]", "[1, ]", "[9999999999999999999999]"])(
    "bounds malformed timing arrays %s without crashing",
    (array) => {
      const row = parseLogTimeline(
        `INFO Native browser timing: kind=2 outcome=1 total_us=1 reached=1 us=${array}`,
        "application",
        file,
      )[0];
      expect(row.details).toMatch(/not recognized|not displayed/);
    },
  );
  it("keeps overflowing journal timestamps in fixed fallback order", () => {
    expect(
      parseLogTimeline(
        "[1][INFO][sorng_ssh] No valid wall timestamp",
        "application",
        file,
      )[0].timestampMs,
    ).toBeNull();
    expect(
      browser({
        version: 1,
        timestampUnixMs: Number.MAX_SAFE_INTEGER,
        stage: "ready",
      }).timestampMs,
    ).toBeNull();
    expect(
      browser({
        version: 1,
        timestampUnixMs: Number.MAX_SAFE_INTEGER,
        stage: "ready",
      }).orderMs,
    ).toBe(file.modifiedUnixMs);
  });
  it("bounds the presentation and groups module categories without guessing from message keywords", () => {
    expect(
      parseLogTimeline(
        Array.from({ length: 5000 }, (_, i) => `INFO line${i}`).join("\n"),
        "application",
        file,
      ),
    ).toHaveLength(2000);
    const row = parseLogTimeline(
      "[2026-10-14T10:00:00Z][INFO][other_module] TLS network session",
      "application",
      file,
    )[0];
    expect(row.category).toBe("application");
  });
});
