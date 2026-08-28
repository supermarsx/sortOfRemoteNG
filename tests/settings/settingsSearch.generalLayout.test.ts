import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";

/* ═══════════════════════════════════════════════════════════════
   t75-e7 — real queries against the real index

   The drift guard proves the index and the rendered controls agree. It cannot
   prove the index is *findable*: an entry can be perfectly anchored and still
   be unreachable by anything a human would type. These tests run the shipping
   matcher over the shipping index and assert the queries a sysadmin actually
   types for the general / language / behavior / startup / layout / recording
   tabs resolve to the right setting.

   Scope is this executor's six tabs. Siblings own the other twenty-one.
   ═══════════════════════════════════════════════════════════════ */

/** Keys returned for `query`, in rank order. */
function search(query: string): string[] {
  return matchSettingsEntries(SETTINGS_SEARCH_INDEX, query).map((e) => e.key);
}

/** Assert `key` is somewhere in the results for `query`. */
function expectFinds(query: string, key: string): void {
  const results = search(query);
  expect(
    results,
    `query ${JSON.stringify(query)} did not surface ${JSON.stringify(key)}`,
  ).toContain(key);
}

/** Assert `key` is the single best result for `query`. */
function expectTop(query: string, key: string): void {
  const results = search(query);
  expect(
    results[0],
    `query ${JSON.stringify(query)} ranked ${JSON.stringify(
      results[0],
    )} above ${JSON.stringify(key)}`,
  ).toBe(key);
}

describe("settings search — general", () => {
  it("finds autosave by every spelling a user might type", () => {
    for (const query of ["autosave", "auto save", "auto-save"]) {
      expectFinds(query, "autoSaveEnabled");
    }
    expectFinds("autosave interval", "autoSaveIntervalMinutes");
  });

  it("finds the newly anchored crash-recovery and tab-naming toggles", () => {
    // Both were index entries pointing at nothing before t75 — a search hit
    // that scrolled nowhere. They are anchored now.
    expectFinds("crash recovery", "detectUnexpectedClose");
    expectFinds("unexpected close", "detectUnexpectedClose");
    expectFinds("hostname", "hostnameOverride");
    expectFinds("tab title", "hostnameOverride");
  });

  it("finds the confirm-main-app-close toggle that had no entry at all", () => {
    expectFinds("confirm main app close", "confirmMainAppClose");
  });

  it("finds the connection timeout rendered on this tab", () => {
    // Indexed only under `performance` before t75, so the General tab's own
    // timeout control could not be navigated to.
    const results = search("connection timeout");
    expect(results).toContain("connectionTimeout");
  });

  it("finds the settings-dialog meta toggles", () => {
    expectFinds("save button", "settingsDialog.showSaveButton");
    expectFinds("confirm before reset", "settingsDialog.confirmBeforeReset");
    expectFinds("restore defaults", "settingsDialog.confirmBeforeReset");
  });
});

describe("settings search — language", () => {
  it("finds the language picker by the language's own name", () => {
    // The dropdown's option labels are native-language, which is exactly what
    // a user searching for their own locale types.
    for (const query of ["português", "deutsch", "español", "français"]) {
      expectFinds(query, "language");
    }
  });

  it("finds the language picker by unaccented spellings", () => {
    // The matcher squashes "ê"/"ñ"/"ç" away rather than folding them to ASCII,
    // so the plain spellings must be indexed explicitly.
    for (const query of ["portugues", "espanol", "francais"]) {
      expectFinds(query, "language");
    }
  });

  it("finds the language picker by non-Latin script", () => {
    for (const query of ["日本語", "한국어", "中文", "Русский"]) {
      expectFinds(query, "language");
    }
  });

  it("finds the language picker by English exonym", () => {
    for (const query of ["japanese", "korean", "russian", "german"]) {
      expectFinds(query, "language");
    }
  });

  it("finds time format by its option labels and examples", () => {
    for (const query of ["24-hour", "24 hour", "13:30", "12-hour", "1:30 pm"]) {
      expectFinds(query, "timeFormat");
    }
  });

  it("finds date format by its option labels", () => {
    expectFinds("date format", "dateFormat");
    expectFinds("locale default", "dateFormat");
  });

  it("finds the advanced regional pickers by their option values", () => {
    expectFinds("gregorian", "calendarSystem");
    expectFinds("hebrew", "calendarSystem");
    expectFinds("devanagari", "numberingSystem");
    expectFinds("utc", "timeZone");
    expectFinds("new york", "timeZone");
    expectFinds("germany", "region");
  });

  it("finds RTL layout by its abbreviation", () => {
    expectFinds("rtl", "rtlLayout");
    expectFinds("right to left", "rtlLayout");
  });
});

