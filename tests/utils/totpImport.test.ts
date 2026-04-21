import { describe, it, expect } from "vitest";
import {
  importTotpEntries,
  parseOtpauthUri,
  IMPORT_SOURCES,
} from "../../src/utils/auth/totpImport";
import type { ImportSource } from "../../src/utils/auth/totpImport";

describe("totpImport", () => {
  describe("parseOtpauthUri", () => {
    it("parses a basic otpauth TOTP URI", () => {
      const result = parseOtpauthUri(
        "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30",
      );
      expect(result).not.toBeNull();
      expect(result!.secret).toBe("JBSWY3DPEHPK3PXP");
      expect(result!.issuer).toBe("Example");
      expect(result!.digits).toBe(6);
      expect(result!.period).toBe(30);
    });

    it("returns null for non-otpauth URIs", () => {
      expect(parseOtpauthUri("https://example.com")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseOtpauthUri("")).toBeNull();
    });

    it("returns null for HOTP URIs (only TOTP supported)", () => {
      expect(
        parseOtpauthUri("otpauth://hotp/Example?secret=JBSWY3DPEHPK3PXP&counter=0"),
      ).toBeNull();
    });

    it("parses URI without issuer prefix in label", () => {
      const result = parseOtpauthUri(
        "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP",
      );
      expect(result).not.toBeNull();
      expect(result!.account).toBe("alice");
    });
  });

  describe("importTotpEntries", () => {
    it("parses otpauth URI lines", () => {
      const content = [
        "otpauth://totp/Service1:user1@test.com?secret=AAAA&issuer=Service1",
        "otpauth://totp/Service2:user2@test.com?secret=BBBB&issuer=Service2",
      ].join("\n");

      const result = importTotpEntries(content, "otpauth-uri");
      expect(result.entries).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it("auto-detects otpauth URI format", () => {
      const content = "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP";
      const result = importTotpEntries(content, "auto");
      expect(result.source).toBe("otpauth-uri");
      expect(result.entries.length).toBeGreaterThanOrEqual(1);
    });

    it("parses Aegis JSON format", () => {
      const aegis = JSON.stringify({
        db: {
          entries: [
            {
              type: "totp",
              name: "test@example.com",
              issuer: "Example",
              info: { secret: "JBSWY3DPEHPK3PXP", algo: "SHA1", digits: 6, period: 30 },
            },
          ],
        },
      });
      const result = importTotpEntries(aegis, "aegis");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].secret).toBe("JBSWY3DPEHPK3PXP");
    });

    it("parses andOTP JSON format", () => {
      const andotp = JSON.stringify([
        {
          secret: "JBSWY3DPEHPK3PXP",
          label: "test@example.com",
          issuer: "Example",
          digits: 6,
          type: "TOTP",
          algorithm: "SHA1",
          period: 30,
        },
      ]);
      const result = importTotpEntries(andotp, "andotp");
      expect(result.entries).toHaveLength(1);
    });

    it("parses 2FAS format with services array", () => {
      const twofas = JSON.stringify({
        services: [
          {
            name: "Example",
            secret: "JBSWY3DPEHPK3PXP",
            otp: { digits: 6, period: 30, algorithm: "SHA1" },
          },
        ],
      });
      const result = importTotpEntries(twofas, "2fas");
      expect(result.entries).toHaveLength(1);
    });

    it("parses Bitwarden JSON format", () => {
      const bitwarden = JSON.stringify({
        items: [
          {
            name: "Example",
            login: { totp: "JBSWY3DPEHPK3PXP", username: "user@test.com" },
          },
        ],
      });
      const result = importTotpEntries(bitwarden, "bitwarden-json");
      expect(result.entries).toHaveLength(1);
    });

    it("parses native JSON format", () => {
      const native = JSON.stringify([
        {
          secret: "JBSWY3DPEHPK3PXP",
          account: "user@test.com",
          issuer: "Example",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
        },
      ]);
      const result = importTotpEntries(native, "json");
      expect(result.entries).toHaveLength(1);
    });

    it("auto-detects Aegis format", () => {
      const aegis = JSON.stringify({
        db: { entries: [{ type: "totp", name: "x", issuer: "Y", info: { secret: "AAAA", algo: "SHA1", digits: 6, period: 30 } }] },
      });
      const result = importTotpEntries(aegis, "auto");
      expect(result.source).toBe("aegis");
    });

    it("auto-detects Bitwarden CSV", () => {
      const csv = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Example,,,0,,user@test,pass,JBSWY3DPEHPK3PXP";
      const result = importTotpEntries(csv, "auto");
      expect(result.source).toBe("bitwarden-csv");
    });

    it("collects errors for invalid entries without crashing", () => {
      const result = importTotpEntries("not valid json {{{{", "json");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("reports error for unknown source", () => {
      const result = importTotpEntries("data", "something-invalid" as ImportSource);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("IMPORT_SOURCES", () => {
    it("exports a list of supported import sources", () => {
      expect(IMPORT_SOURCES.length).toBeGreaterThan(5);
    });

    it("has auto-detect as first entry", () => {
      expect(IMPORT_SOURCES[0].id).toBe("auto");
    });

    it("each source has required fields", () => {
      for (const source of IMPORT_SOURCES) {
        expect(source.id).toBeDefined();
        expect(source.label).toBeDefined();
        expect(source.extensions.length).toBeGreaterThan(0);
        expect(source.description).toBeDefined();
      }
    });
  });
});
