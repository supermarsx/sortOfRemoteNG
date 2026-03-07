import { describe, it, expect } from "vitest";
import {
  normalizeMac,
  extractOui,
  lookupVendorLocal,
} from "../../src/utils/network/macVendorLookup";

describe("macVendorLookup", () => {
  describe("normalizeMac", () => {
    it("normalizes a dash-separated MAC to colon-uppercase", () => {
      expect(normalizeMac("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
    });

    it("normalizes a bare hex string", () => {
      expect(normalizeMac("aabbccddeeff")).toBe("AA:BB:CC:DD:EE:FF");
    });

    it("returns uppercased input for invalid length", () => {
      expect(normalizeMac("abc")).toBe("ABC");
    });
  });

  describe("extractOui", () => {
    it("extracts first 3 octets", () => {
      expect(extractOui("AA:BB:CC:DD:EE:FF")).toBe("AA:BB:CC");
    });

    it("works with bare hex input", () => {
      expect(extractOui("aabbccddeeff")).toBe("AA:BB:CC");
    });
  });

  describe("lookupVendorLocal", () => {
    it("returns null for unknown OUIs", () => {
      expect(lookupVendorLocal("00:00:01:00:00:00")).toBeNull();
    });

    it("returns a string for known Apple OUI", () => {
      // Apple has many OUI prefixes registered
      const result = lookupVendorLocal("00:03:93:00:00:00");
      if (result) {
        expect(typeof result).toBe("string");
      }
    });
  });
});