describe("settings search — behavior", () => {
  it("finds the five settings that had no index entry before t75", () => {
    expectFinds("delete tab group", "confirmDeleteTabGroup");
    expectFinds("drag and drop rdp", "enableFileDragDropToRdp");
    expectFinds("winrm", "enableWinrmTools");
    expectFinds("windows management tools", "openWinmgmtToolInBackground");
    expectFinds("recently closed", "recentlyClosedTabsMax");
  });

  it("finds mouse-button actions by their option labels", () => {
    expectFinds("previous tab", "mouseBackAction");
    expectFinds("next tab", "mouseForwardAction");
    expectFinds("button 4", "mouseBackAction");
    expectFinds("button 5", "mouseForwardAction");
  });

  it("finds the reconnect backoff by its option values", () => {
    expectFinds("exponential", "autoReconnectBackoff");
    expectFinds("fixed", "autoReconnectBackoff");
  });

  it("finds the tree right-click action by its option labels", () => {
    expectFinds("context menu", "treeRightClickAction");
    expectFinds("quick connect", "treeRightClickAction");
  });

  it("finds clipboard settings by multi-word queries", () => {
    // Two words in different fields — impossible under the old substring
    // matcher, which required the whole query to appear contiguously.
    expectFinds("clear clipboard", "clearClipboardAfterSeconds");
    expectFinds("paste limit", "maxPasteLengthChars");
    expectFinds("multi line paste", "warnOnMultiLinePaste");
  });

  it("finds the Telegram panel, which is anchored as a whole", () => {
    for (const query of ["telegram", "bot token", "webhook", "broadcast"]) {
      expectFinds(query, "telegram.bots");
    }
  });

  it("finds keepalive by sysadmin vocabulary", () => {
    expectFinds("keepalive", "sendKeepaliveOnIdle");
    expectFinds("keep alive", "sendKeepaliveOnIdle");
    expectFinds("heartbeat", "sendKeepaliveOnIdle");
  });
});

describe("settings search — startup", () => {
  it("finds the tab by the name the sidebar shows", () => {
    // `sectionLabel` was "Startup" while the sidebar said "Startup & Tray",
    // so typing the tab's own name returned nothing.
    const results = search("startup & tray");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((key) => key === "startWithSystem")).toBe(true);
  });

  it("finds autostart by the words people actually use", () => {
    for (const query of ["autostart", "run at login", "run on boot"]) {
      expectFinds(query, "startWithSystem");
    }
  });

  it("finds tray settings", () => {
    expectFinds("system tray", "showTrayIcon");
    expectFinds("minimize to tray", "minimizeToTray");
    expectFinds("close to tray", "closeToTray");
  });

  it("finds the welcome screen fields that navigated nowhere before t75", () => {
    expectFinds("welcome title", "welcomeScreenTitle");
    expectFinds("motd", "welcomeScreenMessage");
    expectFinds("hide welcome message", "hideQuickStartMessage");
    expectFinds("quick action buttons", "hideQuickStartButtons");
  });
});

