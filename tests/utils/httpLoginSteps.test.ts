import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import schema from "../../src/types/connection/httpLoginSteps.schema.json";
import type {
  HttpLoginStepsFile,
  HttpLoginStepsIssueCode,
  HttpLoginTotpChallenge,
} from "../../src/types/connection/httpLoginSteps";
import type { HttpApplicationTotpChallenge } from "../../src/utils/connection/httpApplicationProfiles";
import {
  HTTP_LOGIN_EVIDENCE_CLASSES,
  HTTP_LOGIN_NON_PUBLIC_SUFFIXES,
  HTTP_LOGIN_STEPS_LIMITS,
  HTTP_LOGIN_STEPS_SCHEMA_REF,
  HTTP_LOGIN_STEPS_VALIDATOR_ONLY_CODES,
  HTTP_LOGIN_STEP_KINDS,
  HTTP_LOGIN_SUBMISSIONS,
  HTTP_LOGIN_TOTP_SUBMISSIONS,
  assertHttpLoginSteps,
  httpLoginStepMatchesPath,
  isUnverifiedHttpLoginSteps,
  resolveHttpLoginSteps,
  resolveUserHttpLoginSteps,
  validateHttpLoginSteps,
  validateUserHttpLoginSteps,
} from "../../src/utils/connection/httpLoginSteps";

type Doc = Record<string, unknown>;
type Step = Record<string, unknown>;

const evidence = (cls = "A") => ({
  class: cls,
  source: "https://example.com/project/blob/v1.0.0/views/login.html",
  reviewed: "2026-10-12",
});

/** One form on the connection's own origin: what the reviewed forms do today. */
const singleForm = (): Doc => ({
  version: 1,
  id: "example-form",
  evidence: evidence(),
  credentialOrigins: [],
  loginSteps: [
    {
      kind: "form",
      selectors: {
        username: 'form#login input[name="user"]',
        password: 'form#login input[name="pass"][type="password"]',
      },
    },
    {
      kind: "submit",
      submission: "click",
      selectors: { control: 'form#login button[type="submit"]' },
    },
  ],
});

/** Documented example 1: a two-step login on a listed identity origin. */
const twoStep = (): Doc => ({
  $schema: "../../../types/connection/httpLoginSteps.schema.json",
  version: 1,
  id: "example-portal",
  evidence: {
    class: "B",
    source: "https://login.example.com/signin",
    reviewed: "2026-10-12",
  },
  credentialOrigins: ["https://login.example.com"],
  loginSteps: [
    {
      kind: "identifier",
      origin: "https://login.example.com",
      paths: ["/signin"],
      selectors: { username: 'form#signin input[name="email"]' },
    },
    {
      kind: "submit",
      submission: "click",
      selectors: { control: "form#signin button#next" },
    },
    {
      kind: "password",
      origin: "https://login.example.com",
      paths: ["/signin/password"],
      waitFor: 'form#signin input[name="password"]',
      selectors: {
        password: 'form#signin input[name="password"][type="password"]',
      },
    },
    {
      kind: "submit",
      submission: "click",
      selectors: { control: 'form#signin button[type="submit"]' },
    },
  ],
});

/** Documented example 2: a device with no username. */
const passwordOnly = (): Doc => ({
  $schema: "../../../types/connection/httpLoginSteps.schema.json",
  version: 1,
  id: "example-switch",
  evidence: {
    class: "A",
    source: "tests/fixtures/logins/example-switch/fixture.html",
    reviewed: "2026-10-12",
  },
  credentialOrigins: [],
  passwordOnly: true,
  loginSteps: [
    { kind: "password", selectors: { password: "input#password" } },
    { kind: "submit", submission: "enter" },
  ],
});

/** Pre-step click in the top document, then a form in a same-origin frame. */
const preStepFrame = (): Doc => ({
  version: 1,
  id: "example-frame",
  evidence: evidence(),
  credentialOrigins: [],
  loginSteps: [
    { kind: "click", selectors: { control: "#tab2" } },
    {
      kind: "form",
      frame: "appFrame",
      waitFor: "#usernameInput",
      selectors: { username: "#usernameInput", password: "#passwordInput" },
    },
    { kind: "submit", submission: "enter" },
  ],
});

/** Identifier on the connection's origin or the provider's, password at the
 * provider, single-page submission, a prefix gate and a TOTP challenge. */
const crossOrigin = (): Doc => ({
  version: 1,
  id: "example-idp",
  evidence: evidence("B"),
  credentialOrigins: ["https://auth.example.net"],
  loginSteps: [
    {
      kind: "identifier",
      paths: ["/auth/login"],
      selectors: { username: 'input[name="email"]' },
    },
    {
      kind: "submit",
      submission: "spa",
      selectors: { control: 'button[data-testid="continue"]' },
    },
    {
      kind: "identifier",
      origin: "https://auth.example.net",
      paths: ["/log-in"],
      selectors: { username: 'input[name="username"]' },
    },
    {
      kind: "submit",
      submission: "click",
      selectors: { control: 'button[type="submit"]' },
    },
    {
      kind: "password",
      origin: "https://auth.example.net",
      pathPrefixes: ["/log-in/"],
      selectors: { password: 'input[name="password"][type="password"]' },
    },
    {
      kind: "submit",
      submission: "click",
      selectors: { control: 'button[type="submit"]' },
    },
  ],
  totpChallenges: [
    {
      id: "example-idp-totp",
      label: "Example authenticator code",
      codeSelector: 'form input[autocomplete="one-time-code"]',
      submitSelector: 'form button[type="submit"]',
      paths: ["/log-in/mfa"],
      submission: "post",
      origins: ["https://auth.example.net"],
    },
  ],
});

const EXAMPLES: Record<string, () => Doc> = {
  singleForm,
  twoStep,
  passwordOnly,
  preStepFrame,
  crossOrigin,
};

const steps = (doc: Doc) => doc.loginSteps as Step[];
const edit = (make: () => Doc, change: (doc: Doc) => void): Doc => {
  const doc = make();
  change(doc);
  return doc;
};
const issues = (doc: unknown, id?: string) => {
  const result = validateHttpLoginSteps(doc, id === undefined ? {} : { id });
  return result.ok ? [] : result.issues;
};
const codes = (doc: unknown) =>
  [...new Set(issues(doc).map((issue) => issue.code))].sort();
const expectRejected = (
  doc: unknown,
  code: HttpLoginStepsIssueCode,
  path?: string,
) => {
  const found = issues(doc);
  expect(found.map((issue) => issue.code)).toContain(code);
  if (path !== undefined)
    expect(
      found.filter((issue) => issue.code === code).map((issue) => issue.path),
    ).toContain(path);
};

/** The two-step example with its one listed origin replaced everywhere. */
const listedAt = (origin: string): Doc =>
  edit(twoStep, (doc) => {
    doc.credentialOrigins = [origin];
    for (const step of steps(doc)) if (step.origin) step.origin = origin;
  });

/** Special-use and private-use names: never a listed credential origin. */
const NON_PUBLIC_ORIGINS = [
  "https://app.localhost",
  "https://a.b.c.localhost",
  "https://nas.local",
  "https://nas.local:8443",
  "https://host.localdomain",
  "https://router.lan",
  "https://nas.home",
  "https://sso.corp",
  "https://portal.intranet",
  "https://x.internal",
  "https://x.private",
  "https://a.test",
  "https://a.invalid",
  "https://a.example",
  "https://abcdefgh.onion",
  "https://name.alt",
  "https://nas.home.arpa",
  "https://1.0.0.127.in-addr.arpa",
  "https://ipv4only.arpa",
  "https://box.mail",
];

/** Public names that merely contain one of those words. */
const PUBLIC_LOOKALIKE_ORIGINS = [
  "https://notlocal.com",
  "https://mylocalhost.com",
  "https://local.example.com",
  "https://localhost.example.com",
  "https://internal.example.com",
  "https://test.example.org",
  "https://onion.example.net",
  "https://arpa.example.com",
  "https://home.arpa.example.com",
  "https://my-lan.example.com",
  "https://x.locals",
  "https://a.testing",
  "https://a.examples",
  "https://login.example.com:8443",
];

/** Punycode A-labels are ordinary public names. */
const PUNYCODE_ORIGINS = [
  "https://xn--bcher-kva.example.com",
  "https://login.xn--p1ai",
];

