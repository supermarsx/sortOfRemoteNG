import { describe, expect, it } from "vitest";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";
import { ABOUT_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/about";
import { ADVANCED_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/advanced";
import { DIAGNOSTICS_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/diagnostics";
import { MACROS_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/macros";
import { PERFORMANCE_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/performance";
import { UPDATER_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/updater";
import { WEB_BROWSER_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/webBrowser";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";

/* ═══════════════════════════════════════════════════════════════
   t75-e6 — real-query assertions for the diagnostics / advanced /
   performance / updater / about / macros / webBrowser tabs.

   The drift guard proves the index and the rendered controls agree. It cannot
   prove the entries are *findable*: an entry whose only words are its own
   camelCase key satisfies the guard and still fails the user. These tests run
   the shipping matcher over the whole index and assert that the phrasings a
   sysadmin would actually type resolve to the right setting.
   ═══════════════════════════════════════════════════════════════ */

const GROUP_ENTRIES = [
  ...DIAGNOSTICS_SEARCH_ENTRIES,
  ...ADVANCED_SEARCH_ENTRIES,
  ...PERFORMANCE_SEARCH_ENTRIES,
  ...UPDATER_SEARCH_ENTRIES,
  ...ABOUT_SEARCH_ENTRIES,
  ...MACROS_SEARCH_ENTRIES,
  ...WEB_BROWSER_SEARCH_ENTRIES,
];

/** Keys returned when the query is run against the **whole** index. */
function search(query: string): string[] {
  return matchSettingsEntries(SETTINGS_SEARCH_INDEX, query).map((e) => e.key);
}

/**
 * A query "resolves" to a key when it comes back at all. Rank is asserted
 * separately and only where this group genuinely owns the term — sibling tabs
 * are filled concurrently and may legitimately out-rank us on shared words.
 */
function expectResolves(query: string, key: string) {
  expect(search(query), `query "${query}" should find ${key}`).toContain(key);
}

describe("the assertions below are not vacuous", () => {
  // `expectResolves` uses `toContain`, so it would pass trivially if the
  // matcher ever started returning the whole index. These bound it.
  it("returns nothing for a nonsense query", () => {
    expect(search("zzzqqqnothingatall")).toEqual([]);
    expect(search("wireguard heap macro")).toEqual([]);
  });

  it("returns a small, specific set for a specific query", () => {
    const total = SETTINGS_SEARCH_INDEX.length;
    expect(total).toBeGreaterThan(100);
    for (const query of [
      "latest.json",
      "playback speed",
      "mremoteng",
      "socket",
      "storage.json",
    ]) {
      const results = search(query);
      expect(results.length, query).toBeGreaterThan(0);
      expect(results.length, query).toBeLessThan(total / 10);
    }
  });
});

describe("t75-e6 index integrity", () => {
  it("is wired into the shipped index", () => {
    const shipped = new Set(SETTINGS_SEARCH_INDEX.map((e) => e.key));
    for (const entry of GROUP_ENTRIES) {
      expect(shipped, `${entry.key} is missing from the barrel`).toContain(
        entry.key,
      );
    }
  });

  it("files every entry under one of this executor's tabs", () => {
    const tabs = new Set([
      "diagnostics",
      "advanced",
      "performance",
      "updater",
      "about",
      "macros",
      "webBrowser",
    ]);
    for (const entry of GROUP_ENTRIES) {
      expect(tabs).toContain(entry.section);
    }
  });

  it("gives every entry a description and searchable keywords", () => {
    for (const entry of GROUP_ENTRIES) {
      expect(entry.description.length, entry.key).toBeGreaterThan(20);
      expect(entry.tags.length, entry.key).toBeGreaterThan(2);
    }
  });

  it("never leaves a tag that only repeats the key", () => {
    for (const entry of GROUP_ENTRIES) {
      const meaningful = entry.tags.filter(
        (tag) => tag.toLowerCase() !== entry.key.toLowerCase(),
      );
      expect(meaningful.length, entry.key).toBe(entry.tags.length);
    }
  });
});

describe("memory watchdog is findable by the words a user types", () => {
  // The watchdog thresholds landed with the t77 live-stats readout. Someone
  // tuning them searches for the resource, not for `heapCriticalMb`.
  it.each([
    ["heap", "memoryWatchdog.heapWarningMb"],
    ["memory", "memoryWatchdog.enabled"],
    ["ram", "memoryWatchdog.systemWarningPct"],
    ["watchdog", "memoryWatchdog.enabled"],
    ["memory leak", "memoryWatchdog.enabled"],
    ["out of memory", "memoryWatchdog.enabled"],
    ["oom", "memoryWatchdog.heapKillMb"],
    ["js heap", "memoryWatchdog.enabled"],
    ["system ram", "memoryWatchdog.systemWarningPct"],
    ["detached heap", "memoryWatchdog.detached.heapWarningMb"],
    ["heap critical", "memoryWatchdog.heapCriticalMb"],
    ["memory pressure", "memoryWatchdog.heapKillMb"],
    ["poll interval", "memoryWatchdog.intervalMs"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));

  it("surfaces every heap threshold for the bare query 'heap'", () => {
    const results = search("heap");
    for (const key of [
      "memoryWatchdog.heapWarningMb",
      "memoryWatchdog.heapCriticalMb",
      "memoryWatchdog.heapKillMb",
      "memoryWatchdog.detached.heapWarningMb",
      "memoryWatchdog.detached.heapCriticalMb",
      "memoryWatchdog.detached.heapKillMb",
    ]) {
      expect(results).toContain(key);
    }
  });
});

describe("protocol repair (t71-e6 follow-up) is findable", () => {
  // This card shipped with t71 and was never indexed — searching for it
  // returned nothing at all before t75.
  it.each([
    ["repair", "protocolRepair"],
    ["connection maintenance", "protocolRepair"],
    ["mis-typed", "protocolRepair"],
    ["wrong protocol", "protocolRepair"],
    ["mremoteng", "protocolRepair"],
    ["rdp https", "protocolRepair"],
    ["443", "protocolRepair"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));
});

describe("diagnostics checks are findable by protocol and symptom", () => {
  it.each([
    ["traceroute", "diagnostics.tracerouteMaxHops"],
    ["tracert", "diagnostics.tracerouteMaxHops"],
    ["mtu", "diagnostics.mtuCheckEnabled"],
    ["maximum transmission unit", "diagnostics.mtuCheckEnabled"],
    ["fragmentation", "diagnostics.mtuCheckEnabled"],
    ["icmp", "diagnostics.icmpBlockadeEnabled"],
    ["ping blocked", "diagnostics.icmpBlockadeEnabled"],
    ["udp", "diagnostics.udpProbeEnabled"],
    ["snmp", "diagnostics.udpProbeEnabled"],
    ["tftp", "diagnostics.udpProbeEnabled"],
    ["banner grab", "diagnostics.serviceFingerprintEnabled"],
    ["asymmetric routing", "diagnostics.asymmetricRoutingEnabled"],
    ["dns leak", "diagnostics.leakageDetectionEnabled"],
    ["geoip", "diagnostics.ipGeoEnabled"],
    ["asn", "diagnostics.ipGeoEnabled"],
    ["cipher suite", "diagnostics.tlsCheckEnabled"],
    ["certificate expiry", "diagnostics.tlsCheckEnabled"],
    ["x509", "diagnostics.tlsCheckEnabled"],
    ["handshake", "diagnostics.tcpTimingTimeoutSecs"],
    ["port scan", "diagnostics.portCheckTimeoutSecs"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));

  it("keeps every diagnostics setting reachable from the tab name", () => {
    const results = new Set(search("diagnostics"));
    for (const entry of DIAGNOSTICS_SEARCH_ENTRIES) {
      expect(results, entry.key).toContain(entry.key);
    }
  });
});

describe("log level values are searchable, not just the label", () => {
  // §1 of the plan: 0 of 107 option sets had their values indexed.
  it.each([
    ["debug", "logLevel"],
    ["warning", "logLevel"],
    ["errors only", "logLevel"],
    ["log verbosity", "logLevel"],
    ["loglevel", "logLevel"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));
});

describe("performance status checking exposes its option values", () => {
  it.each([
    ["socket", "statusCheckMethod"],
    ["icmp echo check", "statusCheckMethod"],
    ["http request check", "statusCheckMethod"],
    ["check method", "statusCheckMethod"],
    ["1.1.1.1", "performanceLatencyTarget"],
    ["latency", "performanceLatencyTarget"],
    ["audit log", "enableActionLog"],
    ["retry", "retryAttempts"],
    ["backoff", "retryDelay"],
    ["health check", "enableStatusChecking"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));

  it("moved the status/action-log entries off the advanced tab", () => {
    // They were filed under `advanced` but PerformanceSettings.tsx renders
    // them; the guard's `wrongSection` rule caught it.
    for (const key of [
      "enableStatusChecking",
      "statusCheckInterval",
      "enableActionLog",
    ]) {
      const entries = SETTINGS_SEARCH_INDEX.filter((e) => e.key === key);
      expect(entries.length, key).toBeGreaterThan(0);
      for (const entry of entries) expect(entry.section).toBe("performance");
    }
  });
});

describe("updater is findable in English and by tab name", () => {
  it.each([
    ["check for updates", "updater.status"],
    ["new version", "updater.status"],
    ["restart to update", "updater.status"],
    ["automatic updates", "updater.autoCheckEnabled"],
    ["update interval", "updater.checkIntervalHours"],
    ["private endpoint", "updater.privateEndpointEnabled"],
    ["latest.json", "updater.privateEndpointUrl"],
    ["update manifest", "updater.privateEndpointUrl"],
    ["staged rollout", "updater.privateEndpointEnabled"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));

  it("matches a translated label when a locale is supplied", () => {
    // §4.3: non-English search rides on `labelKey`, with no locale-file change.
    const de = (key: string) =>
      key === "updater.autoCheck" ? "Automatisch nach Updates suchen" : key;
    const results = matchSettingsEntries(SETTINGS_SEARCH_INDEX, "automatisch", {
      t: de,
    }).map((e) => e.key);
    expect(results).toContain("updater.autoCheckEnabled");
  });

  it("still matches the English term when the locale is not English", () => {
    const de = (key: string) =>
      key === "updater.autoCheck" ? "Automatisch nach Updates suchen" : key;
    const results = matchSettingsEntries(SETTINGS_SEARCH_INDEX, "auto-check", {
      t: de,
    }).map((e) => e.key);
    expect(results).toContain("updater.autoCheckEnabled");
  });
});

describe("web browser proxy keepalive is findable", () => {
  it.each([
    ["keepalive", "proxyKeepaliveEnabled"],
    ["keep alive", "proxyKeepaliveEnabled"],
    ["dead proxy", "proxyAutoRestart"],
    ["auto restart", "proxyAutoRestart"],
    ["restart limit", "proxyMaxAutoRestarts"],
    ["bookmarks", "confirmDeleteAllBookmarks"],
    ["favourites", "confirmDeleteAllBookmarks"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));

  it("finds the tab by its sidebar name", () => {
    // Plan §3.3: "Web Browser" returned zero results before the matcher
    // searched `sectionLabel`.
    const results = search("web browser");
    for (const entry of WEB_BROWSER_SEARCH_ENTRIES) {
      expect(results).toContain(entry.key);
    }
  });
});

describe("about exposes paths, permissions and credits", () => {
  it.each([
    ["settings.json", "about.data-locations"],
    ["storage.json", "about.data-locations"],
    ["app data folder", "about.data-locations"],
    ["where are my settings", "about.data-locations"],
    ["capabilities", "about.permissions"],
    ["tauri", "about.desktop-runtime"],
    ["tokio", "about.backend"],
    ["webdriverio", "about.tooling"],
    ["fido2", "about.security"],
    ["mit", "about.license"],
    ["app version", "about.summary"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));

  it("keeps every credit group reachable, not just the anchored three", () => {
    // These seven anchors used to be template literals the guard could not
    // read, so all seven entries looked like dead results.
    for (const key of [
      "about.project",
      "about.frontend",
      "about.desktop-runtime",
      "about.backend",
      "about.protocols",
      "about.security",
      "about.tooling",
    ]) {
      expect(search("about"), key).toContain(key);
    }
  });
});

describe("macros are findable by playback vocabulary", () => {
  it.each([
    ["macro", "macros.defaultStepDelayMs"],
    ["playback speed", "macros.defaultStepDelayMs"],
    ["step delay", "macros.defaultStepDelayMs"],
    ["confirm before replay", "macros.confirmBeforeReplay"],
    ["macro length", "macros.maxMacroSteps"],
  ])("%s -> %s", (query, key) => expectResolves(query, key));
});

describe("queries the audit recorded as returning nothing now resolve", () => {
  // Plan §3.3 listed these as zero-result queries against the old matcher and
  // the old index. Each must now return at least one of this group's settings.
  it.each([
    ["1.1.1.1", "performanceLatencyTarget"],
    ["heap", "memoryWatchdog.heapWarningMb"],
    ["repair", "protocolRepair"],
    ["web browser", "proxyKeepaliveEnabled"],
  ])("%s is no longer a dead query", (query, key) => {
    expect(search(query).length).toBeGreaterThan(0);
    expectResolves(query, key);
  });
});
