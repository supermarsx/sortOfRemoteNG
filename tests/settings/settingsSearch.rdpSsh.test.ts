import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { RDP_DEFAULTS_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/rdpDefaults";
import { SSH_TERMINAL_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/sshTerminal";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";

/* ═══════════════════════════════════════════════════════════════
   t75-e2 — the `rdpDefaults` and `sshTerminal` tabs are findable

   Before t75 these were the two worst tabs in the dialog: 37 + 50 rendered
   settings behind 1 + 5 index entries, **none** of which resolved to a control
   that exists, and 41 option sets with zero indexed values. Every query below
   returned nothing.

   The drift guard (`settingsSearchDrift.test.ts`) proves the index and the
   rendered controls agree. This file proves the other half: that what a
   sysadmin would actually *type* reaches the right setting.
   ═══════════════════════════════════════════════════════════════ */

function search(query: string) {
  return matchSettingsEntries(SETTINGS_SEARCH_INDEX, query);
}

function keys(query: string): string[] {
  return search(query).map((entry) => entry.key);
}

/**
 * Asserts `query` reaches this tab's entry for `key`.
 *
 * Matched on `(key, section)` rather than `key` alone: a handful of keys —
 * `copyOnSelect`, `pasteOnRightClick`, `connectionTimeout` — are rendered by
 * more than one tab and so legitimately carry one entry per tab.
 */
function expectResolves(query: string, key: string, section: string) {
  const results = search(query);
  const hit = results.find(
    (entry) => entry.key === key && entry.section === section,
  );
  expect(
    hit,
    `"${query}" should resolve to ${key} in ${section}; got [${results
      .slice(0, 8)
      .map((e) => `${e.section}/${e.key}`)
      .join(", ")}]`,
  ).toBeDefined();
}

describe("settings search — RDP defaults", () => {
  const cases: Array<[query: string, key: string]> = [
    // The five the plan names for this executor.
    ["remotefx", "remoteFxEnabled"],
    ["h264", "h264Decoder"],
    ["smart card", "rdpDefaults.smartCardRedirection"],
    ["1920", "defaultWidth"],

    // Security / negotiation — all previously zero-result (plan §3.3).
    ["credssp", "useCredSsp"],
    ["network level authentication", "enableNla"],
    ["nla first", "negotiationStrategy"],
    ["auto logon", "autoLogon"],

    // Device redirection.
    ["printer", "rdpDefaults.printerRedirection"],
    ["usb", "rdpDefaults.usbRedirection"],
    ["webauthn", "rdpDefaults.webAuthnRedirection"],
    ["fido", "rdpDefaults.webAuthnRedirection"],
    ["serial port", "rdpDefaults.portRedirection"],
    ["drive mapping", "rdpDefaults.driveRedirection"],
    ["spool", "rdpDefaults.printerOutputMode"],

    // Gateway.
    ["gateway", "gatewayEnabled"],
    ["gateway port", "gatewayPort"],
    ["kerberos", "gatewayAuthMethod"],

    // Codecs / rendering.
    ["codec", "codecsEnabled"],
    ["rlgr3", "remoteFxEntropy"],
    ["openh264", "h264Decoder"],
    ["media foundation", "h264Decoder"],
    ["rdpgfx", "gfxEnabled"],
    ["nal passthrough", "nalPassthrough"],
    ["wgpu", "renderBackend"],
    ["softbuffer", "renderBackend"],
    ["webcodecs", "frontendRenderer"],
    ["vsync", "frameScheduling"],

    // Display.
    ["4k", "defaultResolution"],
    ["color depth", "defaultColorDepth"],
    ["smart sizing", "scalingMode"],

    // Audio.
    ["play on remote computer", "audioPlaybackMode"],
    ["microphone", "audioRecordingMode"],

    // Performance / visual experience.
    ["aero", "enableDesktopComposition"],
    ["cleartype", "enableFontSmoothing"],
    ["wallpaper", "disableWallpaper"],
    ["bitmap cache", "persistentBitmapCaching"],
    ["target fps", "targetFps"],

    // TCP.
    ["nagle", "tcpNodelay"],
    ["256 kb", "tcpRecvBufferSize"],
    ["keepalive", "tcpKeepAlive"],

    // Hyper-V + session management.
    ["hyper-v", "enhancedSessionMode"],
    ["session thumbnails", "rdpSessionThumbnailsEnabled"],
    ["tab close policy", "rdpSessionClosePolicy"],
  ];

  it.each(cases)("%s resolves to %s", (query, key) => {
    expectResolves(query, key, "rdpDefaults");
  });

  it("finds the tab by its section label", () => {
    expect(keys("RDP Defaults")).toContain("renderBackend");
  });
});

describe("settings search — SSH terminal", () => {
  const cases: Array<[query: string, key: string]> = [
    // The one the plan names for this executor.
    ["bell", "bellStyle"],

    // Bell details.
    ["pc speaker", "bellStyle"],
    ["visual bell", "bellStyle"],
    ["bell overuse", "bellOveruseProtection"],
    ["taskbar flash", "taskbarFlash"],

    // Font / dimensions.
    ["font size", "fontSize"],
    ["monospace", "fontFamily"],
    ["oblique", "fontStyle"],
    ["letter spacing", "letterSpacing"],
    ["line height", "lineHeight"],
    ["columns", "columns"],

    // Colors.
    ["24-bit", "allow24BitColors"],
    ["truecolor", "allow24BitColors"],
    ["xterm 256", "allowXterm256Colors"],
    ["ansi colors", "allowTerminalAnsiColors"],

    // Background / overlays.
    ["matrix rain", "bgAnimatedEffect"],
    ["starfield", "bgAnimatedEffect"],
    ["vignette", "bgOverlays"],
    ["crt", "bgOverlays"],
    ["gradient stops", "bgGradientStops"],
    ["background image", "bgImagePath"],
    ["edge fading", "bgFadingEnabled"],

    // Character set.
    ["utf-8", "characterSet"],
    ["koi8", "characterSet"],
    ["shift_jis", "characterSet"],
    ["windows-1252", "characterSet"],
    ["ambiguous width", "unicodeAmbiguousWidth"],

    // Line handling / discipline / keyboard.
    ["carriage return", "implicitCrInLf"],
    ["auto wrap", "autoWrap"],
    ["local echo", "localEcho"],
    ["keypad", "disableKeypadMode"],
    ["cursor keys", "disableApplicationCursorKeys"],

    // Scrollback / selection.
    ["scrollback", "scrollbackLines"],
    ["copy on select", "copyOnSelect"],
    ["paste on right-click", "pasteOnRightClick"],
    ["word separators", "wordSeparators"],

    // SSH protocol + crypto suites — the whole reason `values` exists.
    ["ssh-2", "sshVersion"],
    ["quic", "sshVersion"],
    ["compression level", "compressionLevel"],
    ["chacha20", "preferredCiphers"],
    ["aes256-gcm", "preferredCiphers"],
    ["3des", "preferredCiphers"],
    ["hmac-sha2-256", "preferredMACs"],
    ["umac", "preferredMACs"],
    ["curve25519", "preferredKeyExchanges"],
    ["diffie-hellman", "preferredKeyExchanges"],
    ["sntrup761", "preferredKeyExchanges"],
    ["ed25519", "preferredHostKeyAlgorithms"],
    ["ecdsa", "preferredHostKeyAlgorithms"],

    // TCP.
    ["ipv6", "ipProtocol"],
    ["keepalive probes", "sshTcpKeepAlive"],
    ["connection timeout", "connectionTimeout"],

    // Misc.
    ["answerback", "answerbackString"],
    ["remote-controlled printing", "remoteControlledPrinting"],
  ];

  it.each(cases)("%s resolves to %s", (query, key) => {
    expectResolves(query, key, "sshTerminal");
  });

  it("finds the tab by its section label", () => {
    expect(keys("SSH Terminal")).toContain("scrollbackLines");
  });

  it("matches a translated label, not just the English one", () => {
    // `labelKey` is what makes this tab findable in a non-English locale
    // without touching a single locale file.
    const t = (key: string) =>
      key === "settings.sshTerminal.bellStyle" ? "Glockenstil" : key;
    expect(keys("glockenstil")).toEqual([]);
    expect(
      matchSettingsEntries(SETTINGS_SEARCH_INDEX, "glockenstil", { t }).map(
        (e) => e.key,
      ),
    ).toContain("bellStyle");
  });
});

describe("settings search — index quality for these two tabs", () => {
  const mine = [...RDP_DEFAULTS_SEARCH_ENTRIES, ...SSH_TERMINAL_SEARCH_ENTRIES];

  it("covers every rendered control (73 RDP + 69 SSH)", () => {
    expect(RDP_DEFAULTS_SEARCH_ENTRIES).toHaveLength(73);
    expect(SSH_TERMINAL_SEARCH_ENTRIES).toHaveLength(69);
  });

  it("gives every entry a description and keywords", () => {
    const thin = mine
      .filter((e) => e.description.length < 10 || e.tags.length < 2)
      .map((e) => e.key);
    expect(thin).toEqual([]);
  });

  it("indexes the possible values of at least the 41 audited option sets", () => {
    const withValues = mine.filter((e) => (e.values?.length ?? 0) > 0);
    expect(withValues.length).toBeGreaterThanOrEqual(41);
  });

  it("carries labelKey for the translated SSH labels", () => {
    // Every SSH label is rendered through `t()`; none of the RDP ones are.
    const untranslated = SSH_TERMINAL_SEARCH_ENTRIES.filter(
      (e) => !e.labelKey,
    ).map((e) => e.key);
    expect(untranslated).toEqual([]);
    expect(RDP_DEFAULTS_SEARCH_ENTRIES.some((e) => e.labelKey)).toBe(false);
  });

  it("leaves no duplicate keys within a tab", () => {
    for (const entries of [
      RDP_DEFAULTS_SEARCH_ENTRIES,
      SSH_TERMINAL_SEARCH_ENTRIES,
    ]) {
      const seen = new Set<string>();
      const duplicates = entries
        .map((e) => e.key)
        .filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
      expect(duplicates).toEqual([]);
    }
  });

  it("no longer returns nothing for the queries the audit measured as dead", () => {
    // Plan §3.3 — these returned zero results against the old matcher+index.
    const revived = [
      "credssp",
      "h264",
      "remotefx",
      "codec",
      "gateway",
      "printer",
      "usb",
      "smart card",
      "webauthn",
      "1920",
      "bell",
    ];
    const stillDead = revived.filter((query) => search(query).length === 0);
    expect(stillDead).toEqual([]);
  });
});