describe("login steps: accepted files", () => {
  it.each(Object.entries(EXAMPLES))("accepts the %s example", (_, make) => {
    const result = validateHttpLoginSteps(make());
    expect(result).toMatchObject({ ok: true });
  });

  it("returns a normalized copy with defaults and without $schema", () => {
    const source = twoStep();
    const result = validateHttpLoginSteps(source);
    if (!result.ok) throw new Error("expected a valid file");
    expect(result.value).not.toBe(source);
    expect(result.value).not.toHaveProperty("$schema");
    expect(result.value.passwordOnly).toBe(false);
    expect(result.value.loginSteps).toEqual(source.loginSteps);
    expect(result.value.loginSteps).not.toBe(source.loginSteps);
    expect(Object.keys(result.value)).toEqual([
      "version",
      "id",
      "evidence",
      "credentialOrigins",
      "passwordOnly",
      "loginSteps",
    ]);
  });

  it("never throws, even for a value whose property reads throw", () => {
    const boom = () => {
      throw new Error("accessor");
    };
    const topLevel = Object.defineProperty(singleForm(), "id", {
      enumerable: true,
      get: boom,
    });
    const nested = singleForm();
    Object.defineProperty(steps(nested)[0].selectors as Step, "username", {
      enumerable: true,
      get: boom,
    });
    const list = singleForm();
    list.loginSteps = new Proxy(steps(list), { get: boom });
    const revocable = Proxy.revocable(singleForm(), {});
    revocable.revoke();
    const hostile: unknown[] = [
      topLevel,
      nested,
      list,
      new Proxy(singleForm(), { get: boom }),
      new Proxy(singleForm(), { ownKeys: boom }),
      new Proxy(singleForm(), { getPrototypeOf: boom }),
      revocable.proxy,
    ];
    for (const [index, value] of hostile.entries()) {
      // Not JSON data: refused as a whole, with no partial reading.
      expect(validateHttpLoginSteps(value), `value ${index}`).toEqual({
        ok: false,
        issues: [expect.objectContaining({ code: "not-an-object", path: "" })],
      });
      expect(validateUserHttpLoginSteps(value), `value ${index}`).toEqual({
        ok: false,
        issues: [expect.objectContaining({ code: "not-an-object", path: "" })],
      });
      expect(
        resolveHttpLoginSteps(value, {
          connectionOrigin: "https://app.example.com",
        }).ok,
        `value ${index}`,
      ).toBe(false);
    }
  });

  it("reads each field once, so what it checked is what it returns", () => {
    const doc = singleForm();
    const selectors = steps(doc)[1].selectors as Step;
    let reads = 0;
    Object.defineProperty(selectors, "control", {
      enumerable: true,
      get: () => (reads++ === 0 ? "#reviewed-submit" : "#swapped-control"),
    });
    const result = validateHttpLoginSteps(doc);
    if (!result.ok) throw new Error("expected a valid file");
    expect(result.value.loginSteps[1]).toMatchObject({
      selectors: { control: "#reviewed-submit" },
    });
    expect(reads).toBe(1);
  });

  it("checks the expected id from the file name when one is given", () => {
    expect(issues(singleForm(), "example-form")).toEqual([]);
    expect(issues(singleForm(), "other-app")).toEqual([
      expect.objectContaining({ code: "id-mismatch", path: "id" }),
    ]);
  });

  it("labels class B as unverified from the evidence class alone", () => {
    expect(isUnverifiedHttpLoginSteps(singleForm() as HttpLoginStepsFile)).toBe(
      false,
    );
    expect(isUnverifiedHttpLoginSteps(twoStep() as HttpLoginStepsFile)).toBe(
      true,
    );
    expect(HTTP_LOGIN_EVIDENCE_CLASSES).toEqual(["A", "B"]);
  });

  it("assertHttpLoginSteps throws rule codes and field paths, never file text", () => {
    expect(assertHttpLoginSteps(singleForm()).id).toBe("example-form");
    const secretLooking = "input#never-echo-this-selector";
    const bad = edit(singleForm, (doc) => {
      steps(doc)[0].selectors = { username: secretLooking };
    });
    let message = "";
    try {
      assertHttpLoginSteps(bad);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("missing-field");
    expect(message).toContain("loginSteps[0].selectors.password");
    expect(message).not.toContain(secretLooking);
  });
});

describe("login steps: credential origins", () => {
  it("rejects a step whose origin is not in credentialOrigins", () => {
    expectRejected(
      edit(twoStep, (doc) => {
        steps(doc)[2].origin = "https://evil.example.org";
      }),
      "origin-not-listed",
      "loginSteps[2].origin",
    );
    // A click releases no credential, but it still acts only on listed origins.
    expectRejected(
      edit(singleForm, (doc) => {
        steps(doc).unshift({
          kind: "click",
          origin: "https://login.example.com",
          selectors: { control: "#open" },
        });
      }),
      "origin-not-listed",
      "loginSteps[0].origin",
    );
    // Near misses are different origins: scheme, port, subdomain, suffix.
    for (const origin of [
      "https://login.example.com:8443",
      "https://www.login.example.com",
      "https://login.example.com.evil.org",
      "https://example.com",
    ])
      expectRejected(
        edit(twoStep, (doc) => {
          steps(doc)[0].origin = origin;
        }),
        "origin-not-listed",
        "loginSteps[0].origin",
      );
  });

  it("requires an explicit credentialOrigins list, even when it is empty", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        delete doc.credentialOrigins;
      }),
      "missing-field",
      "credentialOrigins",
    );
  });

  it("rejects a listed origin that no step or challenge uses", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        doc.credentialOrigins = ["https://login.example.com"];
      }),
      "unused-credential-origin",
      "credentialOrigins[0]",
    );
  });

  it("rejects a non-HTTPS origin in the file, whatever the connection is", () => {
    const http = edit(twoStep, (doc) => {
      doc.credentialOrigins = ["http://login.example.com"];
      for (const step of steps(doc))
        if (step.origin) step.origin = "http://login.example.com";
    });
    expectRejected(http, "insecure-origin", "credentialOrigins[0]");
    // Not even the connection's own configured HTTP origin may be written
    // into a file: that origin is only ever reached through the default.
    const resolved = resolveHttpLoginSteps(http, {
      connectionOrigin: "http://login.example.com",
      configuredHttpOrigin: "http://login.example.com",
    });
    expect(resolved.ok).toBe(false);
    for (const origin of ["ftp://login.example.com", "//login.example.com"])
      expect(
        codes(
          edit(twoStep, (doc) => {
            doc.credentialOrigins = [origin];
          }),
        ),
      ).toContain("invalid-origin");
  });

  it("allows HTTP only for the connection's own configured HTTP origin", () => {
    const configured = "http://192.168.1.1:8080";
    const ok = resolveHttpLoginSteps(singleForm(), {
      connectionOrigin: configured,
      configuredHttpOrigin: configured,
    });
    if (!ok.ok) throw new Error("expected the configured HTTP origin to pass");
    expect(ok.value.steps.map((step) => step.origin)).toEqual([
      configured,
      configured,
    ]);
    for (const configuredHttpOrigin of [
      undefined,
      null,
      "http://192.168.1.1",
      "http://192.168.1.2:8080",
      "https://192.168.1.1:8080",
    ]) {
      const refused = resolveHttpLoginSteps(singleForm(), {
        connectionOrigin: configured,
        configuredHttpOrigin,
      });
      expect(refused).toMatchObject({
        ok: false,
        issues: [{ code: "insecure-connection-origin" }],
      });
    }
    // The rule holds even when no step would run on the HTTP origin.
    expect(
      resolveHttpLoginSteps(twoStep(), {
        connectionOrigin: "http://portal.example.com",
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "insecure-connection-origin" }],
    });
  });

  it.each([
    "https://login.example.com/",
    "https://login.example.com/signin",
    "https://login.example.com:443",
    "https://login.example.com:0",
    "https://login.example.com:65536",
    "https://LOGIN.example.com",
    "https://user@login.example.com",
    "https://*.example.com",
    "https://login.example.com.",
    "https://192.168.1.1",
    "https://[::1]",
    "https://localhost",
    "https://intranet",
    "https://login.example.com?x=1",
    "https://login.example.com#x",
    " https://login.example.com",
    `https://${"a".repeat(64)}.example.com`,
    "",
    7,
    null,
  ])("rejects the non-canonical or non-public origin %j", (origin) => {
    const doc = edit(twoStep, (file) => {
      file.credentialOrigins = [origin];
    });
    expect(codes(doc)).toContain("invalid-origin");
  });

  it("accepts a canonical origin with a non-default port", () => {
    const doc = edit(twoStep, (file) => {
      file.credentialOrigins = ["https://login.example.com:8443"];
      for (const step of steps(file))
        if (step.origin) step.origin = "https://login.example.com:8443";
    });
    expect(issues(doc)).toEqual([]);
  });

  it("rejects duplicate and excess credential origins", () => {
    expectRejected(
      edit(twoStep, (doc) => {
        doc.credentialOrigins = [
          "https://login.example.com",
          "https://login.example.com",
        ];
      }),
      "duplicate-entry",
      "credentialOrigins[1]",
    );
    expectRejected(
      edit(twoStep, (doc) => {
        doc.credentialOrigins = Array.from(
          { length: HTTP_LOGIN_STEPS_LIMITS.credentialOrigins + 1 },
          (_, index) => `https://login${index}.example.com`,
        );
      }),
      "invalid-list",
      "credentialOrigins",
    );
  });
});

describe("login steps: special-use and private-use host names", () => {
  it.each(NON_PUBLIC_ORIGINS)(
    "rejects %s as a listed credential origin",
    (origin) => {
      const doc = listedAt(origin);
      expectRejected(doc, "invalid-origin", "credentialOrigins[0]");
      expectRejected(doc, "invalid-origin", "loginSteps[0].origin");
      expect(validateHttpLoginSteps(doc).ok).toBe(false);
    },
  );

  it.each(PUBLIC_LOOKALIKE_ORIGINS)(
    "accepts %s: a suffix counts only as the whole last label",
    (origin) => {
      expect(issues(listedAt(origin))).toEqual([]);
    },
  );

  it.each(PUNYCODE_ORIGINS)("still accepts the punycode name %s", (origin) => {
    expect(issues(listedAt(origin))).toEqual([]);
  });

  it("applies to a click step and to a challenge origin as well", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        doc.credentialOrigins = ["https://x.internal"];
        steps(doc).unshift({
          kind: "click",
          origin: "https://x.internal",
          selectors: { control: "#open" },
        });
      }),
      "invalid-origin",
      "loginSteps[0].origin",
    );
    expectRejected(
      edit(crossOrigin, (doc) => {
        (doc.totpChallenges as Step[])[0].origins = ["https://mfa.internal"];
      }),
      "invalid-origin",
      "totpChallenges[0].origins[0]",
    );
  });

  it("has no upper-case way around the rule", () => {
    for (const origin of [
      "https://nas.LOCAL",
      "https://nas.Local",
      "https://APP.localhost",
      "https://app.LocalHost",
      "https://x.INTERNAL",
    ])
      expectRejected(
        listedAt(origin),
        "invalid-origin",
        "credentialOrigins[0]",
      );
  });

  it("publishes the suffix list and rejects every name under each entry", () => {
    expect([...HTTP_LOGIN_NON_PUBLIC_SUFFIXES].sort()).toEqual([
      "alt",
      "arpa",
      "corp",
      "example",
      "home",
      "internal",
      "intranet",
      "invalid",
      "lan",
      "local",
      "localdomain",
      "localhost",
      "mail",
      "onion",
      "private",
      "test",
    ]);
    for (const suffix of HTTP_LOGIN_NON_PUBLIC_SUFFIXES)
      for (const host of [`host.${suffix}`, `a.b.${suffix}`])
        expectRejected(
          listedAt(`https://${host}`),
          "invalid-origin",
          "credentialOrigins[0]",
        );
    // What scripts/capture-login-page.mjs (classifyHost) refuses to load, as
    // read on 2026-10-12. This list may never be narrower than that one.
    for (const suffix of [
      "localhost",
      "local",
      "lan",
      "home",
      "internal",
      "intranet",
      "corp",
      "private",
      "localdomain",
      "home.arpa",
      "test",
      "invalid",
      "example",
    ])
      expect(
        validateHttpLoginSteps(listedAt(`https://device.${suffix}`)).ok,
        suffix,
      ).toBe(false);
  });

  it("keeps such a name usable as the connection's own origin", () => {
    for (const connectionOrigin of [
      "https://nas.local",
      "https://app.localhost:8443",
      "https://x.internal",
      "https://nas.home.arpa",
      "https://router.lan",
    ]) {
      const result = resolveHttpLoginSteps(singleForm(), { connectionOrigin });
      if (!result.ok)
        throw new Error(`expected ${connectionOrigin} to resolve`);
      expect(result.value.steps.map((step) => step.origin)).toEqual([
        connectionOrigin,
        connectionOrigin,
      ]);
      expect(result.value.credentialOrigins).toEqual([connectionOrigin]);
    }
    // Plain HTTP on a private name: only as the configured HTTP origin.
    expect(
      resolveHttpLoginSteps(singleForm(), {
        connectionOrigin: "http://nas.local",
        configuredHttpOrigin: "http://nas.local",
      }),
    ).toMatchObject({ ok: true });
    expect(
      resolveHttpLoginSteps(singleForm(), {
        connectionOrigin: "http://nas.local",
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "insecure-connection-origin" }],
    });
  });

  it("never lets a file name it, even when it is the connection's own", () => {
    const result = resolveHttpLoginSteps(listedAt("https://nas.local"), {
      connectionOrigin: "https://nas.local",
    });
    if (result.ok) throw new Error("expected the listed private name to fail");
    expect(result.issues.map((issue) => issue.code)).toContain(
      "invalid-origin",
    );
  });

  it("refuses a user-configured step that names a private origin", () => {
    const userSteps = (origin?: string): Doc => ({
      loginSteps: [
        {
          kind: "form",
          ...(origin ? { origin } : {}),
          selectors: { username: "#user", password: "#pass" },
        },
        { kind: "submit", submission: "enter" },
      ],
    });
    // Reachable only by omitting `origin`.
    expect(
      resolveUserHttpLoginSteps(userSteps(), {
        connectionOrigin: "https://nas.local",
      }),
    ).toMatchObject({ ok: true, value: { crossOrigin: false } });
    for (const origin of ["https://nas.local", "https://other.internal"]) {
      const validated = validateUserHttpLoginSteps(userSteps(origin));
      if (validated.ok) throw new Error("expected the user steps to fail");
      expect(validated.issues).toEqual([
        expect.objectContaining({
          code: "invalid-origin",
          path: "loginSteps[0].origin",
        }),
      ]);
      expect(
        resolveUserHttpLoginSteps(userSteps(origin), {
          connectionOrigin: "https://nas.local",
        }).ok,
      ).toBe(false);
    }
  });
});

