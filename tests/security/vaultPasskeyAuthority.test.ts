import { describe, expect, it } from "vitest";
import { vaultPasskeyMatchesHost } from "../../src/utils/security/vaultPasskeyAuthority";
describe("vault passkey relying-party handoff authority", () => {
  it.each(["com", "co.uk", "github.io"])(
    "rejects publicsuffix %s evenwhenexact",
    (rp) => {
      expect(vaultPasskeyMatchesHost(rp, `login.${rp}`)).toBe(false);
      expect(vaultPasskeyMatchesHost(rp, rp)).toBe(false);
    },
  );
  it("allows validparentRP andexactintranethost butnotsiblings", () => {
    expect(vaultPasskeyMatchesHost("example.com", "login.example.com")).toBe(
      true,
    );
    expect(vaultPasskeyMatchesHost("nas", "nas")).toBe(true);
    expect(vaultPasskeyMatchesHost("a.example.com", "b.example.com")).toBe(
      false,
    );
    expect(
      vaultPasskeyMatchesHost("tenant.github.io", "login.tenant.github.io"),
    ).toBe(true);
    expect(vaultPasskeyMatchesHost("tenant.github.io", "other.github.io")).toBe(
      false,
    );
  });
  it("canonicalizesIDNs withoutacceptingURLs,ports oruserinformation", () => {
    expect(vaultPasskeyMatchesHost("bücher.de", "login.xn--bcher-kva.de")).toBe(
      true,
    );
    for (const rp of [
      "example.com:443",
      "https://example.com",
      "user@example.com",
      "example.com/",
      "example.com.",
      "example.com%00",
    ])
      expect(vaultPasskeyMatchesHost(rp, "example.com")).toBe(false);
  });
});
