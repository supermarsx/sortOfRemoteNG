import { describe, expect, it } from "vitest";
import enUS from "../../src/i18n/locales/en-US.json";
import enLeet from "../../src/i18n/locales/en-x-leet.json";
import enPirate from "../../src/i18n/locales/en-x-pirate.json";
import {
  SUPPORTED_LANGUAGES,
  resolveSupportedLanguage,
} from "../../src/i18n/languages";
import {
  generateStyledEnglishCatalogs,
  styledCatalogTextMatches,
  toLeetspeak,
  toPirateSpeak,
} from "../../scripts/styled-english-locales.mjs";

function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(leaves);
}

describe("styled English locales", () => {
  it("accepts platform line endings without hiding catalog drift", () => {
    const expected = '{\n  "save": "Save"\n}\n';
    const asCrlf = (value: string) => value.split("\n").join("\r\n");
    expect(styledCatalogTextMatches(asCrlf(expected), expected)).toBe(true);
    expect(
      styledCatalogTextMatches(
        asCrlf(expected.replace("Save", "Changed")),
        expected,
      ),
    ).toBe(false);
  });

  it("keeps both generated catalogs exactly synchronized with en-US", () => {
    const generated = generateStyledEnglishCatalogs(enUS);
    expect(enLeet).toEqual(generated["en-x-leet"]);
    expect(enPirate).toEqual(generated["en-x-pirate"]);
  });

  it("gives every API rate-limit string a deliberate pirate rendering", () => {
    const english = enUS.settings.api;
    const pirate = enPirate.settings.api;
    const keys = [
      "rateLimit",
      "maxRequests",
      "enableRateLimiting",
      "rateLimitingDescription",
      "rateLimitingTooltip",
      "maxRequestsTooltip",
    ] as const;

    for (const key of keys) {
      expect(pirate[key], key).not.toBe(english[key]);
    }
    expect(pirate.rateLimit).toBe("Request rationing");
    expect(pirate.maxRequests).toBe("Most requests each bell");
    expect(pirate.enableRateLimiting).toBe("Ration the request tide");
    expect(pirate.rateLimitingDescription).toContain("local bilge-checking");
    expect(pirate.rateLimitingTooltip).toContain("Striking this flag");
    expect(pirate.maxRequestsTooltip).toContain("one matey");
  });

  it("uses deterministic transformations and protects operational syntax", () => {
    const source =
      "Save {{count}} files from https://vpn.example.test --force C:\\vpn\\client.ovpn";
    expect(toLeetspeak(source)).toBe(
      "54v3 {{count}} f1135 fr0m https://vpn.example.test --force C:\\vpn\\client.ovpn",
    );
    expect(toPirateSpeak(source)).toBe(
      "Stow {{count}} charts from https://vpn.example.test --force C:\\vpn\\client.ovpn",
    );
    expect(toLeetspeak(source)).toBe(toLeetspeak(source));
    expect(toPirateSpeak(source)).toBe(toPirateSpeak(source));
  });

  it.each([
    "{{count}}",
    "$t(common.save)",
    "${HOME}",
    "$SSH_AUTH_SOCK",
    "%APPDATA%",
    "%s",
    "`ssh -V`",
    "<strong>",
    "</strong>",
    "&amp;",
    "https://vpn.example.test:8443/path?q=1",
    "mailto:ops@example.test",
    "ops@example.test",
    "192.168.1.0/24",
    "[2001:db8::1]:443",
    "server.example.com:8443",
    "C:\\vpn\\client.ovpn",
    "\\\\.\\pipe\\openssh-ssh-agent",
    "\\\\server\\share\\client.ovpn",
    "/tmp/ssh-agent.sock",
    "DOMAIN\\user",
    "--force",
    "client.ovpn",
    "report.json",
    ".enc.json",
    "DEFAULT_ROLES_PATH",
    "domainNames",
    "ansible_*",
    "gpc0=1",
    "550e8400-e29b-41d4-a716-446655440000",
  ])("preserves the operational literal %s", (literal) => {
    expect(toLeetspeak(literal)).toBe(literal);
    expect(toPirateSpeak(literal)).toBe(literal);
  });

  it("protects authoritative glossary terms longest-first", () => {
    const source =
      "Save SSH (Secure Shell), HTTPS, OpenVPN, WireGuard, JSON, and localhost";
    expect(toLeetspeak(source)).toBe(
      "54v3 SSH (Secure Shell), HTTPS, OpenVPN, WireGuard, JSON, 4nd localhost",
    );
    expect(toPirateSpeak(source)).toBe(
      "Stow SSH (Secure Shell), HTTPS, OpenVPN, WireGuard, JSON, and localhost",
    );
  });

  it("does not let a Windows path consume the prose that follows it", () => {
    const source = "Save C:\\vpn\\client.ovpn then delete it";
    expect(toLeetspeak(source)).toBe(
      "54v3 C:\\vpn\\client.ovpn 7h3n d31373 17",
    );
    expect(toPirateSpeak(source)).toBe(
      "Stow C:\\vpn\\client.ovpn then scuttle it",
    );
  });

  it("transforms a meaningful share of the full catalog without blank output", () => {
    const english = leaves(enUS);
    const leet = leaves(enLeet);
    const pirate = leaves(enPirate);
    expect(leet).toHaveLength(english.length);
    expect(pirate).toHaveLength(english.length);
    expect(
      leet.filter((value, index) => value !== english[index]).length,
    ).toBeGreaterThan(6000);
    expect(
      pirate.filter((value, index) => value !== english[index]).length,
    ).toBeGreaterThan(1000);
    expect([...leet, ...pirate].every((value) => value.trim() !== "")).toBe(
      true,
    );
  });

  it("registers valid private-use tags without hijacking ordinary English locales", () => {
    const values = SUPPORTED_LANGUAGES.map(({ value }) => value);
    expect(values).toContain("en-x-leet");
    expect(values).toContain("en-x-pirate");
    expect(Intl.getCanonicalLocales("en-x-leet")).toEqual(["en-x-leet"]);
    expect(Intl.getCanonicalLocales("en-x-pirate")).toEqual(["en-x-pirate"]);
    expect(resolveSupportedLanguage("en-x-leet")).toBe("en-x-leet");
    expect(resolveSupportedLanguage("en-x-pirate")).toBe("en-x-pirate");
    expect(resolveSupportedLanguage("en-AU")).toBe("en-US");
    expect(resolveSupportedLanguage("en")).toBe("en-US");
  });
});