describe("login steps: bounds", () => {
  const withSelector = (value: unknown) =>
    edit(singleForm, (doc) => {
      (steps(doc)[0].selectors as Step).username = value;
    });

  it("accepts a selector at the existing 512-unit bound and rejects one over it", () => {
    const limit = HTTP_LOGIN_STEPS_LIMITS.selectorLength;
    expect(limit).toBe(512);
    expect(issues(withSelector("a".repeat(limit)))).toEqual([]);
    expectRejected(
      withSelector("a".repeat(limit + 1)),
      "invalid-selector",
      "loginSteps[0].selectors.username",
    );
    // Engines count UTF-16 units: 257 astral characters are 514 units.
    expectRejected(withSelector("\u{1F512}".repeat(257)), "invalid-selector");
  });

  it.each<{ why: string; value: unknown }>([
    { why: "empty", value: "" },
    { why: "blank", value: "   " },
    { why: "padded at the start", value: " #user" },
    { why: "padded at the end", value: "#user " },
    { why: "ended by a line feed", value: "#user\n" },
    { why: "split by a tab", value: "#us\ter" },
    { why: "split by NUL", value: "#us\u0000er" },
    { why: "split by DEL", value: "#us\u007fer" },
    { why: "split by a C1 control", value: "#us\u0085er" },
    { why: "a number", value: 42 },
    { why: "null", value: null },
    { why: "an array", value: ["#user"] },
  ])("rejects a selector that is $why", ({ value }) => {
    expectRejected(withSelector(value), "invalid-selector");
  });

  it("applies the selector bounds to every selector-valued field", () => {
    const long = "a".repeat(513);
    expectRejected(
      edit(singleForm, (doc) => {
        (steps(doc)[0].selectors as Step).password = long;
      }),
      "invalid-selector",
      "loginSteps[0].selectors.password",
    );
    expectRejected(
      edit(singleForm, (doc) => {
        (steps(doc)[1].selectors as Step).control = long;
      }),
      "invalid-selector",
      "loginSteps[1].selectors.control",
    );
    expectRejected(
      edit(singleForm, (doc) => {
        steps(doc)[0].waitFor = long;
      }),
      "invalid-selector",
      "loginSteps[0].waitFor",
    );
    for (const key of ["codeSelector", "submitSelector"])
      expectRejected(
        edit(crossOrigin, (doc) => {
          (doc.totpChallenges as Step[])[0][key] = long;
        }),
        "invalid-selector",
        `totpChallenges[0].${key}`,
      );
  });

  it("bounds frame names like the existing same-origin frame allowlist", () => {
    const withFrame = (frame: unknown) =>
      edit(preStepFrame, (doc) => {
        steps(doc)[1].frame = frame;
      });
    expect(issues(withFrame("a".repeat(128)))).toEqual([]);
    expect(issues(withFrame("frame_2-b"))).toEqual([]);
    for (const frame of [
      "a".repeat(129),
      "",
      "app.Frame",
      "app Frame",
      "*",
      "áppFrame",
      7,
      ["appFrame"],
    ])
      expectRejected(withFrame(frame), "invalid-frame", "loginSteps[1].frame");
  });

  it("accepts only safe exact paths and slash-terminated prefixes", () => {
    const withPaths = (key: string, value: unknown) =>
      edit(twoStep, (doc) => {
        steps(doc)[0][key] = value;
      });
    expect(issues(withPaths("paths", ["/", "/a/b.c", "/login/"]))).toEqual([]);
    expect(issues(withPaths("pathPrefixes", ["/realms/", "/a/b/"]))).toEqual(
      [],
    );
    for (const path of [
      "login",
      "/login?next=1",
      "/login#x",
      "/a/../b",
      "/./a",
      "/a//b",
      "/a b",
      "/%2e%2e/a",
      "/a\\b",
      "https://login.example.com/a",
      `/${"a".repeat(512)}`,
      7,
    ])
      expectRejected(withPaths("paths", [path]), "invalid-path");
    for (const prefix of ["/", "/realms", "realms/", "/a/../", "/a//", 7])
      expectRejected(
        withPaths("pathPrefixes", [prefix]),
        "invalid-path-prefix",
      );
    for (const key of ["paths", "pathPrefixes"]) {
      expectRejected(withPaths(key, []), "invalid-list");
      expectRejected(withPaths(key, "/signin"), "invalid-list");
      expectRejected(
        withPaths(
          key,
          Array.from(
            { length: HTTP_LOGIN_STEPS_LIMITS.paths + 1 },
            (_, index) => `/p${index}/`,
          ),
        ),
        "invalid-list",
      );
      expectRejected(withPaths(key, ["/a/", "/a/"]), "duplicate-entry");
    }
  });

  it("bounds the number of steps", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        doc.loginSteps = [];
      }),
      "invalid-list",
      "loginSteps",
    );
    expectRejected(
      edit(singleForm, (doc) => {
        doc.loginSteps = Array.from(
          { length: HTTP_LOGIN_STEPS_LIMITS.steps + 1 },
          () => ({ kind: "click", selectors: { control: "#a" } }),
        );
      }),
      "invalid-list",
      "loginSteps",
    );
  });
});

