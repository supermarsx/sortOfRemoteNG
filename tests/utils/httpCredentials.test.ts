import { describe, expect, it } from "vitest";
import { resolveHttpBasicCredentials } from "../../src/utils/auth/httpCredentials";

describe("HTTP Basic credentials match editor defaults", () => {
  it.each([undefined, "basic", "password"] as const)(
    "accepts omitted/Basic/legacy mode %s with an empty password",
    (authType) => {
      expect(
        resolveHttpBasicCredentials({
          authType,
          basicAuthUsername: "admin",
          basicAuthPassword: "",
        }),
      ).toEqual({ username: "admin", password: "" });
      expect(
        resolveHttpBasicCredentials({ authType, basicAuthUsername: "admin" }),
      ).toEqual({ username: "admin", password: "" });
    },
  );
  it("does not mix dedicated Basic fields with an unrelated generic password", () => {
    expect(
      resolveHttpBasicCredentials({
        basicAuthUsername: "basic-user",
        username: "generic-user",
        password: "other-secret",
      }),
    ).toEqual({ username: "basic-user", password: "" });
  });
  it("preserves generic legacy credentials and significant password whitespace", () => {
    expect(
      resolveHttpBasicCredentials({
        basicAuthUsername: "",
        basicAuthPassword: "",
        username: "legacy",
        password: " secret ",
      }),
    ).toEqual({ username: "legacy", password: " secret " });
  });
  it.each(["header", "key", "totp"] as const)(
    "does not inject Basic credentials for explicit %s mode",
    (authType) => {
      expect(
        resolveHttpBasicCredentials({
          authType,
          basicAuthUsername: "basic",
          basicAuthPassword: "secret",
          username: "generic",
          password: "secret",
        }),
      ).toBeNull();
    },
  );
  it("supports an intentional empty username and does not invent credentials for blank inputs", () => {
    expect(
      resolveHttpBasicCredentials({ basicAuthPassword: "password-only" }),
    ).toEqual({ username: "", password: "password-only" });
    expect(
      resolveHttpBasicCredentials({
        basicAuthUsername: "",
        basicAuthPassword: "",
      }),
    ).toBeNull();
  });
});
