import { describe, expect, it } from "vitest";
import type { SettingSearchEntry } from "../../src/components/SettingsDialog/settingsSearchIndex/types";
import {
  matchSettingsEntries,
  normalizeSearchText,
  scoreSettingsEntry,
  squashSearchText,
  tokenizeSearchQuery,
} from "../../src/components/SettingsDialog/settingsSearchMatch";

/* Synthetic fixtures on purpose: t75 Phase 1 rewrites the real index content,
   so asserting matcher behaviour against real entries would couple these tests
   to another executor's wording. The real index is covered by the drift guard
   and by the per-group `settingsSearch.<group>.test.ts` suites. */

function entry(overrides: Partial<SettingSearchEntry>): SettingSearchEntry {
  return {
    key: "someKey",
    label: "Some Label",
    description: "Some description",
    tags: [],
    section: "general",
    sectionLabel: "General",
    ...overrides,
  };
}

const keys = (entries: SettingSearchEntry[]) => entries.map((e) => e.key);

describe("normalisation helpers", () => {
  it("lower-cases, collapses whitespace and trims", () => {
    expect(normalizeSearchText("  Proxy   PORT \n")).toBe("proxy port");
  });

  it("squashes away every non-alphanumeric character", () => {
    expect(squashSearchText("AES-256-GCM")).toBe("aes256gcm");
    expect(squashSearchText("H.264")).toBe("h264");
    expect(squashSearchText("Let's Encrypt (Auto-Renew)")).toBe(
      "letsencryptautorenew",
    );
  });

  it("tokenises on whitespace and drops empties", () => {
    expect(tokenizeSearchQuery("  wake  on lan ")).toEqual([
      "wake",
      "on",
      "lan",
    ]);
    expect(tokenizeSearchQuery("   ")).toEqual([]);
  });
});