describe("login steps: unknown kinds and fields", () => {
  it.each(["type", "fill", "navigate", "script", "wait", "Form", "", 1, null])(
    "rejects the unknown step kind %j",
    (kind) => {
      expectRejected(
        edit(singleForm, (doc) => {
          steps(doc)[0].kind = kind;
        }),
        "invalid-kind",
        "loginSteps[0].kind",
      );
    },
  );

  it("rejects a step without a kind", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        delete steps(doc)[0].kind;
      }),
      "invalid-kind",
      "loginSteps[0].kind",
    );
  });

  it.each([
    ["top level", (doc: Doc) => (doc.loginFlow = "google"), "loginFlow"],
    [
      "top level",
      (doc: Doc) => (doc.hostedLoginUrl = "https://a.b/"),
      "hostedLoginUrl",
    ],
    [
      "evidence",
      (doc: Doc) => ((doc.evidence as Step).verified = true),
      "evidence.verified",
    ],
    [
      "step",
      (doc: Doc) => (steps(doc)[0].value = "admin"),
      "loginSteps[0].value",
    ],
    [
      "step",
      (doc: Doc) => (steps(doc)[0].script = "x()"),
      "loginSteps[0].script",
    ],
    [
      "step",
      (doc: Doc) => (steps(doc)[0].url = "https://a.b/"),
      "loginSteps[0].url",
    ],
    [
      "step",
      (doc: Doc) => (steps(doc)[0].frameOrigin = "https://a.b"),
      "loginSteps[0].frameOrigin",
    ],
    [
      "selectors",
      (doc: Doc) => ((steps(doc)[0].selectors as Step).submit = "#go"),
      "loginSteps[0].selectors.submit",
    ],
    [
      "form step",
      (doc: Doc) => ((steps(doc)[0].selectors as Step).control = "#go"),
      "loginSteps[0].selectors.control",
    ],
    [
      "form step",
      (doc: Doc) => (steps(doc)[0].submission = "enter"),
      "loginSteps[0].submission",
    ],
    [
      "submit step",
      (doc: Doc) => (steps(doc)[1].origin = "https://a.b"),
      "loginSteps[1].origin",
    ],
    [
      "submit step",
      (doc: Doc) => (steps(doc)[1].paths = ["/a"]),
      "loginSteps[1].paths",
    ],
    [
      "submit step",
      (doc: Doc) => (steps(doc)[1].frame = "appFrame"),
      "loginSteps[1].frame",
    ],
    [
      "submit step",
      (doc: Doc) => ((steps(doc)[1].selectors as Step).password = "#p"),
      "loginSteps[1].selectors.password",
    ],
  ])("rejects an unknown field in the %s (%#)", (_, change, path) => {
    expectRejected(edit(singleForm, change), "unknown-field", path);
  });

  it("rejects an own __proto__ key instead of treating it as inheritance", () => {
    const doc = JSON.parse(
      JSON.stringify(singleForm()).replace(
        '"version":1',
        '"version":1,"__proto__":{"passwordOnly":true}',
      ),
    );
    expectRejected(doc, "unknown-field", "__proto__");
  });

  it("rejects selectors that do not belong to the step kind", () => {
    const only = (kind: string, selectors: Step, extra: Step = {}) =>
      edit(singleForm, (doc) => {
        doc.loginSteps = [
          { kind, selectors, ...extra },
          ...(kind === "click"
            ? [{ kind: "form", selectors: { username: "#u", password: "#p" } }]
            : []),
        ];
      });
    expectRejected(
      only("identifier", { username: "#u", password: "#p" }),
      "unknown-field",
      "loginSteps[0].selectors.password",
    );
    expectRejected(
      only("identifier", {}),
      "missing-field",
      "loginSteps[0].selectors.username",
    );
    expectRejected(
      only("form", { username: "#u" }),
      "missing-field",
      "loginSteps[0].selectors.password",
    );
    expectRejected(
      only("click", { username: "#u" }),
      "unknown-field",
      "loginSteps[0].selectors.username",
    );
    expectRejected(
      only("click", {}),
      "missing-field",
      "loginSteps[0].selectors.control",
    );
    expectRejected(
      edit(singleForm, (doc) => {
        delete steps(doc)[0].selectors;
      }),
      "missing-field",
      "loginSteps[0].selectors",
    );
  });

  it("requires an explicit, known submission on every submit step", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        delete steps(doc)[1].submission;
      }),
      "invalid-submission",
      "loginSteps[1].submission",
    );
    for (const submission of ["post", "form", "auto", "Enter", 1, null])
      expectRejected(
        edit(singleForm, (doc) => {
          steps(doc)[1].submission = submission;
        }),
        "invalid-submission",
        "loginSteps[1].submission",
      );
    // Enter presses a key in the field just typed: it names no control.
    expectRejected(
      edit(singleForm, (doc) => {
        steps(doc)[1].submission = "enter";
      }),
      "unknown-field",
      "loginSteps[1].selectors",
    );
    for (const submission of ["click", "spa"])
      expectRejected(
        edit(passwordOnly, (doc) => {
          steps(doc)[1].submission = submission;
        }),
        "missing-field",
        "loginSteps[1].selectors",
      );
  });

  it.each([
    ["version 2", (doc: Doc) => (doc.version = 2), "invalid-version"],
    ["version as text", (doc: Doc) => (doc.version = "1"), "invalid-version"],
    ["no version", (doc: Doc) => delete doc.version, "invalid-version"],
    ["no id", (doc: Doc) => delete doc.id, "invalid-id"],
    ["id with a slash", (doc: Doc) => (doc.id = "../etc"), "invalid-id"],
    ["id too long", (doc: Doc) => (doc.id = "a".repeat(81)), "invalid-id"],
    [
      "foreign $schema",
      (doc: Doc) => (doc.$schema = "https://evil.example/s.json"),
      "invalid-schema-ref",
    ],
    [
      "passwordOnly as text",
      (doc: Doc) => (doc.passwordOnly = "true"),
      "invalid-type",
    ],
    ["no evidence", (doc: Doc) => delete doc.evidence, "missing-field"],
    [
      "class C",
      (doc: Doc) => ((doc.evidence as Step).class = "C"),
      "invalid-evidence",
    ],
    [
      "lower-case class",
      (doc: Doc) => ((doc.evidence as Step).class = "a"),
      "invalid-evidence",
    ],
    [
      "blank source",
      (doc: Doc) => ((doc.evidence as Step).source = " "),
      "invalid-evidence",
    ],
    [
      // The corpus keeps this equal to evidence.json's citation: no spaces.
      "source that is prose, not a citation",
      (doc: Doc) => ((doc.evidence as Step).source = "the vendor manual"),
      "invalid-evidence",
    ],
    [
      "no source",
      (doc: Doc) => delete (doc.evidence as Step).source,
      "missing-field",
    ],
    [
      "date-time",
      (doc: Doc) => ((doc.evidence as Step).reviewed = "2026-10-12T00:00:00Z"),
      "invalid-evidence",
    ],
    [
      "month 13",
      (doc: Doc) => ((doc.evidence as Step).reviewed = "2026-13-01"),
      "invalid-evidence",
    ],
    [
      "30 February",
      (doc: Doc) => ((doc.evidence as Step).reviewed = "2026-02-30"),
      "impossible-date",
    ],
    [
      "steps as object",
      (doc: Doc) => (doc.loginSteps = { 0: steps(doc)[0] }),
      "invalid-list",
    ],
    [
      "step as text",
      (doc: Doc) => (steps(doc)[0] = "form" as never),
      "not-an-object",
    ],
    [
      "selectors as array",
      (doc: Doc) => (steps(doc)[0].selectors = ["#u", "#p"]),
      "not-an-object",
    ],
  ])("rejects %s", (_, change, code) => {
    expectRejected(edit(singleForm, change), code as HttpLoginStepsIssueCode);
  });

  it.each([
    [null],
    [undefined],
    [1],
    ["steps"],
    [[]],
    [[singleForm()]],
    [new Map()],
  ])("rejects the non-object file %j", (value) => {
    expect(validateHttpLoginSteps(value)).toMatchObject({
      ok: false,
      issues: [{ code: "not-an-object", path: "" }],
    });
  });
});

describe("login steps: order and password-only", () => {
  it("rejects a password step before any identifier or form step", () => {
    expectRejected(
      edit(twoStep, (doc) => {
        doc.loginSteps = steps(doc).slice(2);
      }),
      "password-without-identifier",
      "loginSteps[0]",
    );
    expectRejected(
      edit(twoStep, (doc) => {
        const [identifier, next, password, signIn] = steps(doc);
        doc.loginSteps = [password, signIn, identifier, next];
      }),
      "password-without-identifier",
      "loginSteps[0]",
    );
    // passwordOnly must be the boolean true, not merely present.
    expectRejected(
      edit(passwordOnly, (doc) => {
        doc.passwordOnly = false;
      }),
      "password-without-identifier",
      "loginSteps[0]",
    );
  });

  it("accepts a password step after an identifier on another listed origin", () => {
    expect(issues(crossOrigin())).toEqual([]);
  });

  it("accepts a lone password step only with passwordOnly", () => {
    expect(issues(passwordOnly())).toEqual([]);
  });

  it("forbids typing a username anywhere in a passwordOnly file", () => {
    expectRejected(
      edit(passwordOnly, (doc) => {
        steps(doc).unshift({
          kind: "identifier",
          selectors: { username: "#u" },
        });
      }),
      "password-only-kind",
      "loginSteps[0].kind",
    );
    expectRejected(
      edit(singleForm, (doc) => {
        doc.passwordOnly = true;
      }),
      "password-only-kind",
      "loginSteps[0].kind",
    );
  });

  it("requires a passwordOnly file to type the password", () => {
    expectRejected(
      edit(passwordOnly, (doc) => {
        doc.loginSteps = [{ kind: "click", selectors: { control: "#a" } }];
      }),
      "no-credential-step",
      "loginSteps",
    );
  });

  it("rejects a file that types no credential at all", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        doc.loginSteps = [{ kind: "click", selectors: { control: "#a" } }];
      }),
      "no-credential-step",
      "loginSteps",
    );
  });

  it("accepts an identifier-only file (email assistance without a password)", () => {
    expect(
      issues(
        edit(twoStep, (doc) => {
          doc.loginSteps = steps(doc).slice(0, 2);
        }),
      ),
    ).toEqual([]);
  });
});

describe("login steps: one submit per origin", () => {
  const submit = () => ({
    kind: "submit",
    submission: "click",
    selectors: { control: "#go" },
  });

  it("rejects a second submit of the same form on one origin", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        steps(doc).push(submit());
      }),
      "submit-per-origin",
      "loginSteps[2]",
    );
  });

  it("rejects two password submits on one origin, with or without a second password step", () => {
    expectRejected(
      edit(twoStep, (doc) => {
        steps(doc).push({ kind: "submit", submission: "enter" });
      }),
      "submit-per-origin",
      "loginSteps[4]",
    );
    expectRejected(
      edit(passwordOnly, (doc) => {
        steps(doc).push(
          { kind: "password", selectors: { password: "#again" } },
          submit(),
        );
      }),
      "submit-per-origin",
      "loginSteps[3]",
    );
  });

  it("rejects two identifier submits on one origin", () => {
    expectRejected(
      edit(twoStep, (doc) => {
        steps(doc).splice(2, 0, submit());
      }),
      "submit-per-origin",
      "loginSteps[2]",
    );
  });

  it("accepts one identifier submit and one password submit on one origin", () => {
    expect(issues(twoStep())).toEqual([]);
  });

  it("accepts one submit of each stage on each of two origins", () => {
    expect(issues(crossOrigin())).toEqual([]);
  });

  it("counts submits per origin after the connection's origin is known", () => {
    const doc = edit(singleForm, (file) => {
      file.credentialOrigins = ["https://login.example.com"];
      steps(file).push(
        {
          kind: "form",
          origin: "https://login.example.com",
          selectors: { username: "#u", password: "#p" },
        },
        submit(),
      );
    });
    // Two origins in the file ...
    expect(issues(doc)).toEqual([]);
    expect(
      resolveHttpLoginSteps(doc, {
        connectionOrigin: "https://app.example.com",
      }),
    ).toMatchObject({ ok: true });
    // ... but one origin for a connection that IS the listed origin.
    const collapsed = resolveHttpLoginSteps(doc, {
      connectionOrigin: "https://login.example.com",
    });
    if (collapsed.ok) throw new Error("expected the collapsed file to fail");
    expect(collapsed.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "submit-per-origin",
        "duplicate-credential-step",
      ]),
    );
  });

  it("requires a submit to follow the step it submits immediately", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        doc.loginSteps = [submit(), ...steps(doc)];
      }),
      "submit-without-credential-step",
      "loginSteps[0]",
    );
    expectRejected(
      edit(singleForm, (doc) => {
        steps(doc).splice(1, 0, {
          kind: "click",
          selectors: { control: "#accept" },
        });
      }),
      "submit-not-adjacent",
      "loginSteps[2]",
    );
  });

  it("rejects a credential typed twice on one origin", () => {
    expectRejected(
      edit(singleForm, (doc) => {
        steps(doc).push({
          kind: "form",
          selectors: { username: "#u2", password: "#p2" },
        });
      }),
      "duplicate-credential-step",
      "loginSteps[2]",
    );
    expectRejected(
      edit(singleForm, (doc) => {
        steps(doc).push({ kind: "password", selectors: { password: "#p2" } });
      }),
      "duplicate-credential-step",
      "loginSteps[2]",
    );
    expectRejected(
      edit(twoStep, (doc) => {
        steps(doc).push({
          kind: "identifier",
          origin: "https://login.example.com",
          frame: "other",
          selectors: { username: "#u2" },
        });
      }),
      "duplicate-credential-step",
      "loginSteps[4]",
    );
  });

  it("allows a click only as a pre-step to a credential step on its origin", () => {
    expect(issues(preStepFrame())).toEqual([]);
    expect(
      issues(
        edit(twoStep, (doc) => {
          steps(doc).splice(2, 0, {
            kind: "click",
            origin: "https://login.example.com",
            selectors: { control: "#use-password" },
          });
        }),
      ),
    ).toEqual([]);
    // After the last credential step it would be post-login automation.
    expectRejected(
      edit(singleForm, (doc) => {
        steps(doc).push({ kind: "click", selectors: { control: "#menu" } });
      }),
      "click-without-credential-step",
      "loginSteps[2]",
    );
    // A click on one origin does not prepare a credential step on another.
    expectRejected(
      edit(twoStep, (doc) => {
        steps(doc).unshift({ kind: "click", selectors: { control: "#open" } });
      }),
      "click-without-credential-step",
      "loginSteps[0]",
    );
  });
});

