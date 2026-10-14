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
  it("keeps unsupported versions and overflowing journal timestamps in fixed fallback order", () => {
    expect(
      parseLogTimeline(
        "[1][INFO][sorng_ssh] No valid wall timestamp",
        "application",
        file,
      )[0].timestampMs,
    ).toBeNull();
    expect(
      browser({ version: 42, timestampUnixMs: 2000, stage: "ready" })
        .timestampMs,
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
