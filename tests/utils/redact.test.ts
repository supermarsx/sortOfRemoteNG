import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/utils/errors/redact";

describe("redactSecrets", () => {
  it("redacts key-value secrets and explicit needles", () => {
    const redacted = redactSecrets(
      "proxyCommandPassword=super-secret password: hunter2",
      ["super-secret"],
    );

    expect(redacted).toContain("proxyCommandPassword=[redacted]");
    expect(redacted).toContain("password: [redacted]");
    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("hunter2");
  });

  it("redacts private key blocks and token-like values", () => {
    const redacted = redactSecrets(
      "ssh -psecret\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\nAKIAABCDEFGHIJKLMNOP\nya29.token-value",
    );

    expect(redacted).toContain("-p[redacted]");
    expect(redacted).toContain("[redacted private key]");
    expect(redacted).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(redacted).not.toContain("ya29.token-value");
  });
});