describe("login steps: TOTP challenges", () => {
  const challenge = (doc: Doc) => (doc.totpChallenges as Step[])[0];

  it("stays assignable to the catalog's challenge type", () => {
    const toCatalog = (
      value: HttpLoginTotpChallenge,
    ): HttpApplicationTotpChallenge => value;
    const result = validateHttpLoginSteps(crossOrigin());
    if (!result.ok) throw new Error("expected a valid file");
    expect(toCatalog(result.value.totpChallenges![0]).id).toBe(
      "example-idp-totp",
    );
    expect(HTTP_LOGIN_TOTP_SUBMISSIONS).toEqual(["post", "spa"]);
  });

  it("rejects a challenge origin that is not a listed credential origin", () => {
    expectRejected(
      edit(crossOrigin, (doc) => {
        challenge(doc).origins = ["https://mfa.example.org"];
      }),
      "origin-not-listed",
      "totpChallenges[0].origins[0]",
    );
  });

  it.each([
    [
      "a provider-specific submission",
      (doc: Doc) => (challenge(doc).submission = "google"),
      "invalid-submission",
    ],
    [
      "an unknown field",
      (doc: Doc) => (challenge(doc).secret = "JBSWY3DPEHPK3PXP"),
      "unknown-field",
    ],
    [
      "a missing path gate",
      (doc: Doc) => delete challenge(doc).paths,
      "missing-field",
    ],
    [
      "an empty path gate",
      (doc: Doc) => (challenge(doc).paths = []),
      "invalid-list",
    ],
    [
      "an unsafe path",
      (doc: Doc) => (challenge(doc).paths = ["/a/../b"]),
      "invalid-path",
    ],
    [
      "an upper-case id",
      (doc: Doc) => (challenge(doc).id = "Example-TOTP"),
      "invalid-id",
    ],
    [
      "a blank label",
      (doc: Doc) => (challenge(doc).label = " "),
      "invalid-label",
    ],
    [
      "an empty origin list",
      (doc: Doc) => (challenge(doc).origins = []),
      "invalid-list",
    ],
    [
      "an HTTP origin",
      (doc: Doc) => (challenge(doc).origins = ["http://auth.example.net"]),
      "insecure-origin",
    ],
    [
      "an empty challenge list",
      (doc: Doc) => (doc.totpChallenges = []),
      "invalid-list",
    ],
    [
      "a duplicate challenge id",
      (doc: Doc) => (doc.totpChallenges as Step[]).push({ ...challenge(doc) }),
      "duplicate-totp-id",
    ],
  ])("rejects %s", (_, change, code) => {
    expectRejected(edit(crossOrigin, change), code as HttpLoginStepsIssueCode);
  });
});

describe("login steps: resolution for one connection", () => {
  it("fills in every origin and binds each submit to what it submits", () => {
    const result = resolveHttpLoginSteps(crossOrigin(), {
      connectionOrigin: "https://app.example.com",
    });
    if (!result.ok) throw new Error("expected a resolvable file");
    expect(
      result.value.steps.map((step) => [
        step.index,
        step.kind,
        step.origin,
        step.submits ?? null,
        step.submission ?? null,
      ]),
    ).toEqual([
      [0, "identifier", "https://app.example.com", null, null],
      [1, "submit", "https://app.example.com", "identifier", "spa"],
      [2, "identifier", "https://auth.example.net", null, null],
      [3, "submit", "https://auth.example.net", "identifier", "click"],
      [4, "password", "https://auth.example.net", null, null],
      [5, "submit", "https://auth.example.net", "password", "click"],
    ]);
    // A submit runs in its credential step's document: same gates, same frame.
    expect(result.value.steps[5]).toMatchObject({
      paths: [],
      pathPrefixes: ["/log-in/"],
      frame: null,
      waitFor: null,
      selectors: { control: 'button[type="submit"]' },
    });
    expect(result.value.steps[0]).toMatchObject({
      paths: ["/auth/login"],
      pathPrefixes: [],
      frame: null,
      waitFor: null,
      selectors: { username: 'input[name="email"]' },
    });
    // Only what runs where: file metadata (id, evidence) stays with the file.
    expect({ ...result.value, steps: undefined }).toEqual({
      passwordOnly: false,
      connectionOrigin: "https://app.example.com",
      credentialOrigins: [
        "https://app.example.com",
        "https://auth.example.net",
      ],
      totpOrigins: ["https://auth.example.net"],
      totpChallenges: [
        {
          id: "example-idp-totp",
          label: "Example authenticator code",
          codeSelector: 'form input[autocomplete="one-time-code"]',
          submitSelector: 'form button[type="submit"]',
          paths: ["/log-in/mfa"],
          submission: "post",
          origins: ["https://auth.example.net"],
        },
      ],
      crossOrigin: true,
      steps: undefined,
    });
  });

  /** One listed origin that only a challenge uses, and one challenge that
   * names no origin and so belongs to the connection's own. */
  const withCodeOnlyOrigin = (): Doc =>
    edit(singleForm, (file) => {
      file.credentialOrigins = ["https://mfa.example.net"];
      file.totpChallenges = [
        {
          id: "example-mfa",
          label: "Example authenticator code",
          codeSelector: "#code",
          submitSelector: "#verify",
          paths: ["/mfa"],
          submission: "post",
          origins: ["https://mfa.example.net"],
        },
        {
          id: "example-device-code",
          label: "Example device code",
          codeSelector: "#otp",
          submitSelector: "#ok",
          paths: ["/login/otp"],
          submission: "spa",
        },
      ];
    });

  it("lists code origins separately from username and password origins", () => {
    const doc = withCodeOnlyOrigin();
    expect(issues(doc)).toEqual([]);
    const result = resolveHttpLoginSteps(doc, {
      connectionOrigin: "https://app.example.com",
    });
    if (!result.ok) throw new Error("expected a resolvable file");
    const { credentialOrigins, totpOrigins, totpChallenges } = result.value;
    // The password allowlist does not grow by an origin that only takes a code.
    expect(credentialOrigins).toEqual(["https://app.example.com"]);
    expect(totpOrigins).toEqual([
      "https://mfa.example.net",
      "https://app.example.com",
    ]);
    expect(totpChallenges.map(({ id, origins }) => [id, origins])).toEqual([
      ["example-mfa", ["https://mfa.example.net"]],
      ["example-device-code", ["https://app.example.com"]],
    ]);
    // Steps decide whether a login is native-only; a challenge does not.
    expect(result.value.crossOrigin).toBe(false);
    // Nothing the file lists is missing from what the engine is told.
    for (const listed of doc.credentialOrigins as string[])
      expect([...credentialOrigins, ...totpOrigins]).toContain(listed);
  });

  it("accounts for every origin anything is typed on, in every example", () => {
    for (const make of Object.values(EXAMPLES)) {
      const doc = make();
      const result = resolveHttpLoginSteps(doc, {
        connectionOrigin: "https://app.example.com",
      });
      if (!result.ok) throw new Error("expected a resolvable example");
      const { credentialOrigins, totpOrigins, steps: resolved } = result.value;
      expect(new Set(resolved.map((step) => step.origin))).toEqual(
        new Set(credentialOrigins),
      );
      expect(
        new Set(result.value.totpChallenges.flatMap(({ origins }) => origins)),
      ).toEqual(new Set(totpOrigins));
      for (const listed of doc.credentialOrigins as string[])
        expect([...credentialOrigins, ...totpOrigins]).toContain(listed);
      if (!doc.totpChallenges) {
        expect(totpOrigins).toEqual([]);
        expect(result.value.totpChallenges).toEqual([]);
      }
    }
  });

  it("never offers a code origin over HTTP", () => {
    const result = resolveHttpLoginSteps(withCodeOnlyOrigin(), {
      connectionOrigin: "http://192.168.1.1",
      configuredHttpOrigin: "http://192.168.1.1",
    });
    if (!result.ok) throw new Error("expected a resolvable file");
    // The password login still resolves; the device's own challenge has no
    // origin left to run on, and the HTTPS one is untouched.
    expect(result.value.credentialOrigins).toEqual(["http://192.168.1.1"]);
    expect(result.value.totpOrigins).toEqual(["https://mfa.example.net"]);
    expect(
      result.value.totpChallenges.map(({ id, origins }) => [id, origins]),
    ).toEqual([
      ["example-mfa", ["https://mfa.example.net"]],
      ["example-device-code", []],
    ]);
  });

  it("never throws for a connection whose property reads throw", () => {
    const connection = Object.defineProperty({}, "connectionOrigin", {
      enumerable: true,
      get: () => {
        throw new Error("accessor");
      },
    }) as { connectionOrigin: string };
    expect(resolveHttpLoginSteps(singleForm(), connection)).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-connection-origin" }],
    });
  });

  it("keeps a same-origin file on the connection's origin only", () => {
    const result = resolveHttpLoginSteps(preStepFrame(), {
      connectionOrigin: "https://ilo.example.internal:8443",
    });
    if (!result.ok) throw new Error("expected a resolvable file");
    expect(result.value.crossOrigin).toBe(false);
    expect(result.value.credentialOrigins).toEqual([
      "https://ilo.example.internal:8443",
    ]);
    expect(result.value.steps.map((step) => step.frame)).toEqual([
      null,
      "appFrame",
      "appFrame",
    ]);
    expect(result.value.steps[2]).toMatchObject({
      submits: "form",
      submission: "enter",
      waitFor: null,
      selectors: {},
    });
  });

  it("omits the connection's origin from the allowlist when no step uses it", () => {
    const result = resolveHttpLoginSteps(twoStep(), {
      connectionOrigin: "https://portal.example.com",
    });
    if (!result.ok) throw new Error("expected a resolvable file");
    expect(result.value.credentialOrigins).toEqual([
      "https://login.example.com",
    ]);
    expect(result.value.crossOrigin).toBe(true);
  });

  it.each([
    "portal.example.com",
    "https://portal.example.com/",
    "https://portal.example.com/login",
    "https://user:pw@portal.example.com",
    "ftp://portal.example.com",
    "about:blank",
    "null",
    "",
    7,
    undefined,
  ])("refuses the connection origin %j", (connectionOrigin) => {
    expect(
      resolveHttpLoginSteps(singleForm(), {
        connectionOrigin: connectionOrigin as string,
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-connection-origin" }],
    });
  });

  it("accepts private, loopback and single-label connection origins", () => {
    for (const connectionOrigin of [
      "https://192.168.1.1",
      "https://[fd00::1]:8443",
      "https://localhost:3000",
      "https://nas",
    ])
      expect(
        resolveHttpLoginSteps(singleForm(), { connectionOrigin }),
      ).toMatchObject({ ok: true });
  });

  it("returns the file's own issues without resolving anything", () => {
    const result = resolveHttpLoginSteps(
      edit(twoStep, (doc) => {
        steps(doc)[0].origin = "https://evil.example.org";
      }),
      { connectionOrigin: "https://portal.example.com" },
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "origin-not-listed" }],
    });
  });
});

