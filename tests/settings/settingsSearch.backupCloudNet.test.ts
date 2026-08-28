import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";

/* ═══════════════════════════════════════════════════════════════
   t75-e4 — real queries against the backup / cloudSync / backend /
   proxy / vpn tabs.

   These five tabs were the emptiest in the audit: `vpn` had **zero** index
   entries (so `wireguard` and `openvpn` returned nothing at all), `backup`,
   `cloudSync`, `backend` and `proxy` had one apiece, and none of their 20
   option sets had a single possible value indexed.

   Every query below is one a sysadmin would actually type: a protocol name, a
   provider name, a codec, a cipher, or a value they can see on screen. The
   drift guard proves the entries are *anchored*; this file proves they are
   *findable*, which is the half of the user's report the guard cannot check.
   ═══════════════════════════════════════════════════════════════ */

/** Ranked matches against the whole shipped index, not a fixture. */
function search(query: string) {
  return matchSettingsEntries(SETTINGS_SEARCH_INDEX, query);
}

function keys(query: string): string[] {
  return search(query).map((entry) => entry.key);
}

function tabs(query: string): string[] {
  return [...new Set(search(query).map((entry) => entry.section))];
}

/** The section of the best-ranked result. */
function topTab(query: string): string | undefined {
  return search(query)[0]?.section;
}

const MY_TABS = ["backup", "cloudSync", "backend", "proxy", "vpn"] as const;