describe("matchSettingsEntries — tokenisation", () => {
  const index = [
    entry({
      key: "proxyPort",
      label: "Port",
      description: "Listening port for the proxy server",
      tags: ["proxy"],
      section: "proxy",
      sectionLabel: "Proxy",
    }),
    entry({
      key: "themeMode",
      label: "Theme",
      description: "Light or dark appearance",
      tags: ["dark", "light"],
      section: "theme",
      sectionLabel: "Theme",
    }),
    entry({
      key: "backupSchedule",
      label: "Schedule",
      description: "When backups run",
      tags: ["backup", "cron"],
      section: "backup",
      sectionLabel: "Backup",
    }),
  ];

  it("matches multi-word queries whose tokens are spread across fields", () => {
    // The old substring matcher returned nothing for any of these.
    expect(keys(matchSettingsEntries(index, "proxy port"))).toEqual([
      "proxyPort",
    ]);
    expect(keys(matchSettingsEntries(index, "dark theme"))).toEqual([
      "themeMode",
    ]);
    expect(keys(matchSettingsEntries(index, "backup schedule"))).toEqual([
      "backupSchedule",
    ]);
  });

  it("requires every token to match (AND semantics)", () => {
    expect(matchSettingsEntries(index, "proxy nonsense")).toEqual([]);
  });

  it("is order-insensitive across fields", () => {
    expect(keys(matchSettingsEntries(index, "port proxy"))).toEqual([
      "proxyPort",
    ]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(matchSettingsEntries(index, "")).toEqual([]);
    expect(matchSettingsEntries(index, "   ")).toEqual([]);
  });
});

describe("matchSettingsEntries — squashing", () => {
  const index = [
    entry({
      key: "h264Decoder",
      label: "H.264 Decoder",
      section: "rdpDefaults",
    }),
    entry({ key: "autoSaveEnabled", label: "Auto-Save", section: "general" }),
    entry({
      key: "wolEnabled",
      label: "Wake-on-LAN",
      synonyms: ["magic packet"],
      section: "behavior",
    }),
    entry({
      key: "tlsMode",
      label: "TLS Certificate",
      values: ["Self-Signed", "Let's Encrypt (Auto-Renew)"],
      section: "api",
    }),
  ];

  it("ignores punctuation differences in the query", () => {
    expect(keys(matchSettingsEntries(index, "h264"))).toEqual(["h264Decoder"]);
    expect(keys(matchSettingsEntries(index, "H.264"))).toEqual(["h264Decoder"]);
    expect(keys(matchSettingsEntries(index, "autosave"))).toEqual([
      "autoSaveEnabled",
    ]);
    expect(keys(matchSettingsEntries(index, "auto save"))).toEqual([
      "autoSaveEnabled",
    ]);
  });

  it("matches hyphenated labels typed as separate words", () => {
    expect(keys(matchSettingsEntries(index, "wake on lan"))).toEqual([
      "wolEnabled",
    ]);
    expect(keys(matchSettingsEntries(index, "wakeonlan"))).toEqual([
      "wolEnabled",
    ]);
    expect(keys(matchSettingsEntries(index, "self signed"))).toEqual([
      "tlsMode",
    ]);
  });

  it("matches synonyms", () => {
    expect(keys(matchSettingsEntries(index, "magic packet"))).toEqual([
      "wolEnabled",
    ]);
  });
});

describe("matchSettingsEntries — values", () => {
  const index = [
    entry({
      key: "encryptionAlgorithm",
      label: "Algorithm",
      description: "Cipher used at rest",
      values: [
        "aes-256-gcm",
        "AES-256-GCM",
        "chacha20-poly1305",
        "ChaCha20-Poly1305",
      ],
      section: "security",
      sectionLabel: "Security",
    }),
    entry({ key: "unrelated", label: "Unrelated", section: "general" }),
  ];

  it("finds a setting by a value the user can see on screen", () => {
    expect(keys(matchSettingsEntries(index, "AES-256-GCM"))).toEqual([
      "encryptionAlgorithm",
    ]);
    expect(keys(matchSettingsEntries(index, "chacha20"))).toEqual([
      "encryptionAlgorithm",
    ]);
    expect(keys(matchSettingsEntries(index, "gcm"))).toEqual([
      "encryptionAlgorithm",
    ]);
  });
});

describe("matchSettingsEntries — sectionLabel", () => {
  const index = [
    entry({
      key: "apiPort",
      label: "Port",
      section: "api",
      sectionLabel: "API Server",
    }),
    entry({
      key: "aiProvider",
      label: "Provider",
      section: "ai",
      sectionLabel: "AI / LLM Router",
    }),
  ];

  it("finds settings by their tab name", () => {
    expect(keys(matchSettingsEntries(index, "API Server"))).toEqual([
      "apiPort",
    ]);
    expect(keys(matchSettingsEntries(index, "llm router"))).toEqual([
      "aiProvider",
    ]);
  });
});

describe("matchSettingsEntries — tags", () => {
  it("lower-cases tags at match time", () => {
    // The old matcher compared the raw tag, so an upper-case tag was unmatchable.
    const index = [entry({ key: "totpDigits", tags: ["TOTP", "2FA"] })];
    expect(keys(matchSettingsEntries(index, "totp"))).toEqual(["totpDigits"]);
    expect(keys(matchSettingsEntries(index, "2fa"))).toEqual(["totpDigits"]);
  });
});

describe("matchSettingsEntries — ranking", () => {
  const index = [
    entry({ key: "aKey", label: "Nothing", description: "mentions bell here" }),
    entry({
      key: "bellSection",
      label: "Section",
      sectionLabel: "Bell Options",
    }),
    entry({ key: "bellTag", label: "Sound", tags: ["bell"] }),
    entry({ key: "bellValue", label: "Alert", values: ["Bell", "None"] }),
    entry({ key: "bellStyleLong", label: "Terminal Bell Style" }),
    entry({ key: "bellPrefix", label: "Bell Style" }),
    entry({ key: "bell", label: "Bell" }),
    entry({ key: "keyOnlyBell", label: "Unrelated", description: "none" }),
  ];

  it("orders exact label > prefix > substring > value > tag > section > description > key", () => {
    expect(keys(matchSettingsEntries(index, "bell"))).toEqual([
      "bell",
      "bellPrefix",
      "bellStyleLong",
      "bellValue",
      "bellTag",
      "bellSection",
      "aKey",
      "keyOnlyBell",
    ]);
  });

  it("breaks ties by position in the source array (tab order)", () => {
    const ties = [
      entry({ key: "second", label: "Timeout" }),
      entry({ key: "first", label: "Timeout" }),
    ];
    expect(keys(matchSettingsEntries(ties, "timeout"))).toEqual([
      "second",
      "first",
    ]);
  });

  it("scores a non-matching entry zero and a matching entry above zero", () => {
    expect(scoreSettingsEntry(entry({ label: "Bell" }), "nothing")).toBe(0);
    expect(
      scoreSettingsEntry(entry({ label: "Bell" }), "bell"),
    ).toBeGreaterThan(0);
    expect(scoreSettingsEntry(entry({ label: "Bell" }), "")).toBe(0);
  });
});

describe("matchSettingsEntries — i18n", () => {
  const index = [
    entry({
      key: "language",
      label: "Language",
      labelKey: "settings.language.label",
      description: "Application display language",
      descriptionKey: "settings.language.description",
    }),
  ];

  const german = (key: string) =>
    ({
      "settings.language.label": "Sprache",
      "settings.language.description": "Anzeigesprache der Anwendung",
    })[key] ?? key;

  it("matches the translated label when `t` is supplied", () => {
    expect(keys(matchSettingsEntries(index, "sprache", { t: german }))).toEqual(
      ["language"],
    );
    expect(
      keys(matchSettingsEntries(index, "anzeigesprache", { t: german })),
    ).toEqual(["language"]);
  });

  it("still matches the English term in a translated locale", () => {
    expect(
      keys(matchSettingsEntries(index, "language", { t: german })),
    ).toEqual(["language"]);
  });

  it("does not match without `t`", () => {
    expect(matchSettingsEntries(index, "sprache")).toEqual([]);
  });

  it("ignores a `t` that echoes the key back (missing translation)", () => {
    const echo = (key: string) => key;
    expect(
      matchSettingsEntries(index, "settings.language", { t: echo }),
    ).toEqual([]);
  });

  it("survives a `t` that throws", () => {
    const boom = () => {
      throw new Error("i18n not ready");
    };
    expect(keys(matchSettingsEntries(index, "language", { t: boom }))).toEqual([
      "language",
    ]);
  });
});

describe("matchSettingsEntries — key fallback", () => {
  it("still finds a setting by its raw key", () => {
    const index = [entry({ key: "enableTabDetachment", label: "Detach Tabs" })];
    expect(keys(matchSettingsEntries(index, "enableTabDetachment"))).toEqual([
      "enableTabDetachment",
    ]);
    expect(keys(matchSettingsEntries(index, "tabdetachment"))).toEqual([
      "enableTabDetachment",
    ]);
  });
});