describe("login steps: a user-configured profile", () => {
  /** What the `custom` profile builds from the user's own fields. */
  const userSteps = (): Doc => ({
    loginSteps: [
      { kind: "click", selectors: { control: "#show-login" } },
      {
        kind: "form",
        frame: "loginFrame",
        selectors: { username: "#user", password: "#pass" },
      },
      { kind: "submit", submission: "click", selectors: { control: "#go" } },
    ],
  });
  const userIssues = (doc: unknown) => {
    const result = validateUserHttpLoginSteps(doc);
    return result.ok ? [] : result.issues.map((issue) => issue.code);
  };

  it("accepts steps with no evidence, id or origin list", () => {
    const result = validateUserHttpLoginSteps(userSteps());
    if (!result.ok) throw new Error("expected valid user steps");
    expect(Object.keys(result.value)).toEqual(["passwordOnly", "loginSteps"]);
    expect(result.value.passwordOnly).toBe(false);
    expect(result.value.loginSteps).toEqual(userSteps().loginSteps);
    expect(
      userIssues({
        passwordOnly: true,
        loginSteps: [
          { kind: "password", selectors: { password: "#pin" } },
          { kind: "submit", submission: "enter" },
        ],
      }),
    ).toEqual([]);
  });

  it("never lets a user-configured step name another origin", () => {
    expect(
      userIssues(
        edit(userSteps, (doc) => {
          steps(doc).shift();
          steps(doc)[0].origin = "https://login.example.com";
        }),
      ),
    ).toEqual(["origin-not-listed"]);
  });

  it.each([
    "version",
    "id",
    "evidence",
    "credentialOrigins",
    "totpChallenges",
    "$schema",
  ])("refuses the catalog-only field %s", (field) => {
    const source = twoStep() as Doc;
    expect(
      userIssues(
        edit(userSteps, (doc) => {
          doc[field] = field === "version" ? 1 : (source[field] ?? []);
        }),
      ),
    ).toEqual(["unknown-field"]);
  });

  it("applies the same step rules as a catalog file", () => {
    const broken: [string, (doc: Doc) => void][] = [
      ["invalid-kind", (doc) => (steps(doc)[0].kind = "script")],
      [
        "invalid-selector",
        (doc) => ((steps(doc)[1].selectors as Step).username = "a".repeat(513)),
      ],
      ["invalid-frame", (doc) => (steps(doc)[1].frame = "login.frame")],
      ["unknown-field", (doc) => (steps(doc)[1].value = "admin")],
      ["password-only-kind", (doc) => (doc.passwordOnly = true)],
      [
        "submit-per-origin",
        (doc) => steps(doc).push({ kind: "submit", submission: "enter" }),
      ],
      [
        "duplicate-credential-step",
        (doc) =>
          steps(doc).push({ kind: "password", selectors: { password: "#p2" } }),
      ],
      [
        "password-without-identifier",
        (doc) =>
          (doc.loginSteps = [
            { kind: "password", selectors: { password: "#pin" } },
          ]),
      ],
      ["invalid-list", (doc) => (doc.loginSteps = [])],
      ["missing-field", (doc) => delete doc.loginSteps],
    ];
    for (const [code, change] of broken)
      expect(userIssues(edit(userSteps, change)), code).toContain(code);
    for (const value of [null, [], "steps", 1])
      expect(userIssues(value)).toEqual(["not-an-object"]);
  });

  it("resolves onto the connection's own origin and nowhere else", () => {
    const result = resolveUserHttpLoginSteps(userSteps(), {
      connectionOrigin: "https://intranet.example.internal",
    });
    if (!result.ok) throw new Error("expected resolvable user steps");
    expect(result.value.crossOrigin).toBe(false);
    expect(result.value.credentialOrigins).toEqual([
      "https://intranet.example.internal",
    ]);
    // A user-configured profile has no challenge catalog.
    expect(result.value.totpOrigins).toEqual([]);
    expect(result.value.totpChallenges).toEqual([]);
    expect(
      result.value.steps.map((step) => [step.kind, step.origin, step.frame]),
    ).toEqual([
      ["click", "https://intranet.example.internal", null],
      ["form", "https://intranet.example.internal", "loginFrame"],
      ["submit", "https://intranet.example.internal", "loginFrame"],
    ]);
    // The HTTP rule is the same one.
    expect(
      resolveUserHttpLoginSteps(userSteps(), {
        connectionOrigin: "http://10.0.0.5",
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "insecure-connection-origin" }],
    });
    expect(
      resolveUserHttpLoginSteps(userSteps(), {
        connectionOrigin: "http://10.0.0.5",
        configuredHttpOrigin: "http://10.0.0.5",
      }),
    ).toMatchObject({ ok: true });
    expect(
      resolveUserHttpLoginSteps(
        edit(userSteps, (doc) => {
          steps(doc).shift();
          steps(doc)[0].origin = "https://login.example.com";
        }),
        { connectionOrigin: "https://login.example.com" },
      ),
    ).toMatchObject({ ok: false, issues: [{ code: "origin-not-listed" }] });
  });
});

describe("login steps: path gates", () => {
  it("matches exact paths exactly and prefixes on a segment boundary", () => {
    const vectors: [
      { paths?: string[]; pathPrefixes?: string[] },
      string,
      boolean,
    ][] = [
      [{}, "/anything/at/all", true],
      [{ paths: [], pathPrefixes: [] }, "/", true],
      [{ paths: ["/log-in"] }, "/log-in", true],
      [{ paths: ["/log-in"] }, "/log-in/password", false],
      [{ paths: ["/log-in"] }, "/log-in/", false],
      [{ paths: ["/log-in"] }, "/Log-in", false],
      [{ paths: ["/log-in"] }, "/log-in-help", false],
      [{ paths: ["/"] }, "/", true],
      [{ paths: ["/"] }, "/a", false],
      [{ paths: ["/login", "/login/"] }, "/login/", true],
      [{ pathPrefixes: ["/realms/"] }, "/realms/main/login", true],
      [{ pathPrefixes: ["/realms/"] }, "/realms/", true],
      [{ pathPrefixes: ["/realms/"] }, "/realms", false],
      [{ pathPrefixes: ["/realms/"] }, "/realmsx/main", false],
      [{ pathPrefixes: ["/realms/"] }, "/Realms/main", false],
      [{ paths: ["/sso"], pathPrefixes: ["/realms/"] }, "/sso", true],
      [{ paths: ["/sso"], pathPrefixes: ["/realms/"] }, "/realms/a", true],
      [{ paths: ["/sso"], pathPrefixes: ["/realms/"] }, "/other", false],
      [{ paths: ["/sso"] }, "sso", false],
      [{ paths: ["/sso"] }, "", false],
    ];
    for (const [step, pathname, expected] of vectors)
      expect(
        httpLoginStepMatchesPath(step, pathname),
        `${JSON.stringify(step)} at ${pathname}`,
      ).toBe(expected);
    expect(httpLoginStepMatchesPath({}, 7 as unknown as string)).toBe(false);
  });
});

/**
 * A deliberately small JSON Schema evaluator covering exactly the keywords the
 * published schema uses. No JSON-schema package is a declared dependency of
 * this repository, so the plain TypeScript validator is the implementation
 * and this evaluator proves the published schema says the same thing. An
 * unsupported keyword throws, so the schema cannot quietly depend on one.
 */
type SchemaNode = Record<string, unknown>;
const definitions = (schema as { $defs: Record<string, SchemaNode> }).$defs;
const ANNOTATIONS = new Set([
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "$defs",
]);
const jsonType = (value: unknown) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value === "number" && Number.isInteger(value)
        ? "integer"
        : typeof value;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  jsonType(value) === "object";
const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
function schemaAccepts(node: SchemaNode, value: unknown): boolean {
  return Object.entries(node).every(([keyword, argument]) => {
    if (ANNOTATIONS.has(keyword)) return true;
    const sub = argument as SchemaNode;
    const list = argument as SchemaNode[];
    switch (keyword) {
      case "$ref": {
        const name = /^#\/\$defs\/([A-Za-z]+)$/.exec(argument as string);
        if (!name || !definitions[name[1]])
          throw new Error(`unresolved $ref ${String(argument)}`);
        return schemaAccepts(definitions[name[1]], value);
      }
      case "type":
        return (
          jsonType(value) === argument ||
          (argument === "number" && jsonType(value) === "integer")
        );
      case "const":
        return value === argument;
      case "enum":
        return (argument as unknown[]).includes(value);
      case "required":
        return (
          !isRecord(value) ||
          (argument as string[]).every((key) => hasOwn(value, key))
        );
      case "properties":
        return (
          !isRecord(value) ||
          Object.entries(argument as Record<string, SchemaNode>).every(
            ([key, child]) =>
              !hasOwn(value, key) || schemaAccepts(child, value[key]),
          )
        );
      case "additionalProperties": {
        if (argument !== false)
          throw new Error("only additionalProperties:false is supported");
        const known = Object.keys((node.properties as SchemaNode) ?? {});
        return (
          !isRecord(value) ||
          Object.keys(value).every((key) => known.includes(key))
        );
      }
      case "items":
        return (
          !Array.isArray(value) ||
          value.every((entry) => schemaAccepts(sub, entry))
        );
      case "minItems":
        return !Array.isArray(value) || value.length >= (argument as number);
      case "maxItems":
        return !Array.isArray(value) || value.length <= (argument as number);
      case "uniqueItems":
        return (
          !Array.isArray(value) ||
          new Set(value.map((entry) => JSON.stringify(entry))).size ===
            value.length
        );
      // JSON Schema counts characters (code points), not UTF-16 units.
      case "minLength":
        return (
          typeof value !== "string" ||
          Array.from(value).length >= (argument as number)
        );
      case "maxLength":
        return (
          typeof value !== "string" ||
          Array.from(value).length <= (argument as number)
        );
      case "pattern": {
        if (typeof value !== "string") return true;
        // Validators differ on the unicode flag; the patterns must not care.
        const plain = new RegExp(argument as string).test(value);
        const unicode = new RegExp(argument as string, "u").test(value);
        if (plain !== unicode)
          throw new Error(`pattern depends on the u flag: ${String(argument)}`);
        return plain;
      }
      case "oneOf":
        return list.filter((child) => schemaAccepts(child, value)).length === 1;
      case "allOf":
        return list.every((child) => schemaAccepts(child, value));
      case "not":
        return !schemaAccepts(sub, value);
      case "if":
        return schemaAccepts(sub, value)
          ? schemaAccepts((node.then as SchemaNode) ?? {}, value)
          : schemaAccepts((node.else as SchemaNode) ?? {}, value);
      case "then":
      case "else":
        return true;
      default:
        throw new Error(`unsupported schema keyword ${keyword}`);
    }
  });
}