describe("settings search — backup / cloud / network tabs", () => {
  describe("VPN (the tab had zero entries before t75)", () => {
    it.each([
      ["wireguard", "vpnSettings.wireguardBinaryPath"],
      ["openvpn", "vpnSettings.openvpnBinaryPath"],
    ])("%s resolves to %s", (query, key) => {
      expect(keys(query)).toContain(key);
      expect(topTab(query)).toBe("vpn");
    });

    it.each(["tailscale", "zerotier"])(
      "%s resolves through the default-VPN-type option list",
      (query) => {
        expect(keys(query)).toContain("vpnSettings.defaultVpnType");
      },
    );

    it("finds DNS handling by the leak it exists to prevent", () => {
      expect(keys("dns leak")).toContain("vpnSettings.dnsHandling");
    });

    it("finds the status poller by a two-word query", () => {
      // Tokenised AND across the label — the old substring matcher could not
      // match a query whose words are not adjacent in one field.
      expect(keys("polling interval")).toContain(
        "vpnSettings.statusPollingIntervalMs",
      );
    });

    it("surfaces the tab by name", () => {
      expect(tabs("vpn")).toContain("vpn");
    });
  });

  describe("Cloud sync providers", () => {
    it.each(["onedrive", "webdav", "sftp", "nextcloud"])(
      "%s resolves to the sync-targets picker",
      (query) => {
        expect(keys(query)).toContain("cloudSync.syncTargets");
        expect(tabs(query)).toContain("cloudSync");
      },
    );

    it("finds a provider whose name is two words", () => {
      expect(keys("google drive")).toContain("cloudSync.syncTargets");
    });

    it("finds WebDAV auth methods by value", () => {
      expect(keys("digest authentication")).toContain("cloudSync.syncTargets");
      expect(keys("bearer token")).toContain("cloudSync.syncTargets");
    });

    it("dropbox resolves to backup destinations, where it is the option", () => {
      // Dropbox is a *backup destination* preset, not a cloud-sync provider —
      // `CloudSyncProviders` has no dropbox member. Asserting the truthful tab
      // rather than the one the query looks like it should hit.
      expect(keys("dropbox")).toContain("backup.destinations");
      expect(topTab("dropbox")).toBe("backup");
    });

    it.each(["onedrive", "nextcloud"])(
      "%s reaches both tabs that offer it",
      (query) => {
        expect(tabs(query)).toEqual(
          expect.arrayContaining(["backup", "cloudSync"]),
        );
      },
    );
  });

  describe("Cloud sync behaviour", () => {
    it.each([
      ["conflict resolution", "cloudSync.conflictResolution"],
      ["keep newer", "cloudSync.conflictResolution"],
      ["exclude patterns", "cloudSync.excludePatterns"],
      ["glob", "cloudSync.excludePatterns"],
      ["upload limit", "cloudSync.uploadLimitKBs"],
      ["throttle", "cloudSync.uploadLimitKBs"],
      ["sync on startup", "cloudSync.syncOnStartup"],
      ["sync ssh keys", "cloudSync.syncSSHKeys"],
    ])("%s resolves to %s", (query, key) => {
      expect(keys(query)).toContain(key);
    });

    it("finds a sync frequency by the option text on screen", () => {
      expect(keys("every 15 minutes")).toContain("cloudSync.frequency");
      expect(keys("real-time")).toContain("cloudSync.frequency");
    });
  });

  describe("Proxy", () => {
    it.each(["socks5", "socks4", "http proxy"])(
      "%s resolves to the proxy type",
      (query) => {
        expect(keys(query)).toContain("proxyType");
      },
    );

    it("proxy port — the plan's canonical tokenisation failure", () => {
      // Two tokens in one label. The old `includes(query)` matcher returned 0.
      expect(keys("proxy port")).toContain("proxyPort");
      expect(topTab("proxy port")).toBe("proxy");
    });

    it("finds the port by its documented default", () => {
      expect(keys("1080")).toContain("proxyPort");
    });

    it("finds proxy presets", () => {
      expect(keys("proxy presets")).toContain("globalProxyPresets");
    });
  });

  describe("Backend engine", () => {
    it.each([
      ["h264", "backendConfig.rdpCodecPreference"],
      ["remotefx", "backendConfig.rdpCodecPreference"],
      ["rdpgfx", "backendConfig.rdpCodecPreference"],
      ["codec", "backendConfig.rdpCodecPreference"],
      ["wgpu", "backendConfig.rdpServerRenderer"],
      ["softbuffer", "backendConfig.rdpServerRenderer"],
      ["webview", "backendConfig.rdpServerRenderer"],
      ["trace", "backendConfig.logLevel"],
    ])("%s resolves to %s", (query, key) => {
      expect(keys(query)).toContain(key);
    });

    it("matches H.264 typed with its punctuation", () => {
      // Squashing makes `h264` ≡ `H.264` in both directions.
      expect(keys("h.264")).toContain("backendConfig.rdpCodecPreference");
    });
  });

  describe("Backup", () => {
    it.each([
      ["backup schedule", "backup.frequency"],
      ["cron", "backup.frequency"],
      ["day of month", "backup.monthlyDay"],
      ["differential", "backup.differentialEnabled"],
      ["retention", "backup.maxBackupsToKeep"],
      ["mremoteng", "backup.format"],
      ["include ssh keys", "backup.includeSSHKeys"],
      ["backup on close", "backup.backupOnClose"],
    ])("%s resolves to %s", (query, key) => {
      expect(keys(query)).toContain(key);
    });

    it.each(["chacha20", "aes-256-gcm", "twofish", "serpent"])(
      "%s resolves to the backup cipher list",
      (query) => {
        expect(keys(query)).toContain("backup.encryptionAlgorithm");
      },
    );

    it("matches a cipher typed without punctuation", () => {
      expect(keys("aes256gcm")).toContain("backup.encryptionAlgorithm");
    });

    it("finds the weekly schedule by a day name", () => {
      expect(keys("wednesday")).toContain("backup.weeklyDay");
    });
  });

  describe("Coverage of the five tabs", () => {
    it("every tab is represented and every entry carries synonyms", () => {
      for (const tab of MY_TABS) {
        const entries = SETTINGS_SEARCH_INDEX.filter((e) => e.section === tab);
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(entry.tags.length).toBeGreaterThan(0);
          expect(entry.synonyms?.length ?? 0).toBeGreaterThan(0);
        }
      }
    });

    it("every entry is findable by its own label", () => {
      for (const tab of MY_TABS) {
        for (const entry of SETTINGS_SEARCH_INDEX.filter(
          (e) => e.section === tab,
        )) {
          expect(keys(entry.label)).toContain(entry.key);
        }
      }
    });

    it("every indexed option value is findable", () => {
      // The user's report in one assertion: "doesn't search for ... possible
      // values". Each of the 20 option sets across these tabs is checked here.
      for (const tab of MY_TABS) {
        for (const entry of SETTINGS_SEARCH_INDEX.filter(
          (e) => e.section === tab,
        )) {
          for (const value of entry.values ?? []) {
            expect(
              keys(value),
              `${entry.key} value ${JSON.stringify(value)}`,
            ).toContain(entry.key);
          }
        }
      }
    });

    it("indexes possible values for all 20 option sets on these tabs", () => {
      // The audit counted 20 option sets across these five tabs, and 0 of them
      // had any value indexed. Enumerated explicitly so deleting a `values`
      // array fails here rather than silently shrinking search coverage — the
      // AST guard only sees the *literal* option arrays (backend + proxyType),
      // so the other 18 have no other backstop.
      const OPTION_SET_KEYS = [
        "backup.destinations",
        "backup.frequency",
        "backup.weeklyDay",
        "backup.monthlyDay",
        "backup.format",
        "backup.maxBackupsToKeep",
        "backup.encryptionAlgorithm",
        "cloudSync.syncTargets",
        "cloudSync.frequency",
        "cloudSync.conflictResolution",
        "cloudSync.excludePatterns",
        "backendConfig.logLevel",
        "backendConfig.rdpServerRenderer",
        "backendConfig.rdpCodecPreference",
        "proxyType",
        "vpnSettings.defaultVpnType",
        "vpnSettings.dnsHandling",
      ];
      for (const key of OPTION_SET_KEYS) {
        const entry = SETTINGS_SEARCH_INDEX.find((e) => e.key === key);
        expect(entry, key).toBeDefined();
        expect(entry!.values?.length ?? 0, key).toBeGreaterThan(1);
      }
    });

    it.each([
      // Queries that exist *only* in a `values` array — no label, tag or
      // synonym carries them, so each one fails the moment `values` is dropped.
      ["App Data Folder", "backup.destinations"],
      ["Encrypted JSON", "backup.format"],
      ["Once Daily", "cloudSync.frequency"],
      ["Attempt to Merge", "cloudSync.conflictResolution"],
      ["OS metadata files", "cloudSync.excludePatterns"],
      ["Auto-negotiate", "backendConfig.rdpCodecPreference"],
      ["Auto-detect", "backendConfig.rdpServerRenderer"],
      ["System DNS", "vpnSettings.dnsHandling"],
    ])("the option text %j is searchable and reaches %s", (query, key) => {
      expect(keys(query)).toContain(key);
    });

    it("finds each tab by its sidebar name", () => {
      expect(tabs("Cloud Sync")).toContain("cloudSync");
      expect(tabs("Backend")).toContain("backend");
      expect(tabs("Backup")).toContain("backup");
      expect(tabs("Proxy")).toContain("proxy");
      expect(tabs("VPN")).toContain("vpn");
    });

    it("a nonsense query still returns nothing", () => {
      expect(search("zzzznotasetting")).toEqual([]);
    });
  });
});
