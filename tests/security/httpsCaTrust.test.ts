import { describe, expect, it } from "vitest";
import {
  normalizeHttpsCaTrustMode,
  validateHttpsCaTrustMode,
  redirectHttpsTrustPolicy,
  constrainRedirectHttpsPolicy,
} from "../../src/utils/security/httpsCaTrust";
import { validateCertificateInspection } from "../../src/utils/security/certificateInspection";

describe("HTTPS CA preference boundaries", () => {
  it("defaults missing legacy preferences to system, but malformed data to review", () => {
    expect(normalizeHttpsCaTrustMode(undefined)).toBe("system");
    expect(normalizeHttpsCaTrustMode("system")).toBe("system");
    for (const value of [
      null,
      true,
      false,
      1,
      {},
      [],
      "always-trust",
      "review",
    ]) {
      expect(normalizeHttpsCaTrustMode(value)).toBe("review");
      if (value !== "review")
        expect(() => validateHttpsCaTrustMode(value)).toThrow();
    }
    expect(validateHttpsCaTrustMode("review")).toBe("review");
  });
  it("keeps explicit strict/ask on redirects, never carries an unsafe bypass", () => {
    expect(redirectHttpsTrustPolicy("strict")).toBe("strict");
    expect(redirectHttpsTrustPolicy("always-ask")).toBe("always-ask");
    expect(redirectHttpsTrustPolicy(undefined, "strict")).toBe("strict");
    expect(redirectHttpsTrustPolicy("always-trust")).toBe("inherit");
    expect(redirectHttpsTrustPolicy("tofu")).toBe("inherit");
    expect(redirectHttpsTrustPolicy()).toBe("inherit");
    expect(constrainRedirectHttpsPolicy("always-trust", true)).toBe(
      "always-ask",
    );
    for (const policy of ["tofu", "strict", "always-ask"] as const)
      expect(constrainRedirectHttpsPolicy(policy, true)).toBe(policy);
    expect(constrainRedirectHttpsPolicy("always-trust", false)).toBe(
      "always-trust",
    );
    expect(constrainRedirectHttpsPolicy("tofu", true, "strict")).toBe("strict");
    expect(constrainRedirectHttpsPolicy("tofu", true, "always-ask")).toBe(
      "always-ask",
    );
    expect(constrainRedirectHttpsPolicy("strict", true, "always-ask")).toBe(
      "strict",
    );
  });
  it("validates native CA metadata without treating display as authority", () => {
    const base = { fingerprint: "AA:BB:CC" };
    expect(validateCertificateInspection(base)).toBe(base);
    for (const status of ["verified", "unverified", "unavailable"] as const)
      expect(
        validateCertificateInspection({ ...base, ca_validation: { status } })
          .ca_validation?.status,
      ).toBe(status);
    for (const ca_validation of [
      { status: true },
      { status: "verified", proof_id: "" },
      { status: "verified", proof_id: "https://secret/path" },
      { status: "unverified", proof_id: "a".repeat(32) },
      { status: "verified", trusted: true },
    ])
      expect(() =>
        validateCertificateInspection({ ...base, ca_validation } as Parameters<
          typeof validateCertificateInspection
        >[0]),
      ).toThrow();
  });
});
