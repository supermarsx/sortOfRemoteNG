import { describe, expect, it } from "vitest";
import {
  resolveHttpBasicCredentials,
  selectSavedCredentialPair,
} from "../../src/utils/auth/httpCredentials";

describe("one saved credential pair rule", () => {
  const row = {
    basicAuthUsername: "dedicated-user",
    basicAuthPassword: "dedicated-secret",
    username: "generic-user",
    password: "generic-secret",
  };
  it("takes the dedicated pair as a whole as soon as either of its fields is set", () => {
    expect(selectSavedCredentialPair(row, true)).toEqual({
      username: "dedicated-user",
      password: "dedicated-secret",
      dedicated: true,
    });
    expect(
      selectSavedCredentialPair({ ...row, basicAuthPassword: "" }, true),
    ).toEqual({ username: "dedicated-user", password: "", dedicated: true });
    expect(
      selectSavedCredentialPair({ ...row, basicAuthUsername: undefined }, true),
    ).toEqual({ username: "", password: "dedicated-secret", dedicated: true });
  });
  it("uses the generic pair when the dedicated one is blank or does not apply", () => {
    const generic = {
      username: "generic-user",
      password: "generic-secret",
      dedicated: false,
    };
    expect(
      selectSavedCredentialPair(
        { ...row, basicAuthUsername: "", basicAuthPassword: "" },
        true,
      ),
    ).toEqual(generic);
    // A protocol without dedicated fields ignores stray ones.
    expect(selectSavedCredentialPair(row, false)).toEqual(generic);
    expect(selectSavedCredentialPair({}, true)).toEqual({
      username: "",
      password: "",
      dedicated: false,
    });
  });
  it.each([
    [{ basicAuthUsername: 7 }, true],
    [{ basicAuthPassword: {} }, true],
    [{ basicAuthUsername: "", basicAuthPassword: "", username: 7 }, true],
    [{ password: [] }, false],
  ])("rejects the malformed row %j", (change, dedicated) => {
    expect(
      selectSavedCredentialPair({ ...row, ...change } as never, dedicated),
    ).toBeNull();
  });
  it("is the rule the Basic resolver applies", () => {
    for (const candidate of [
      row,
      { ...row, basicAuthPassword: "" },
      { ...row, basicAuthUsername: "", basicAuthPassword: "" },
      { basicAuthPassword: "only-secret" },
    ]) {
      const pair = selectSavedCredentialPair(candidate, true)!;
      expect(resolveHttpBasicCredentials(candidate)).toEqual({
        username: pair.username,
        password: pair.password,
      });
    }
  });
});

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
