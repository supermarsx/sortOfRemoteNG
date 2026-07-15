import { describe, expect, it } from "vitest";
import { formatErrorForDisplay } from "./formatError";

describe("formatErrorForDisplay", () => {
  it("keeps ordinary Error and string messages useful", () => {
    expect(formatErrorForDisplay(new Error("connection timed out"))).toBe(
      "connection timed out",
    );
    expect(formatErrorForDisplay("connection cancelled")).toBe(
      "connection cancelled",
    );
  });

  it("renders tagged Raw Socket error codes without stringifying details", () => {
    const formatted = formatErrorForDisplay({
      code: "transport",
      details: {
        code: "io",
        details: {
          operation: "connect",
          kind: "connection_refused",
          hostname: "private.example.test",
          password: "must-not-leak",
        },
      },
    });

    expect(formatted).toBe("I/O error (transport / io)");
    expect(formatted).not.toContain("private.example.test");
    expect(formatted).not.toContain("must-not-leak");
    expect(formatted).not.toContain("[object Object]");
  });

  it("renders the bounded RLogin server diagnostic as its message", () => {
    expect(
      formatErrorForDisplay({
        code: "server_diagnostic",
        details: "policy rejected this fixture account\u0000",
      }),
    ).toBe("policy rejected this fixture account (server_diagnostic)");
  });

  it("redacts explicit and recognized secrets from message fields", () => {
    const formatted = formatErrorForDisplay(
      {
        code: "io",
        message:
          "connect to private.example.test failed password=hunter2 token=abc123",
      },
      ["private.example.test"],
    );

    expect(formatted).toContain("[redacted]");
    expect(formatted).not.toContain("private.example.test");
    expect(formatted).not.toContain("hunter2");
    expect(formatted).not.toContain("abc123");
  });

  it("redacts secrets that cross the display truncation boundary", () => {
    const secret = "boundary-secret";
    const formatted = formatErrorForDisplay(`${"x".repeat(2_044)}${secret}`, [
      secret,
    ]);

    expect(formatted).toContain("[redacted]");
    expect(formatted).not.toContain(secret);
    expect(formatted).not.toMatch(/boun$/);
    expect(formatted.length).toBeLessThanOrEqual(2_048);
  });

  it("uses a non-leaking fallback for unknown objects", () => {
    expect(
      formatErrorForDisplay({
        hostname: "private.example.test",
        credential: "must-not-leak",
      }),
    ).toBe("Connection failed.");
  });
});
