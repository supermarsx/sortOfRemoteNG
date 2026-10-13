import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CredentialFailure,
  credentialFailureCodes,
  failedOutcome,
  settleWithin,
  toCredentialFailure,
} from "../../src/utils/security/credentialFailure";

afterEach(() => vi.useRealTimers());

describe("credential failure catalogue", () => {
  it("gives every cause its own complete sentence", () => {
    const sentences = credentialFailureCodes.map(
      (code) => new CredentialFailure(code).message,
    );
    expect(credentialFailureCodes.length).toBeGreaterThan(30);
    expect(new Set(sentences).size).toBe(credentialFailureCodes.length);
    for (const sentence of sentences) expect(sentence).toMatch(/^[A-Z].*\.$/);
  });
  it("adds the partial-entry warning only when typing had started", () => {
    const plain = new CredentialFailure("typing-focus-lost");
    const partial = new CredentialFailure("typing-focus-lost", true);
    expect(plain.partial).toBe(false);
    expect(plain.message).not.toContain("may have been entered");
    expect(partial.partial).toBe(true);
    expect(partial.message).toBe(
      `${plain.message} Some characters may have been entered; review the field before trying again.`,
    );
  });
  it("keeps a known cause and never an unknown error's text", () => {
    const known = new CredentialFailure("code-expired");
    expect(toCredentialFailure(known, "clipboard-unavailable")).toBe(known);
    for (const unknown of [
      new Error("SYNTHETIC_NATIVE_DETAIL"),
      "SYNTHETIC_NATIVE_DETAIL",
      { code: "code-expired", message: "SYNTHETIC_NATIVE_DETAIL" },
      undefined,
    ]) {
      const failure = toCredentialFailure(unknown, "clipboard-unavailable");
      expect(failure.code).toBe("clipboard-unavailable");
      expect(failure.message).not.toContain("SYNTHETIC");
    }
    expect(failedOutcome(known)).toEqual({
      ok: false,
      code: "code-expired",
      message: known.message,
    });
  });
  it("stops waiting at the limit and leaves no timer behind either way", async () => {
    vi.useFakeTimers();
    const failure = () => new CredentialFailure("resolution-timed-out");
    const hung = settleWithin(new Promise<never>(() => {}), 500, failure);
    const outcome = hung.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(499);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ code: "resolution-timed-out" });
    expect(vi.getTimerCount()).toBe(0);

    await expect(settleWithin(Promise.resolve(7), 500, failure)).resolves.toBe(
      7,
    );
    const rejected = new Error("synthetic");
    await expect(
      settleWithin(Promise.reject(rejected), 500, failure),
    ).rejects.toBe(rejected);
    expect(vi.getTimerCount()).toBe(0);
  });
});
