import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import { SECURITY_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/security";
import { THEME_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/theme";
import { TRUST_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/trust";
import type { SettingSearchEntry } from "../../src/components/SettingsDialog/settingsSearchIndex/types";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";

/* ═══════════════════════════════════════════════════════════════
   t75-e3 — security / trust / theme search assertions

   The user's report was that search "doesn't search for all the settings,
   possible values, keywords and etc". These tests encode the way a sysadmin
   actually searches: by the *algorithm* or *protocol* name printed in the
   dropdown, not by the label the designer chose.

   `argon2`, `AES-256-GCM`, `ChaCha20`, `credssp`, `kerberos`, `ed25519`,
   `known_hosts`, `tofu` and `6 digits` all appear nowhere in any label — they
   only resolve because the entries carry `values` and `synonyms`.

   Ranking assertions run against this executor's own three modules so a
   concurrently-edited peer tab cannot reorder them; reachability assertions
   run against the whole index, which is the surface the dialog actually
   searches.
   ═══════════════════════════════════════════════════════════════ */

/** The three tabs this file owns, in `SETTINGS_TABS` order. */
const OWNED_ENTRIES: SettingSearchEntry[] = [
  ...THEME_SEARCH_ENTRIES,
  ...SECURITY_SEARCH_ENTRIES,
  ...TRUST_SEARCH_ENTRIES,
];

const keysOf = (entries: SettingSearchEntry[]) => entries.map((e) => e.key);

/** Every key the whole index returns for `query`. */
function search(query: string): string[] {
  return keysOf(matchSettingsEntries(SETTINGS_SEARCH_INDEX, query));
}

/** Ranked results restricted to this executor's tabs. */
function searchOwned(query: string): SettingSearchEntry[] {
  return matchSettingsEntries(OWNED_ENTRIES, query);
}

describe("security search — algorithms and ciphers", () => {
  it("resolves `argon2` to the Argon2id key-derivation parameters", () => {
    const results = search("argon2");
    expect(results).toContain("encryptionAtRest.argon2MemoryKib");
    expect(results).toContain("encryptionAtRest.argon2TimeCost");
    expect(results).toContain("encryptionAtRest.argon2Parallelism");
  });

  it("ranks a security setting first for `argon2`", () => {
    // Other tabs may legitimately mention Argon2 (the About tab lists the
    // crate); the setting a user is hunting for must still come first.
    const results = matchSettingsEntries(SETTINGS_SEARCH_INDEX, "argon2");
    expect(results[0].section).toBe("security");
    const owned = new Set(searchOwned("argon2").map((entry) => entry.section));
    expect([...owned]).toEqual(["security"]);
  });

  it("resolves `AES-256-GCM` to the encryption algorithm setting", () => {
    expect(search("AES-256-GCM")).toContain("encryptionAlgorithm");
    // Squashing makes the punctuation optional — a user typing it from memory
    // rarely reproduces the hyphens exactly.
    expect(search("aes256gcm")).toContain("encryptionAlgorithm");
    expect(search("aes")).toContain("encryptionAlgorithm");
  });

  it("resolves `ChaCha20` to the encryption algorithm setting", () => {
    expect(search("ChaCha20")).toContain("encryptionAlgorithm");
    expect(search("chacha20-poly1305")).toContain("encryptionAlgorithm");
    expect(search("poly1305")).toContain("encryptionAlgorithm");
  });

  it("ranks the algorithm row first for a cipher name", () => {
    expect(searchOwned("ChaCha20")[0].key).toBe("encryptionAlgorithm");
    expect(searchOwned("Serpent-256-CBC")[0].key).toBe("encryptionAlgorithm");
  });

  it("resolves the block cipher modes by their spelled-out names", () => {
    expect(search("galois")).toContain("blockCipherMode");
    expect(search("cipher block chaining")).toContain("blockCipherMode");
  });

  it("resolves `pbkdf2` to both the storage and the export iteration counts", () => {
    const results = search("pbkdf2");
    expect(results).toContain("keyDerivationIterations");
    expect(results).toContain("exportSecurity.keyDerivationIterations");
  });
});

describe("security search — 2FA, keys and CredSSP", () => {
  it("resolves TOTP option values a user reads off the dropdown", () => {
    expect(search("6 digits")).toContain("totpDigits");
    expect(search("30 seconds")).toContain("totpPeriod");
    expect(search("SHA-256")).toContain("totpAlgorithm");
    expect(search("sha512")).toContain("totpAlgorithm");
  });

  it("resolves `2fa` and authenticator-app wording to the TOTP defaults", () => {
    expect(search("2fa")).toContain("totpEnabled");
    expect(search("authenticator")).toContain("totpEnabled");
  });

  it("resolves SSH and database key-file strengths by algorithm", () => {
    expect(search("ed25519")).toContain("sshKeyType");
    expect(search("rsa 4096")).toContain("sshKeyType");
    expect(search("512-bit")).toContain("databaseKeyLength");
  });

  it("resolves CredSSP protocol vocabulary", () => {
    expect(search("credssp")).toContain("credsspDefaults.credsspVersion");
    expect(search("nla")).toContain("credsspDefaults.nlaMode");
    expect(search("kerberos")).toContain("credsspDefaults.kerberosEnabled");
    expect(search("ntlm")).toContain("credsspDefaults.ntlmEnabled");
    expect(search("pku2u")).toContain("credsspDefaults.pku2uEnabled");
  });

  it("resolves the CVE that names the Encryption Oracle setting", () => {
    expect(search("CVE-2018-0886")).toContain(
      "credsspDefaults.oracleRemediation",
    );
    expect(search("encryption oracle")).toContain(
      "credsspDefaults.oracleRemediation",
    );
  });

  it("resolves `tls 1.2` through the option label, not the setting label", () => {
    // The label is "Minimum TLS version" — the version numbers live in `values`.
    expect(search("tls 1.2")).toContain("credsspDefaults.tlsMinVersion");
    expect(search("tls1.3")).toContain("credsspDefaults.tlsMinVersion");
  });
});

describe("security search — export defaults and auto lock", () => {
  it("resolves export formats by name", () => {
    expect(search("mremoteng")).toContain("exportSecurity.defaultFormat");
    expect(search("csv inventory")).toContain("exportSecurity.defaultFormat");
    expect(search("excel")).toContain("exportSecurity.defaultFormat");
  });

  it("resolves the password-strength score labels", () => {
    expect(search("very strong")).toContain(
      "exportSecurity.minimumPasswordScore",
    );
    expect(search("entropy")).toContain("exportSecurity.showEntropyBits");
  });

  it("resolves auto lock by its trigger rather than its label", () => {
    expect(search("alt tab")).toContain("autoLock.lockOnBlur");
    expect(search("idle timeout")).toContain("autoLock.timeoutMinutes");
    expect(search("autolock")).toContain("autoLock.enabled");
  });

  it("resolves encryption-at-rest operations", () => {
    expect(search("rotate master key")).toContain(
      "encryptionAtRest.rotateMasterKey",
    );
    expect(search("audit log")).toContain("encryptionAtRest.auditLog");
    expect(search("keychain")).toContain("encryptionAtRest");
  });
});

describe("theme search", () => {
  it("resolves `dark theme` — the tokenisation case from the audit", () => {
    // The old matcher scored this 0: "dark" and "theme" never appeared
    // contiguously in any single field.
    expect(search("dark theme")).toContain("theme");
    expect(searchOwned("dark theme")[0].key).toBe("theme");
  });

  it("resolves theme values the picker shows", () => {
    expect(search("oled")).toContain("theme");
    expect(search("darkest")).toContain("theme");
  });

  it("resolves color schemes by swatch name", () => {
    expect(search("fuchsia")).toContain("colorScheme");
    expect(search("emerald")).toContain("colorScheme");
  });

  it("resolves transparency and motion settings", () => {
    expect(search("transparency")).toContain("windowTransparencyEnabled");
    expect(search("reduce motion")).toContain("reduceMotion");
    expect(search("prefers-reduced-motion")).toContain("reduceMotion");
  });

  it("resolves background glow parameters", () => {
    expect(search("glow radius")).toContain("backgroundGlowRadius");
    expect(search("glow blur")).toContain("backgroundGlowBlur");
  });

  it("resolves the loading element by loader vocabulary", () => {
    expect(search("spinner")).toContain("loadingElement.defaultType");
    expect(search("icosahedron")).toContain("loadingElement.defaultType");
    expect(search("webp")).toContain("loadingElement.precomputed.outputSizePx");
    expect(search("canvas")).toContain("loadingElement.renderMode");
  });

  it("resolves custom CSS", () => {
    expect(search("stylesheet")).toContain("customCss");
  });
});

describe("trust search", () => {
  it("resolves trust policies by the policy value, not the row label", () => {
    const tofu = search("tofu");
    expect(tofu).toContain("trustPolicy");
    expect(tofu).toContain("sshTrustPolicy");
    expect(search("trust on first use")).toContain("trustPolicy");
  });

  it("resolves `known_hosts` to the OpenSSH import action", () => {
    expect(search("known_hosts")).toContain("trustImportKnownHosts");
    expect(search("known hosts")).toContain("trustImportKnownHosts");
    expect(search("openssh")).toContain("trustImportKnownHosts");
  });

  it("resolves the certificate expiry warning", () => {
    expect(search("certificate expiry")).toContain("certExpiryWarningDays");
  });

  it("resolves stored identities and the legacy sidecar files", () => {
    expect(search("revoke")).toContain("trustStoredIdentities");
    expect(search("trust_store.json")).toContain("trustLegacyStores");
  });

  it("finds the tab by its sidebar name", () => {
    // `sectionLabel` was not searched at all before t75.
    expect(search("Trust Center").length).toBeGreaterThan(0);
    expect(
      matchSettingsEntries(SETTINGS_SEARCH_INDEX, "Trust Center").every(
        (e) => e.section === "trust",
      ),
    ).toBe(true);
  });
});

describe("index hygiene for the owned tabs", () => {
  it("gives every owned entry a description, tags and a stable section", () => {
    for (const entry of OWNED_ENTRIES) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.tags.length).toBeGreaterThan(0);
      expect(["security", "trust", "theme"]).toContain(entry.section);
    }
  });

  it("has no duplicate keys across the three owned tabs", () => {
    const keys = keysOf(OWNED_ENTRIES);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("indexes possible values for every option-backed setting", () => {
    // The user's exact complaint. These are the rows the app renders as a
    // dropdown; each must carry both halves of every `{ value, label }` pair.
    const optionBacked = [
      "encryptionAlgorithm",
      "blockCipherMode",
      "exportSecurity.defaultFormat",
      "exportSecurity.minimumPasswordScore",
      "sshKeyType",
      "databaseKeyLength",
      "credsspDefaults.oracleRemediation",
      "credsspDefaults.nlaMode",
      "credsspDefaults.tlsMinVersion",
      "credsspDefaults.credsspVersion",
      "credsspDefaults.serverCertValidation",
      "passwordReveal.mode",
      "totpDigits",
      "totpPeriod",
      "totpAlgorithm",
      "theme",
      "colorScheme",
      "loadingElement.defaultType",
      "loadingElement.renderMode",
      "loadingElement.reducedMotionMode",
      "loadingElement.precomputed.outputSizePx",
      "loadingElement.precomputed.frameRate",
      "loadingElement.precomputed.mode",
      "trustPolicy",
      "httpsTrustPolicy",
      "sshTrustPolicy",
      "rdpTrustPolicy",
      "certificateTrustPolicy",
    ];
    const byKey = new Map(OWNED_ENTRIES.map((e) => [e.key, e]));
    const missing = optionBacked.filter(
      (key) => (byKey.get(key)?.values?.length ?? 0) === 0,
    );
    expect(missing).toEqual([]);
  });

  it("resolves a nonsense query to nothing", () => {
    expect(searchOwned("zzzznotasetting")).toEqual([]);
  });
});