describe("login steps: the published JSON schema agrees with the validator", () => {
  const root = schema as unknown as SchemaNode;
  const validatorOnly = new Set<string>(HTTP_LOGIN_STEPS_VALIDATOR_ONLY_CODES);

  /** Every rejected file used above, rebuilt as one table. */
  const rejected: [string, Doc][] = [
    [
      "unlisted origin",
      edit(twoStep, (d) => (steps(d)[2].origin = "https://evil.example.org")),
    ],
    [
      "unused origin",
      edit(
        singleForm,
        (d) => (d.credentialOrigins = ["https://login.example.com"]),
      ),
    ],
    [
      "http origin",
      edit(
        twoStep,
        (d) => (d.credentialOrigins = ["http://login.example.com"]),
      ),
    ],
    [
      "default port",
      edit(
        twoStep,
        (d) => (d.credentialOrigins = ["https://login.example.com:443"]),
      ),
    ],
    [
      "port 65536",
      edit(
        twoStep,
        (d) => (d.credentialOrigins = ["https://login.example.com:65536"]),
      ),
    ],
    [
      "ip origin",
      edit(twoStep, (d) => (d.credentialOrigins = ["https://192.168.1.1"])),
    ],
    [
      "single-label origin",
      edit(twoStep, (d) => (d.credentialOrigins = ["https://intranet"])),
    ],
    [
      "upper-case origin",
      edit(
        twoStep,
        (d) => (d.credentialOrigins = ["https://LOGIN.example.com"]),
      ),
    ],
    [
      "origin with path",
      edit(
        twoStep,
        (d) => (d.credentialOrigins = ["https://login.example.com/"]),
      ),
    ],
    [
      "long label",
      edit(
        twoStep,
        (d) =>
          (d.credentialOrigins = [`https://${"a".repeat(64)}.example.com`]),
      ),
    ],
    [
      "duplicate origin",
      edit(
        twoStep,
        (d) =>
          (d.credentialOrigins = [
            "https://login.example.com",
            "https://login.example.com",
          ]),
      ),
    ],
    [
      "missing credentialOrigins",
      edit(singleForm, (d) => delete d.credentialOrigins),
    ],
    [
      "long selector",
      edit(
        singleForm,
        (d) => ((steps(d)[0].selectors as Step).username = "a".repeat(513)),
      ),
    ],
    [
      "control character",
      edit(
        singleForm,
        (d) => ((steps(d)[0].selectors as Step).username = "#a\nb"),
      ),
    ],
    [
      "C1 control",
      edit(
        singleForm,
        (d) => ((steps(d)[0].selectors as Step).username = "#a\u0085b"),
      ),
    ],
    [
      "padded selector",
      edit(
        singleForm,
        (d) => ((steps(d)[0].selectors as Step).username = " #a"),
      ),
    ],
    [
      "blank selector",
      edit(singleForm, (d) => ((steps(d)[0].selectors as Step).username = " ")),
    ],
    [
      "long waitFor",
      edit(singleForm, (d) => (steps(d)[0].waitFor = "a".repeat(513))),
    ],
    ["bad frame", edit(preStepFrame, (d) => (steps(d)[1].frame = "app.Frame"))],
    [
      "long frame",
      edit(preStepFrame, (d) => (steps(d)[1].frame = "a".repeat(129))),
    ],
    ["dot segment", edit(twoStep, (d) => (steps(d)[0].paths = ["/a/../b"]))],
    ["path with query", edit(twoStep, (d) => (steps(d)[0].paths = ["/a?b"]))],
    ["empty paths", edit(twoStep, (d) => (steps(d)[0].paths = []))],
    ["root prefix", edit(twoStep, (d) => (steps(d)[0].pathPrefixes = ["/"]))],
    [
      "open prefix",
      edit(twoStep, (d) => (steps(d)[0].pathPrefixes = ["/realms"])),
    ],
    ["unknown kind", edit(singleForm, (d) => (steps(d)[0].kind = "script"))],
    ["missing kind", edit(singleForm, (d) => delete steps(d)[0].kind)],
    [
      "unknown top-level field",
      edit(singleForm, (d) => (d.loginFlow = "google")),
    ],
    [
      "unknown step field",
      edit(singleForm, (d) => (steps(d)[0].value = "admin")),
    ],
    [
      "unknown selector",
      edit(singleForm, (d) => ((steps(d)[0].selectors as Step).submit = "#go")),
    ],
    [
      "scope on submit",
      edit(singleForm, (d) => (steps(d)[1].origin = "https://a.b")),
    ],
    [
      "submission on form",
      edit(singleForm, (d) => (steps(d)[0].submission = "enter")),
    ],
    [
      "enter with a control",
      edit(singleForm, (d) => (steps(d)[1].submission = "enter")),
    ],
    [
      "click without a control",
      edit(passwordOnly, (d) => (steps(d)[1].submission = "click")),
    ],
    [
      "missing submission",
      edit(singleForm, (d) => delete steps(d)[1].submission),
    ],
    [
      "unknown submission",
      edit(singleForm, (d) => (steps(d)[1].submission = "post")),
    ],
    ["version 2", edit(singleForm, (d) => (d.version = 2))],
    ["bad id", edit(singleForm, (d) => (d.id = "../etc"))],
    [
      "foreign $schema",
      edit(singleForm, (d) => (d.$schema = "https://evil.example/s.json")),
    ],
    [
      "passwordOnly as text",
      edit(singleForm, (d) => (d.passwordOnly = "true")),
    ],
    ["class C", edit(singleForm, (d) => ((d.evidence as Step).class = "C"))],
    [
      "bad date format",
      edit(singleForm, (d) => ((d.evidence as Step).reviewed = "12/10/2026")),
    ],
    [
      "source with a space",
      edit(singleForm, (d) => ((d.evidence as Step).source = "vendor manual")),
    ],
    [
      "30 February",
      edit(singleForm, (d) => ((d.evidence as Step).reviewed = "2026-02-30")),
    ],
    [
      "unknown evidence field",
      edit(singleForm, (d) => ((d.evidence as Step).verified = true)),
    ],
    ["no steps", edit(singleForm, (d) => (d.loginSteps = []))],
    [
      "17 steps",
      edit(
        singleForm,
        (d) => (d.loginSteps = Array.from({ length: 17 }, () => steps(d)[0])),
      ),
    ],
    ["step as text", edit(singleForm, (d) => (d.loginSteps = ["form"]))],
    [
      "password first",
      edit(twoStep, (d) => (d.loginSteps = steps(d).slice(2))),
    ],
    [
      "username in passwordOnly",
      edit(singleForm, (d) => (d.passwordOnly = true)),
    ],
    [
      "clicks only",
      edit(
        singleForm,
        (d) =>
          (d.loginSteps = [{ kind: "click", selectors: { control: "#a" } }]),
      ),
    ],
    [
      "two submits",
      edit(singleForm, (d) =>
        steps(d).push({ kind: "submit", submission: "enter" }),
      ),
    ],
    [
      "submit first",
      edit(singleForm, (d) => (d.loginSteps = [steps(d)[1], ...steps(d)])),
    ],
    ["two forms", edit(singleForm, (d) => steps(d).push({ ...steps(d)[0] }))],
    [
      "trailing click",
      edit(singleForm, (d) =>
        steps(d).push({ kind: "click", selectors: { control: "#a" } }),
      ),
    ],
    [
      "totp unlisted origin",
      edit(
        crossOrigin,
        (d) =>
          ((d.totpChallenges as Step[])[0].origins = [
            "https://mfa.example.org",
          ]),
      ),
    ],
    [
      "totp provider submission",
      edit(
        crossOrigin,
        (d) => ((d.totpChallenges as Step[])[0].submission = "google"),
      ),
    ],
    [
      "totp unknown field",
      edit(crossOrigin, (d) => ((d.totpChallenges as Step[])[0].secret = "x")),
    ],
    [
      "totp duplicate id",
      edit(crossOrigin, (d) =>
        (d.totpChallenges as Step[]).push({
          ...(d.totpChallenges as Step[])[0],
          label: "Second",
        }),
      ),
    ],
    ["totp empty list", edit(crossOrigin, (d) => (d.totpChallenges = []))],
  ];

  it("uses the house schema dialect and pins the same file version", () => {
    expect(root.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(root.$id).toBe("urn:sortofremoteng:http-login-steps:1");
    expect((root.properties as Record<string, SchemaNode>).version).toEqual({
      const: 1,
    });
    expect(
      (root.properties as Record<string, SchemaNode>).$schema,
    ).toMatchObject({ const: HTTP_LOGIN_STEPS_SCHEMA_REF });
    expect(HTTP_LOGIN_STEPS_SCHEMA_REF).toBe(
      "../../../types/connection/httpLoginSteps.schema.json",
    );
  });

  it("carries the same bounds and vocabularies as the validator", () => {
    const limits = HTTP_LOGIN_STEPS_LIMITS;
    const top = root.properties as Record<string, SchemaNode>;
    expect(definitions.selector.maxLength).toBe(limits.selectorLength);
    expect(definitions.origin.maxLength).toBe(limits.originLength);
    expect(definitions.path.maxLength).toBe(limits.pathLength);
    expect(definitions.pathPrefix.maxLength).toBe(limits.pathLength);
    expect(definitions.paths.maxItems).toBe(limits.paths);
    expect(definitions.pathPrefixes.maxItems).toBe(limits.paths);
    expect(top.loginSteps.maxItems).toBe(limits.steps);
    expect(top.credentialOrigins.maxItems).toBe(limits.credentialOrigins);
    expect(top.totpChallenges.maxItems).toBe(limits.totpChallenges);
    expect(top.id.maxLength).toBe(limits.idLength);
    expect(definitions.frame.pattern).toBe(
      `^[A-Za-z0-9_-]{1,${limits.frameLength}}$`,
    );
    const nested = (name: string) =>
      definitions[name].properties as Record<string, SchemaNode>;
    expect(nested("evidence").source.maxLength).toBe(limits.sourceLength);
    expect(nested("totpChallenge").label.maxLength).toBe(limits.labelLength);
    expect(nested("totpChallenge").origins.maxItems).toBe(
      limits.credentialOrigins,
    );
    const stepKinds = (definitions.step.oneOf as SchemaNode[]).map((entry) => {
      const name = /([A-Za-z]+)$/.exec(entry.$ref as string)![1];
      return (definitions[name].properties as Record<string, SchemaNode>).kind
        .const;
    });
    expect([...new Set(stepKinds)].sort()).toEqual(
      [...HTTP_LOGIN_STEP_KINDS].sort(),
    );
    const submission = (name: string) =>
      (definitions[name].properties as Record<string, SchemaNode>).submission;
    expect(
      [
        ...(submission("submitControlStep").enum as string[]),
        submission("submitEnterStep").const,
      ].sort(),
    ).toEqual([...HTTP_LOGIN_SUBMISSIONS].sort());
    expect(
      (definitions.evidence.properties as Record<string, SchemaNode>).class
        .enum,
    ).toEqual([...HTTP_LOGIN_EVIDENCE_CLASSES]);
    expect(
      (definitions.totpChallenge.properties as Record<string, SchemaNode>)
        .submission.enum,
    ).toEqual([...HTTP_LOGIN_TOTP_SUBMISSIONS]);
  });

  it.each(Object.entries(EXAMPLES))(
    "accepts the %s example, as the validator does",
    (_, make) => {
      expect(schemaAccepts(root, make())).toBe(true);
    },
  );

  it("accepts every file the validator normalizes", () => {
    for (const make of Object.values(EXAMPLES)) {
      const result = validateHttpLoginSteps(make());
      if (!result.ok) throw new Error("expected a valid example");
      expect(schemaAccepts(root, result.value)).toBe(true);
    }
  });

  it.each(rejected)(
    "rejects %s exactly when the validator reports a schema-level rule",
    (_, doc) => {
      const found = codes(doc);
      expect(found.length).toBeGreaterThan(0);
      const schemaLevel = found.filter((code) => !validatorOnly.has(code));
      expect({ found, accepted: schemaAccepts(root, doc) }).toEqual({
        found,
        accepted: schemaLevel.length === 0,
      });
    },
  );

  it.each([
    ...NON_PUBLIC_ORIGINS.map((origin) => [origin, false] as const),
    ...PUBLIC_LOOKALIKE_ORIGINS.map((origin) => [origin, true] as const),
    ...PUNYCODE_ORIGINS.map((origin) => [origin, true] as const),
  ])("agrees with the validator on the listed origin %s", (origin, ok) => {
    const doc = listedAt(origin);
    expect({
      validator: validateHttpLoginSteps(doc).ok,
      schema: schemaAccepts(root, doc),
    }).toEqual({ validator: ok, schema: ok });
  });

  it("names the same special-use suffixes as the validator", () => {
    const pattern = definitions.origin.pattern as string;
    const alternation = /\(\?:([a-z|]+)\)\(\?::\|\$\)\)/.exec(pattern);
    expect(alternation?.[1].split("|").sort()).toEqual(
      [...HTTP_LOGIN_NON_PUBLIC_SUFFIXES].sort(),
    );
    for (const suffix of HTTP_LOGIN_NON_PUBLIC_SUFFIXES) {
      expect(schemaAccepts(definitions.origin, `https://host.${suffix}`)).toBe(
        false,
      );
      expect(
        schemaAccepts(definitions.origin, `https://${suffix}.example.com`),
      ).toBe(true);
    }
  });

  it("pins every documented place where the schema is weaker than the validator", () => {
    // JSON Schema counts characters; the validator counts UTF-16 units, as
    // the engines do. One astral character is two units.
    const astral = (count: number) => "\u{1F512}".repeat(count);
    const totp = (doc: Doc) => (doc.totpChallenges as Step[])[0];
    const weaker: [string, Doc, HttpLoginStepsIssueCode, string][] = [
      [
        "selector length",
        edit(singleForm, (d) => {
          (steps(d)[0].selectors as Step).username = astral(257);
        }),
        "invalid-selector",
        "loginSteps[0].selectors.username",
      ],
      [
        "waitFor length",
        edit(singleForm, (d) => {
          steps(d)[0].waitFor = astral(257);
        }),
        "invalid-selector",
        "loginSteps[0].waitFor",
      ],
      [
        "challenge selector length",
        edit(crossOrigin, (d) => {
          totp(d).codeSelector = astral(257);
        }),
        "invalid-selector",
        "totpChallenges[0].codeSelector",
      ],
      [
        "evidence.source length",
        edit(singleForm, (d) => {
          (d.evidence as Step).source = astral(257);
        }),
        "invalid-evidence",
        "evidence.source",
      ],
      [
        "challenge label length",
        edit(crossOrigin, (d) => {
          totp(d).label = astral(61);
        }),
        "invalid-label",
        "totpChallenges[0].label",
      ],
      [
        "malformed punycode in an origin",
        listedAt("https://xn--a.com"),
        "invalid-origin",
        "credentialOrigins[0]",
      ],
    ];
    for (const [name, doc, code, path] of weaker) {
      expect(schemaAccepts(root, doc), name).toBe(true);
      expect(codes(doc), name).toEqual([code]);
      expect(
        issues(doc).map((issue) => issue.path),
        name,
      ).toContain(path);
    }
    // At the bound itself the two agree: 512 and 120 UTF-16 units.
    for (const doc of [
      edit(singleForm, (d) => {
        (steps(d)[0].selectors as Step).username = astral(256);
        (d.evidence as Step).source = astral(256);
      }),
      edit(crossOrigin, (d) => {
        totp(d).label = astral(60);
      }),
    ]) {
      expect(schemaAccepts(root, doc)).toBe(true);
      expect(issues(doc)).toEqual([]);
    }
    // The schema says so itself, for each of them.
    for (const phrase of [
      "UTF-16",
      "selector",
      "waitFor",
      "evidence.source",
      "label",
      "punycode",
    ])
      expect(root.description, phrase).toEqual(expect.stringContaining(phrase));
  });

  it("names the cross-field rules the schema cannot express", () => {
    expect([...HTTP_LOGIN_STEPS_VALIDATOR_ONLY_CODES].sort()).toEqual([
      "click-without-credential-step",
      "duplicate-credential-step",
      "duplicate-totp-id",
      "id-mismatch",
      "impossible-date",
      "insecure-connection-origin",
      "invalid-connection-origin",
      "no-credential-step",
      "origin-not-listed",
      "password-without-identifier",
      "submit-not-adjacent",
      "submit-per-origin",
      "submit-without-credential-step",
      "unused-credential-origin",
    ]);
    // Each one is exercised by a file the schema alone would let through.
    const seen = new Set(
      rejected
        .filter(([, doc]) => schemaAccepts(root, doc))
        .flatMap(([, doc]) => codes(doc)),
    );
    for (const code of [
      "origin-not-listed",
      "unused-credential-origin",
      "password-without-identifier",
      "submit-per-origin",
      "submit-without-credential-step",
      "duplicate-credential-step",
      "click-without-credential-step",
      "no-credential-step",
      "duplicate-totp-id",
      "impossible-date",
    ])
      expect(seen, code).toContain(code);
    expect(root.description).toEqual(expect.stringContaining("validator"));
  });
});

