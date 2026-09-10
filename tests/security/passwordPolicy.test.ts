import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
import { DEFAULT_PASSWORD_POLICY } from "../../src/types/security/passwordPolicy";
import {
  generatePolicyPassword,
  normalizePasswordPolicy,
  passwordPolicyError,
  validateNewPassword,
} from "../../src/utils/security/passwordPolicy";
beforeEach(() => mocks.invoke.mockReset().mockResolvedValue(null));
describe("local new-password policy", () => {
  it("defaults off and preserves purpose-specific floors", () => {
    expect(normalizePasswordPolicy(undefined).enabled).toBe(false);
    expect(passwordPolicyError("1234", undefined, "database")).toBeNull();
    expect(passwordPolicyError("short", undefined, "export")).toBeNull();
    expect(passwordPolicyError("1234567", undefined, "application")).toMatch(
      /8 characters/,
    );
    expect(passwordPolicyError("😀😀😀😀", undefined, "database")).toBeNull();
    expect(passwordPolicyError("😀😀", undefined, "database")).toMatch(
      /4 characters/,
    );
  });
  it("fails closed on malformed present policy", () => {
    for (const value of [
      null,
      {},
      { ...DEFAULT_PASSWORD_POLICY, minLength: 129 },
      { ...DEFAULT_PASSWORD_POLICY, enabled: "false" },
      { ...DEFAULT_PASSWORD_POLICY, secret: "not-a-setting" },
    ])
      expect(() => normalizePasswordPolicy(value)).toThrow(/invalid/);
  });
  it("enforces each ASCII composition class without exposing the candidate", () => {
    const policy = {
      ...DEFAULT_PASSWORD_POLICY,
      enabled: true,
      requireUppercase: true,
      requireLowercase: true,
      requireDigit: true,
      requireSymbol: true,
    };
    expect(
      passwordPolicyError("Compliant123!", policy, "application"),
    ).toBeNull();
    for (const candidate of [
      "compliant123!",
      "COMPLIANT123!",
      "CompliantABC!",
      "Compliant1234",
    ]) {
      expect(passwordPolicyError(candidate, policy, "database")).toMatch(
        /Include/,
      );
      expect(passwordPolicyError(candidate, policy, "database")).not.toContain(
        candidate,
      );
    }
  });
  it("asks native to validate saved policy rather than passing renderer policy", async () => {
    await validateNewPassword("synthetic-password", "database");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "encryption_validate_new_password",
      { password: "synthetic-password", purpose: "database" },
    );
    mocks.invoke.mockRejectedValueOnce(Error("Unlock storage"));
    await expect(validateNewPassword("other", "export")).rejects.toThrow(
      "Unlock storage",
    );
  });
  it("generates full-length compatible passwords without clipboard or storage", () => {
    const policy = {
      ...DEFAULT_PASSWORD_POLICY,
      enabled: true,
      minLength: 128,
      requireUppercase: true,
      requireLowercase: true,
      requireDigit: true,
      requireSymbol: true,
    };
    const values = Array.from({ length: 5 }, () =>
      generatePolicyPassword(policy),
    );
    expect(new Set(values).size).toBe(5);
    for (const value of values) {
      expect(value).toHaveLength(128);
      expect(passwordPolicyError(value, policy, "generator")).toBeNull();
    }
  });
});