describe("settings search — layout", () => {
  it("finds the thirteen icon toggles that were missing from the index", () => {
    const missingBeforeT75: Array<[string, string]> = [
      ["action log", "showActionLogIcon"],
      ["backup status", "showBackupStatusIcon"],
      ["cloud sync status", "showCloudSyncStatusIcon"],
      ["collection switcher", "showCollectionSwitcherIcon"],
      ["debug panel", "showDebugPanelIcon"],
      ["devtools", "showDevtoolsIcon"],
      ["import export", "showImportExportIcon"],
      ["security icon", "showSecurityIcon"],
      ["shortcut manager", "showShortcutManagerIcon"],
      ["sync & backup", "showSyncBackupStatusIcon"],
    ];
    for (const [query, key] of missingBeforeT75) expectFinds(query, key);

    expectFinds("off screen", "autoRepatriateWindow");
    expectFinds("connection reordering", "enableConnectionReorder");
    expectFinds("sidebar collapsed", "persistSidebarCollapsed");
    expectFinds("sidebar position", "persistSidebarPosition");
  });

  it("finds the tab layout picker by its tile names", () => {
    for (const query of ["mosaic", "custom grid", "side by side", "grid 4"]) {
      expectFinds(query, "defaultTabLayout");
    }
    expectFinds("split screen", "defaultTabLayout");
  });

  it("finds tab grouping by its option labels", () => {
    expectFinds("by protocol", "tabGrouping");
    expectFinds("by hostname", "tabGrouping");
  });

  it("uses pane vocabulary for the sidebar settings", () => {
    for (const query of ["pane", "side bar", "panel width"]) {
      const results = search(query);
      expect(
        results.some((key) => key.startsWith("persistSidebar")),
        `query ${JSON.stringify(query)} surfaced no sidebar setting`,
      ).toBe(true);
    }
  });

  it("files the Recording Manager icon under the tab that renders it", () => {
    const entries = SETTINGS_SEARCH_INDEX.filter(
      (e) => e.key === "showRecordingManagerIcon",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].section).toBe("layout");
  });
});

describe("settings search — recording", () => {
  it("finds export formats by their option labels and values", () => {
    expectFinds("asciicast", "recording.defaultExportFormat");
    expectFinds("asciinema", "recording.defaultExportFormat");
    expectFinds("har", "webRecording.defaultExportFormat");
    expectFinds("http archive", "webRecording.defaultExportFormat");
  });

  it("finds the RDP video format by codec, including punctuation forms", () => {
    for (const query of ["webm", "mp4", "h264", "H.264", "vp9"]) {
      expectFinds(query, "rdpRecording.defaultVideoFormat");
    }
  });

  it("finds recording knobs by sysadmin vocabulary", () => {
    expectFinds("frames per second", "rdpRecording.recordingFps");
    expectFinds("bitrate", "rdpRecording.videoBitrateMbps");
    expectFinds("keystrokes", "recording.recordInput");
    expectFinds("http headers", "webRecording.recordHeaders");
  });

  it("separates the three recording surfaces", () => {
    expectFinds("ssh recording", "recording.enabled");
    expectFinds("rdp recording", "rdpRecording.enabled");
    expectFinds("web recording", "webRecording.enabled");
  });
});

describe("ranking and negative cases", () => {
  it("ranks an exact label above an incidental mention", () => {
    expectTop("tab grouping", "tabGrouping");
    expectTop("drag sensitivity", "dragSensitivityPx");
    expectTop("keepalive interval", "keepaliveIntervalSeconds");
  });

  it("returns nothing for a query that matches no setting", () => {
    expect(search("zzzznotasetting")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  it("requires every token to match (AND semantics)", () => {
    // "mosaic" hits defaultTabLayout; "wireguard" hits nothing on these tabs,
    // so the conjunction must not fall back to an OR.
    expect(search("mosaic zzzznotasetting")).toEqual([]);
  });

  it("gives every entry on these tabs a description and tags", () => {
    const tabs = new Set([
      "general",
      "language",
      "behavior",
      "startup",
      "layout",
      "recording",
    ]);
    const thin = SETTINGS_SEARCH_INDEX.filter(
      (e) =>
        tabs.has(e.section) &&
        (!e.description.trim() || (e.tags?.length ?? 0) === 0),
    ).map((e) => e.key);
    expect(thin).toEqual([]);
  });
});