describe("login steps: the validator loads without a bundler", () => {
  it("imports under plain Node, so node:test suites and scripts can use it", () => {
    const validatorUrl = pathToFileURL(
      resolve(process.cwd(), "src/utils/connection/httpLoginSteps.ts"),
    ).href;
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { validateHttpLoginSteps } = await import(${JSON.stringify(validatorUrl)});
         const read = (text) => validateHttpLoginSteps(JSON.parse(text));
         const good = read(process.argv[1]);
         const bad = read(process.argv[2]);
         console.log(JSON.stringify([good.ok, bad.ok, bad.issues?.[0]?.code]));`,
        JSON.stringify(passwordOnly()),
        JSON.stringify(
          edit(twoStep, (doc) => {
            steps(doc)[0].origin = "https://evil.example.org";
          }),
        ),
      ],
      { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
    );
    expect(JSON.parse(output)).toEqual([true, false, "origin-not-listed"]);
  });

  // The capture tool decides which hosts it may load; this format decides
  // which hosts may be listed. Whatever the tool calls non-public must never
  // be listable. Skipped only where the tool is not checked out.
  const captureTool = resolve(process.cwd(), "scripts/capture-login-page.mjs");
  it.skipIf(!existsSync(captureTool))(
    "is at least as strict as the capture tool about non-public hosts",
    () => {
      const hosts = [
        ...NON_PUBLIC_ORIGINS,
        ...PUBLIC_LOOKALIKE_ORIGINS,
        ...PUNYCODE_ORIGINS,
        ...HTTP_LOGIN_NON_PUBLIC_SUFFIXES.map(
          (suffix) => `https://x.${suffix}`,
        ),
        "https://device.home.arpa",
        "https://login.example.com",
      ].map((origin) => origin.slice("https://".length).split(":")[0]);
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `const [validatorUrl, captureUrl, hosts] = process.argv.slice(1);
           const { validateHttpLoginSteps } = await import(validatorUrl);
           const { classifyHost } = await import(captureUrl);
           const file = (origin) => ({
             version: 1,
             id: "probe",
             evidence: { class: "A", source: "probe", reviewed: "2026-10-12" },
             credentialOrigins: [origin],
             loginSteps: [
               { kind: "form", origin, selectors: { username: "#u", password: "#p" } },
             ],
           });
           console.log(JSON.stringify(JSON.parse(hosts).map((host) => ({
             host,
             capture: classifyHost(host),
             listable: validateHttpLoginSteps(file("https://" + host)).ok,
           }))));`,
          pathToFileURL(
            resolve(process.cwd(), "src/utils/connection/httpLoginSteps.ts"),
          ).href,
          pathToFileURL(captureTool).href,
          JSON.stringify(hosts),
        ],
        { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
      );
      const rows = JSON.parse(output) as {
        host: string;
        capture: string;
        listable: boolean;
      }[];
      expect(rows.length).toBe(hosts.length);
      expect(
        rows.filter((row) => row.capture !== "public" && row.listable),
      ).toEqual([]);
      // Not vacuous: both sides agree that an ordinary name is public.
      expect(rows.find((row) => row.host === "login.example.com")).toEqual({
        host: "login.example.com",
        capture: "public",
        listable: true,
      });
    },
  );
});
