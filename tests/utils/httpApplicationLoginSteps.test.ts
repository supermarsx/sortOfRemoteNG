import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  HttpApplicationSettings,
} from "../../src/types/connection/connection";
import type { HttpLoginStepsFile } from "../../src/types/connection/httpLoginSteps";
import { validateUserHttpLoginSteps } from "../../src/utils/connection/httpLoginSteps";

const SUPPORT = "../../src/utils/connection/declarativeLoginSupport";
const REGISTRY = "../../src/utils/connection/httpLoginStepsRegistry";
const CATALOG = "../../src/utils/connection/httpApplicationProfiles";
const LOGIN = "../../src/utils/auth/httpApplicationLogin";

type Files = readonly (readonly [string, unknown])[];
type Flags = { native: boolean; legacy?: boolean };

/** The catalog is built when its module loads, so each state is a fresh load. */
async function load(flags: Flags, files?: Files) {
  vi.resetModules();
  vi.doMock(SUPPORT, () => ({
    DECLARATIVE_LOGIN_SUPPORTED: flags.native,
    DECLARATIVE_LOGIN_LEGACY_SUPPORTED: flags.legacy ?? false,
  }));
  if (files) vi.doMock(REGISTRY, () => ({ HTTP_LOGIN_STEPS_FILES: files }));
  const catalog = (await import(
    CATALOG
  )) as typeof import("../../src/utils/connection/httpApplicationProfiles");
  const login = (await import(
    LOGIN
  )) as typeof import("../../src/utils/auth/httpApplicationLogin");
  return { ...catalog, ...login };
}

afterEach(() => {
  vi.doUnmock(SUPPORT);
  vi.doUnmock(REGISTRY);
  vi.resetModules();
});

/** A single reviewed form on the connection's own origin. */
const steps = (
  id: string,
  patch: Partial<HttpLoginStepsFile> = {},
): HttpLoginStepsFile => ({
  version: 1,
  id,
  evidence: {
    class: "A",
    source: "https://source.example.test/login.html",
    reviewed: "2026-10-12",
  },
  credentialOrigins: [],
  loginSteps: [
    {
      kind: "form",
      selectors: { username: "#fixture-user", password: "#fixture-pass" },
    },
    {
      kind: "submit",
      submission: "click",
      selectors: { control: "#fixture-go" },
    },
  ],
  ...patch,
});

const connection = (
  id: string,
  loginMode: HttpApplicationSettings["loginMode"] = "form",
  patch: Partial<Connection> = {},
): Partial<Connection> => ({
  protocol: "https",
  hostname: "fixture.example.test",
  port: 443,
  username: "website-user",
  password: "fixture-password",
  httpApplication: { version: 1, id, loginMode },
  ...patch,
});

/** What a profile answers for one saved connection: a login or its refusal. */
const outcome = (run: () => unknown) => {
  try {
    return { login: run() };
  } catch (error) {
    return { refused: (error as Error).message };
  }
};

const MANUAL_ONLY_CLAIM =
  /manual sign-in only|interactive sign-in only|apenas manual|manual web login|saved (?:credentials|passwords)[^.]*are not supplied|não são preenchidos automaticamente|sign in interactively|intentionally (?:refuses|unavailable)|no application-specific browser sign-in|Generic email\/password form assistance|does not claim/i;

describe("declarative login steps in the application catalog", () => {
  it("reads every committed steps file and finds none it cannot use", async () => {
    const catalog = await load({ native: false });
    expect(catalog.HTTP_APPLICATION_LOGIN_STEPS_PROBLEMS).toEqual([]);
    for (const [id, file] of catalog.HTTP_APPLICATION_LOGIN_STEPS) {
      expect(file.id).toBe(id);
      expect(
        catalog.acceptsHttpLoginSteps(catalog.getHttpApplicationProfile(id)!),
      ).toBe(true);
    }
  });

  it("offers the form mode for a profile with steps only when the support flag is on", async () => {
    const files: Files = [["zulip", steps("zulip")]];
    const base = await load({ native: false }, []);
    const off = await load({ native: false }, files);
    const zulipOff = off.getHttpApplicationProfile("zulip")!;
    expect(off.HTTP_APPLICATION_LOGIN_STEPS.has("zulip")).toBe(true);
    expect(zulipOff).toEqual(base.getHttpApplicationProfile("zulip"));
    expect(zulipOff).not.toHaveProperty("declarativeLogin");
    expect(off.getHttpApplicationLoginModes(zulipOff)).toEqual(["manual"]);
    expect(
      off.normalizeHttpApplicationSettings({
        version: 1,
        id: "zulip",
        loginMode: "form",
      })?.invalid,
    ).toBe(true);
    expect(() => off.resolveHttpApplicationLogin(connection("zulip"))).toThrow(
      /invalid or unavailable/,
    );

    const on = await load({ native: true, legacy: true }, files);
    const zulipOn = on.getHttpApplicationProfile("zulip")!;
    expect(on.getHttpApplicationLoginModes(zulipOn)).toEqual([
      "manual",
      "form",
    ]);
    expect(zulipOn.loginModes).toEqual(["manual", "form"]);
    expect(zulipOn.capability).toBe("manual");
    expect(zulipOn.declarativeLogin).toEqual({
      ...steps("zulip"),
      passwordOnly: false,
    });
    expect(
      on.normalizeHttpApplicationSettings({
        version: 1,
        id: "zulip",
        loginMode: "form",
      }),
    ).toEqual({ version: 1, id: "zulip", loginMode: "form" });
    // Transport authentication is still not on offer for a former manual profile.
    expect(
      on.normalizeHttpApplicationSettings({
        version: 1,
        id: "zulip",
        loginMode: "basic",
      })?.invalid,
    ).toBe(true);
    // A profile without a steps file gains nothing from the flag.
    const lxd = on.getHttpApplicationProfile("lxd")!;
    expect(on.getHttpApplicationLoginModes(lxd)).toEqual(["manual"]);
    expect(lxd).toEqual(base.getHttpApplicationProfile("lxd"));
  });

  it("uses none of a steps file that fails the format, names an unknown profile, or targets a login that is automatic today", async () => {
    const files: Files = [
      ["zulip", steps("zulip")],
      // Unknown field: the validator rejects the whole file.
      ["grafana", { ...steps("grafana"), macro: "post-login" }],
      // The id inside does not match the registered name.
      ["netbox", steps("idrac")],
      ["not-a-profile", steps("not-a-profile")],
      // Reviewed form, staged adapter, user-configured, transport, native-only.
      ["portainer", steps("portainer")],
      ["synology-dsm", steps("synology-dsm")],
      ["adobe-admin-console", steps("adobe-admin-console")],
      ["generic-form", steps("generic-form")],
      ["custom", steps("custom")],
      ["http-basic", steps("http-basic")],
      ["mssql", steps("mssql")],
    ];
    const base = await load({ native: true, legacy: true }, []);
    const on = await load({ native: true, legacy: true }, files);
    expect([...on.HTTP_APPLICATION_LOGIN_STEPS.keys()]).toEqual(["zulip"]);
    expect(
      on.HTTP_APPLICATION_LOGIN_STEPS_PROBLEMS.map(({ id, problem }) => [
        id,
        problem.split(":")[0],
      ]),
    ).toEqual([
      ["grafana", "invalid-format"],
      ["netbox", "invalid-format"],
      ["not-a-profile", "unknown-profile"],
      ["portainer", "not-eligible"],
      ["synology-dsm", "not-eligible"],
      ["adobe-admin-console", "not-eligible"],
      ["generic-form", "not-eligible"],
      ["custom", "not-eligible"],
      ["http-basic", "not-eligible"],
      ["mssql", "not-eligible"],
    ]);
    // A problem names rule codes and fields, never text copied from the file.
    expect(
      on.HTTP_APPLICATION_LOGIN_STEPS_PROBLEMS.find(
        ({ id }) => id === "grafana",
      )?.problem,
    ).toBe("invalid-format: unknown-field at macro");
    for (const id of [
      "grafana",
      "netbox",
      "portainer",
      "synology-dsm",
      "adobe-admin-console",
      "generic-form",
      "custom",
      "http-basic",
      "mssql",
    ])
      expect(on.getHttpApplicationProfile(id)).toEqual(
        base.getHttpApplicationProfile(id),
      );
  });

  it("refuses a hosted profile's steps that break the per-origin rules once its own origin is known", async () => {
    // github.com/login is not eligible (automatic today); namecheap is hosted
    // and manual. Listing its own origin types the password twice there.
    const hostedOrigin = "https://www.namecheap.com";
    const on = await load({ native: true }, [
      [
        "namecheap",
        steps("namecheap", {
          credentialOrigins: [hostedOrigin],
          loginSteps: [
            {
              kind: "form",
              selectors: { username: "#user", password: "#pass" },
            },
            {
              kind: "password",
              origin: hostedOrigin,
              selectors: { password: "#again" },
            },
          ],
        }),
      ],
    ]);
    expect(on.HTTP_APPLICATION_LOGIN_STEPS.size).toBe(0);
    expect(on.HTTP_APPLICATION_LOGIN_STEPS_PROBLEMS).toEqual([
      {
        id: "namecheap",
        problem:
          "invalid-for-hosted-origin: duplicate-credential-step at loginSteps[1]",
      },
    ]);
    expect(
      on.getHttpApplicationLoginModes(
        on.getHttpApplicationProfile("namecheap")!,
      ),
    ).toEqual(["manual"]);
  });

  it("keeps every existing profile exactly as it is while the flag is off, whatever steps exist", async () => {
    const base = await load({ native: false }, []);
    const eligible = base.HTTP_APPLICATION_PROFILES.filter(
      base.acceptsHttpLoginSteps,
    );
    // 57 manual profiles and the 14 named applications on the generic heuristic.
    expect(eligible).toHaveLength(71);
    const off = await load(
      { native: false },
      eligible.map(({ id }) => [id, steps(id)] as const),
    );
    expect(off.HTTP_APPLICATION_LOGIN_STEPS.size).toBe(71);
    expect(off.HTTP_APPLICATION_LOGIN_STEPS_PROBLEMS).toEqual([]);
    expect(off.HTTP_APPLICATION_PROFILES).toEqual(
      base.HTTP_APPLICATION_PROFILES,
    );
    for (const profile of off.HTTP_APPLICATION_PROFILES) {
      expect(off.getHttpApplicationLoginModes(profile)).toEqual(
        base.getHttpApplicationLoginModes(
          base.getHttpApplicationProfile(profile.id)!,
        ),
      );
      for (const loginMode of ["manual", "form", "basic", "digest"] as const)
        expect(
          outcome(() =>
            off.resolveHttpApplicationLogin(connection(profile.id, loginMode)),
          ),
        ).toEqual(
          outcome(() =>
            base.resolveHttpApplicationLogin(connection(profile.id, loginMode)),
          ),
        );
    }
  });

  it("never changes an application that is automatic today, even with the flags on and a steps file for everything else", async () => {
    const base = await load({ native: false }, []);
    const eligible = base.HTTP_APPLICATION_PROFILES.filter(
      base.acceptsHttpLoginSteps,
    );
    const on = await load(
      { native: true, legacy: true },
      eligible.map(({ id }) => [id, steps(id)] as const),
    );
    const untouched = base.HTTP_APPLICATION_PROFILES.filter(
      (profile) => !base.acceptsHttpLoginSteps(profile),
    );
    // 65 reviewed automatic logins including Drone CI and TP-Link EAP, the 2 user-configured profiles, the 7
    // transport-authentication profiles and the 8 native-only entries.
    expect(untouched).toHaveLength(82);
    expect(
      untouched.filter(
        ({ capability }) =>
          capability === "known-form" || capability === "custom-form",
      ),
    ).toHaveLength(66);
    for (const profile of untouched) {
      const current = on.getHttpApplicationProfile(profile.id)!;
      expect(current).toEqual(profile);
      expect(current).not.toHaveProperty("declarativeLogin");
      expect(on.getHttpApplicationLoginModes(current)).toEqual(
        base.getHttpApplicationLoginModes(profile),
      );
      for (const loginMode of ["manual", "form", "basic", "digest"] as const)
        for (const patch of [
          {},
          { httpAutoLoginSelectors: { usernameSelector: "#override" } },
          {
            httpAutoLoginSelectors: {
              usernameSelector: "#u",
              passwordSelector: "#p",
              submitSelector: "#s",
            },
          },
        ])
          expect(
            outcome(() =>
              on.resolveHttpApplicationLogin(
                connection(profile.id, loginMode, patch),
              ),
            ),
          ).toEqual(
            outcome(() =>
              base.resolveHttpApplicationLogin(
                connection(profile.id, loginMode, patch),
              ),
            ),
          );
    }
    // The eight staged adapters keep their own flow and upstream mode.
    expect(
      untouched
        .filter(({ loginFlow }) => loginFlow)
        .map(({ loginFlow }) => loginFlow)
        .filter((flow, index, all) => all.indexOf(flow) === index)
        .sort(),
    ).toEqual([
      "adobe",
      "bitwarden",
      "chatgpt",
      "claude",
      "cloudflare",
      "google",
      "synology",
      "yealink",
    ]);
  });

  it("changes only the sign-in fields of a profile whose steps are active", async () => {
    const base = await load({ native: false }, []);
    const eligible = base.HTTP_APPLICATION_PROFILES.filter(
      base.acceptsHttpLoginSteps,
    );
    const on = await load(
      { native: true, legacy: true },
      eligible.map(({ id }) => [id, steps(id)] as const),
    );
    const modes = { additive: 0, exclusive: 0 };
    for (const profile of eligible) {
      const active = on.getHttpApplicationProfile(profile.id)!;
      const {
        declarativeLogin,
        declarativeLoginMode,
        description,
        loginModes,
        ...rest
      } = active;
      const {
        description: baseDescription,
        loginModes: baseModes,
        ...baseRest
      } = profile;
      expect(rest).toEqual(baseRest);
      expect(declarativeLogin?.id).toBe(profile.id);
      expect(declarativeLoginMode).toBe(on.getHttpLoginStepsMode(profile));
      modes[declarativeLoginMode!]++;
      if (profile.capability === "manual") {
        // No automatic login before: the steps are all that may type.
        expect(declarativeLoginMode).toBe("exclusive");
        expect(description).not.toBe(baseDescription);
        expect(loginModes).toEqual(["manual", "form"]);
        expect(on.getHttpApplicationLoginModes(active)).toEqual([
          "manual",
          "form",
        ]);
      } else {
        // Automatic today: nothing it says or offers changes.
        expect(declarativeLoginMode).toBe("additive");
        expect(description).toBe(baseDescription);
        expect(loginModes).toEqual(baseModes);
        expect(on.getHttpApplicationLoginModes(active)).toEqual(
          base.getHttpApplicationLoginModes(profile),
        );
      }
    }
    expect(modes).toEqual({ additive: 14, exclusive: 57 });
  });

  it("only adds coverage to an application that signs in automatically today: iLO keeps what it does and its steps are additive", async () => {
    const frameSteps = steps("ilo", {
      loginSteps: [
        {
          kind: "form",
          frame: "appFrame",
          selectors: {
            username: "input#usernameInput",
            password: "input#passwordInput",
          },
        },
        { kind: "submit", submission: "enter" },
      ],
    });
    const base = await load({ native: false }, []);
    const before = base.getHttpApplicationProfile("ilo")!;
    for (const legacy of [false, true]) {
      const on = await load({ native: true, legacy }, [["ilo", frameSteps]]);
      const ilo = on.getHttpApplicationProfile("ilo")!;
      // What it already does is described, offered and scoped as before.
      expect(ilo.capability).toBe("generic-form");
      expect(ilo.description).toBe(before.description);
      expect(ilo.description).toBe(
        "Use the iLO web account. Native login detects the main page or its same-origin appFrame iframe. Form detection is firmware-dependent; Redfish/RIBCL session tokens do not sign into the browser. MFA remains manual.",
      );
      expect(ilo.sameOriginLoginFrames).toEqual(["appFrame"]);
      expect(on.getHttpApplicationLoginModes(ilo)).toEqual(
        base.getHttpApplicationLoginModes(before),
      );
      const { declarativeLogin, declarativeLoginMode, ...rest } = ilo;
      expect(rest).toEqual(before);
      // The steps know the frame layout only, so they are marked additive.
      expect(declarativeLoginMode).toBe("additive");
      expect(declarativeLogin).toEqual({ ...frameSteps, passwordOnly: false });

      // The login this connection resolved to before is still what it
      // resolves to; the steps ride on it and never stand in for it.
      const today = base.resolveHttpApplicationLogin(connection("ilo"));
      const login = on.resolveHttpApplicationLogin(connection("ilo"));
      const { declarativeLogin: offered, ...unchanged } = login;
      expect(unchanged).toEqual(today);
      expect(offered).toEqual(
        legacy
          ? {
              source: "catalog",
              mode: "additive",
              steps: { ...frameSteps, passwordOnly: false },
            }
          : undefined,
      );
      for (const loginMode of ["manual", "basic", "digest"] as const)
        expect(
          on.resolveHttpApplicationLogin(connection("ilo", loginMode)),
        ).toEqual(
          base.resolveHttpApplicationLogin(connection("ilo", loginMode)),
        );
    }
  });

  it("leaves a profile without a steps file exactly as it is, with the flags on", async () => {
    const base = await load({ native: false }, []);
    const withSteps = ["zulip", "ilo", "namecheap"];
    const on = await load(
      { native: true, legacy: true },
      withSteps.map((id) => [id, steps(id)] as const),
    );
    expect(on.HTTP_APPLICATION_PROFILES).toHaveLength(
      base.HTTP_APPLICATION_PROFILES.length,
    );
    for (const profile of base.HTTP_APPLICATION_PROFILES) {
      if (withSteps.includes(profile.id)) continue;
      const current = on.getHttpApplicationProfile(profile.id)!;
      expect(current, profile.id).toEqual(profile);
      expect(current).not.toHaveProperty("declarativeLogin");
      expect(current).not.toHaveProperty("declarativeLoginMode");
      expect(on.getHttpLoginStepsEntryPage(current)).toBeUndefined();
      expect(on.getHttpApplicationLoginModes(current)).toEqual(
        base.getHttpApplicationLoginModes(profile),
      );
      for (const loginMode of ["manual", "form", "basic", "digest"] as const)
        expect(
          outcome(() =>
            on.resolveHttpApplicationLogin(connection(profile.id, loginMode)),
          ),
          profile.id,
        ).toEqual(
          outcome(() =>
            base.resolveHttpApplicationLogin(connection(profile.id, loginMode)),
          ),
        );
    }
  });

  it("says where the login starts when no step can run on the page the connection opens", async () => {
    const acesso = "https://www.acesso.gov.pt";
    const on = await load({ native: true }, [
      // The form is on another, listed origin, reached from the portal home.
      [
        "autoridade-tributaria",
        steps("autoridade-tributaria", {
          credentialOrigins: [acesso],
          loginSteps: [
            {
              kind: "click",
              origin: acesso,
              paths: ["/v2/loginForm"],
              selectors: { control: "#tab" },
            },
            {
              kind: "form",
              origin: acesso,
              paths: ["/v2/loginForm"],
              selectors: { username: "#user", password: "#pass" },
            },
            { kind: "submit", submission: "enter" },
          ],
        }),
      ],
      // Same origin, another page than the hosted address.
      [
        "seguranca-social-direta",
        steps("seguranca-social-direta", {
          loginSteps: [
            {
              kind: "form",
              paths: ["/sso/login"],
              selectors: { username: "#user", password: "#pass" },
            },
          ],
        }),
      ],
      // The hosted address is the form's own page.
      [
        "namecheap",
        steps("namecheap", {
          loginSteps: [
            {
              kind: "form",
              paths: ["/myaccount/login/"],
              selectors: { username: "#user", password: "#pass" },
            },
          ],
        }),
      ],
      // No path gate: runs wherever the connection opens.
      ["contabo", steps("contabo")],
      // Self-hosted with a login path the gate matches, and one without any
      // known opening page.
      [
        "zulip",
        steps("zulip", {
          loginSteps: [
            {
              kind: "form",
              paths: ["/login/"],
              selectors: { username: "#user", password: "#pass" },
            },
          ],
        }),
      ],
      [
        "netbox",
        steps("netbox", {
          loginSteps: [
            {
              kind: "form",
              paths: ["/login/"],
              selectors: { username: "#user", password: "#pass" },
            },
          ],
        }),
      ],
    ]);
    expect(on.HTTP_APPLICATION_LOGIN_STEPS_PROBLEMS).toEqual([]);
    const entry = (id: string) =>
      on.getHttpLoginStepsEntryPage(on.getHttpApplicationProfile(id)!);
    expect(entry("autoridade-tributaria")).toBe(
      "www.acesso.gov.pt/v2/loginForm",
    );
    expect(entry("seguranca-social-direta")).toBe("/sso/login");
    expect(entry("namecheap")).toBeUndefined();
    expect(entry("contabo")).toBeUndefined();
    expect(entry("zulip")).toBeUndefined();
    expect(entry("netbox")).toBeUndefined();
    // The catalog address itself is never changed by a steps file.
    expect(
      on.getHttpApplicationProfile("autoridade-tributaria")!.hostedLoginUrl,
    ).toBe("https://www.portaldasfinancas.gov.pt/at/html/index.html");
    expect(
      on.getHttpApplicationProfile("seguranca-social-direta")!.hostedLoginUrl,
    ).toBe("https://www.seg-social.pt/ptss/");
  });

  it("stops describing a profile as manual-only once its steps are active", async () => {
    const base = await load({ native: false }, []);
    const eligible = base.HTTP_APPLICATION_PROFILES.filter(
      base.acceptsHttpLoginSteps,
    );
    const on = await load(
      { native: true },
      eligible.map(({ id }) => [id, steps(id)] as const),
    );
    // Every sentence of the table is one a description really contains.
    const { HTTP_APPLICATION_SIGN_IN_NOTES } =
      await import("../../src/utils/connection/httpApplicationLoginSteps");
    const manual = eligible.filter(({ capability }) => capability === "manual");
    for (const [manualOnly, withLoginSteps] of HTTP_APPLICATION_SIGN_IN_NOTES) {
      expect(
        manual.filter(({ description }) => description.includes(manualOnly))
          .length,
        manualOnly,
      ).toBeGreaterThan(0);
      expect(withLoginSteps).not.toMatch(MANUAL_ONLY_CLAIM);
    }
    // These class C applications have no sentence of their own: the general
    // one is appended, should a steps file ever arrive for them. (Drone CI
    // left class C: it signs in through its saved Git provider.)
    const appended = ["eaton-ups", "lxd"];
    for (const profile of on.HTTP_APPLICATION_PROFILES) {
      if (appended.includes(profile.id))
        expect(profile.description).toBe(
          `${base.getHttpApplicationProfile(profile.id)!.description} Optional automatic sign-in types the saved username and password into the site's own sign-in pages, following the login steps recorded for this application, and stops at CAPTCHA, device approval, passkeys, SMS codes, security keys and any page it does not recognize. API keys are not website passwords.`,
        );
      // An additive profile keeps its description: generic detection is still
      // what it does wherever its steps do not apply.
      if (profile.declarativeLoginMode !== "exclusive") {
        expect(profile.description, profile.id).toBe(
          base.getHttpApplicationProfile(profile.id)!.description,
        );
        continue;
      }
      expect(profile.description, profile.id).not.toMatch(MANUAL_ONLY_CLAIM);
      expect(profile.description, profile.id).toMatch(
        /login steps recorded|passos de início de sessão registados/,
      );
      // Never a claim that a guess was verified.
      expect(profile.description, profile.id).not.toMatch(
        /\bverified login|\breviewed login steps|live-verified sign-in works/i,
      );
    }
    expect(
      on.HTTP_APPLICATION_PROFILES.filter((profile) => profile.declarativeLogin)
        .length,
    ).toBe(71);
    // The exact wording for one profile of each shared sentence.
    expect(on.getHttpApplicationProfile("namecheap")!.description).toBe(
      "Domain registrar account dashboard, not a hosted website's control-panel account. Optional automatic sign-in types the saved username and password into the site's own sign-in pages, following the login steps recorded for this application, and stops at CAPTCHA, device approval, passkeys, SMS codes, security keys and any page it does not recognize. API keys are not website passwords. Use Open original sign-in for SSO or unsupported embedded-browser sign-in. The system browser has separate cookies and uses the operating system network route.",
    );
    expect(on.getHttpApplicationProfile("idrac")!.description).toBe(
      "Optional generic login-form detection; no application-specific browser sign-in has been verified.",
    );
    expect(
      on.getHttpApplicationProfile("autoridade-tributaria")!.description,
    ).toBe(
      "Entrada oficial do Portal das Finanças. Escolha Iniciar Sessão ou o serviço pretendido no portal; a disponibilidade do destino de autenticação depende da AT. Início de sessão automático opcional: o nome de utilizador e a palavra-passe guardados são escritos nas páginas de início de sessão do próprio portal, seguindo os passos de início de sessão registados para esta aplicação. CAPTCHA, códigos SMS, autenticação federada, Chave Móvel Digital, Cartão de Cidadão e páginas não reconhecidas ficam a cargo do utilizador.",
    );
  });

  it("has a truthful description for every committed steps file once the flag is on", async () => {
    const on = await load({ native: true });
    for (const profile of on.HTTP_APPLICATION_PROFILES) {
      if (profile.declarativeLoginMode !== "exclusive") continue;
      expect(profile.description, profile.id).not.toMatch(MANUAL_ONLY_CLAIM);
    }
  });

  it("adds a steps file's authenticator challenges to the profile only while its steps are active", async () => {
    const totpChallenges = [
      {
        id: "zulip-totp",
        label: "Zulip authenticator code",
        codeSelector: "#otp",
        submitSelector: "#otp-go",
        paths: ["/accounts/login/"],
        submission: "post" as const,
      },
    ];
    const files: Files = [["zulip", steps("zulip", { totpChallenges })]];
    const off = await load({ native: false }, files);
    expect(off.getHttpApplicationProfile("zulip")!.totpChallenges).toBe(
      undefined,
    );
    const on = await load({ native: true }, files);
    expect(on.getHttpApplicationProfile("zulip")!.totpChallenges).toEqual(
      totpChallenges,
    );
  });
});

describe("resolving a steps-based login for the legacy engine", () => {
  const files: Files = [
    ["zulip", steps("zulip")],
    ["idrac", steps("idrac")],
  ];
  const noLogin = {
    credentials: null,
    upstreamAuthMode: "none",
    autoLogin: false,
  };

  it("hands the validated steps to the engine: exclusive where no login existed, additive on top of the login that did", async () => {
    const base = await load({ native: false }, []);
    const on = await load({ native: true, legacy: true }, files);
    for (const [id, mode] of [
      ["zulip", "exclusive"],
      ["idrac", "additive"],
    ] as const) {
      const login = on.resolveHttpApplicationLogin(connection(id));
      expect(login).toEqual({
        credentials: { username: "website-user", password: "fixture-password" },
        upstreamAuthMode: "none",
        autoLogin: true,
        declarativeLogin: {
          source: "catalog",
          mode,
          steps: { ...steps(id), passwordOnly: false },
        },
      });
      // Exclusive steps carry no selectors for form detection to guess with.
      // Additive steps leave the earlier login as it was, key for key.
      expect(login).not.toHaveProperty("selectors");
      if (mode === "additive") {
        const { declarativeLogin: _steps, ...earlier } = login;
        expect(earlier).toEqual(
          base.resolveHttpApplicationLogin(connection(id)),
        );
      }
      expect(on.resolveHttpApplicationLogin(connection(id, "manual"))).toEqual(
        noLogin,
      );
      // The reference resolution for the engine: one origin, the connection's own.
      const resolved = on.resolveHttpApplicationLoginSteps(login, {
        connectionOrigin: "https://fixture.example.test",
      });
      expect(resolved).toMatchObject({
        ok: true,
        value: {
          crossOrigin: false,
          credentialOrigins: ["https://fixture.example.test"],
        },
      });
    }
    expect(
      on.resolveHttpApplicationLoginSteps(
        on.resolveHttpApplicationLogin(connection("zulip", "manual")),
        { connectionOrigin: "https://fixture.example.test" },
      ),
    ).toBeUndefined();
  });

  it("refuses a former manual profile in the legacy engine until that engine runs steps, and keeps the generic heuristic where it ran before", async () => {
    const base = await load({ native: false }, []);
    const nativeOnly = await load({ native: true, legacy: false }, files);
    expect(() =>
      nativeOnly.resolveHttpApplicationLogin(connection("zulip")),
    ).toThrow(
      "Automatic login for Zulip (organization / self-hosted) needs the native browser engine in this build. Review the browser engine in Settings → Web Browser, or use manual login.",
    );
    expect(
      nativeOnly.resolveHttpApplicationLogin(connection("zulip", "manual")),
    ).toEqual(noLogin);
    // iDRAC was on the generic heuristic: its saved connections keep it.
    expect(nativeOnly.resolveHttpApplicationLogin(connection("idrac"))).toEqual(
      base.resolveHttpApplicationLogin(connection("idrac")),
    );
    expect(
      nativeOnly.resolveHttpApplicationLogin(connection("idrac")),
    ).not.toHaveProperty("declarativeLogin");
  });

  it("keeps a saved selector override on the single-form login it always meant, and refuses one where no such login existed", async () => {
    const base = await load({ native: false }, []);
    const on = await load({ native: true, legacy: true }, files);
    const overridden = {
      httpAutoLoginSelectors: { passwordSelector: "#firmware-specific" },
    };
    const kept = on.resolveHttpApplicationLogin(
      connection("idrac", "form", overridden),
    );
    expect(kept).toEqual(
      base.resolveHttpApplicationLogin(connection("idrac", "form", overridden)),
    );
    expect(kept).not.toHaveProperty("declarativeLogin");
    expect(kept.selectors).toEqual({ passwordSelector: "#firmware-specific" });
    expect(() =>
      on.resolveHttpApplicationLogin(connection("zulip", "form", overridden)),
    ).toThrow(
      "The login steps for Zulip (organization / self-hosted) do not accept selector overrides. Clear Advanced selectors, or choose Custom application to use your own selectors.",
    );
  });

  it("needs only the password for a password-only device", async () => {
    const passwordOnly = steps("draytek", {
      passwordOnly: true,
      loginSteps: [
        { kind: "password", selectors: { password: "#pw" } },
        { kind: "submit", submission: "enter" },
      ],
    });
    const on = await load({ native: true, legacy: true }, [
      ["draytek", passwordOnly],
      ["idrac", steps("idrac")],
    ]);
    // Form detection needs a username, so without one there is no earlier
    // login to fall back to and the steps alone may type.
    expect(
      on.resolveHttpApplicationLogin(
        connection("draytek", "form", { username: "" }),
      ),
    ).toMatchObject({
      credentials: { username: "", password: "fixture-password" },
      autoLogin: true,
      declarativeLogin: {
        source: "catalog",
        mode: "exclusive",
        steps: { passwordOnly: true },
      },
    });
    // With a username saved, form detection stays the fallback.
    expect(on.resolveHttpApplicationLogin(connection("draytek"))).toMatchObject(
      {
        credentials: { username: "website-user", password: "fixture-password" },
        declarativeLogin: { mode: "additive", steps: { passwordOnly: true } },
      },
    );
    expect(() =>
      on.resolveHttpApplicationLogin(
        connection("draytek", "form", { password: "" }),
      ),
    ).toThrow("Automatic login for this device requires the website password.");
    expect(() =>
      on.resolveHttpApplicationLogin(
        connection("idrac", "form", { username: "" }),
      ),
    ).toThrow(/requires both the website username and password/);
  });

  it("restarts a session when the steps change, without serializing a credential", async () => {
    const on = await load({ native: true, legacy: true }, files);
    const first = on.resolveHttpApplicationLogin(connection("zulip"));
    const same = on.resolveHttpApplicationLogin(connection("zulip"));
    expect(on.sameHttpApplicationLogin(first, same)).toBe(true);
    const changed = structuredClone(first);
    changed.declarativeLogin!.steps.loginSteps.pop();
    expect(on.sameHttpApplicationLogin(first, changed)).toBe(false);
    expect(
      on.sameHttpApplicationLogin(first, {
        ...first,
        declarativeLogin: undefined,
      }),
    ).toBe(false);
  });
});

describe("frame-scoped, password-only and pre-step custom logins", () => {
  const selectors = {
    usernameSelector: "#account",
    passwordSelector: "#secret",
    submitSelector: "#sign-in",
  };
  const custom = (
    customLogin: unknown,
    patch: Partial<Connection> = {},
  ): Partial<Connection> =>
    connection("custom", "form", {
      httpApplication: {
        version: 1,
        id: "custom",
        loginMode: "form",
        ...(customLogin === undefined ? {} : { customLogin }),
      } as HttpApplicationSettings,
      httpAutoLoginSelectors: selectors,
      ...patch,
    });

  it("keeps the options through normalization for the Custom profile and nowhere else", async () => {
    const { normalizeHttpApplicationSettings } = await load({ native: false });
    const options = {
      frame: "appFrame",
      passwordOnly: true,
      preStepSelector: "#open-login",
      submission: "enter",
    };
    const saved = normalizeHttpApplicationSettings({
      version: 1,
      id: "custom",
      loginMode: "form",
      customLogin: options,
    });
    expect(saved).toEqual({
      version: 1,
      id: "custom",
      loginMode: "form",
      customLogin: options,
    });
    // Idempotent: a second pass over the saved value changes nothing.
    expect(normalizeHttpApplicationSettings(saved)).toEqual(saved);
    // Defaults are not stored.
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "custom",
        loginMode: "form",
        customLogin: { passwordOnly: false, submission: "click" },
      }),
    ).toEqual({ version: 1, id: "custom", loginMode: "form" });
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "custom",
        loginMode: "form",
        customLogin: {},
      }),
    ).toEqual({ version: 1, id: "custom", loginMode: "form" });
    // Another profile cannot carry them.
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "portainer",
        loginMode: "form",
        customLogin: options,
      }),
    ).toEqual({
      version: 1,
      id: "portainer",
      loginMode: "form",
      invalid: true,
    });
  });

  it.each([
    ["an origin", { origin: "https://other.example.test" }],
    ["an unknown field", { frame: "appFrame", script: "run()" }],
    ["a frame selector instead of a name", { frame: "iframe#app" }],
    ["a frame name over its bound", { frame: "f".repeat(129) }],
    ["a blank pre-step", { preStepSelector: "   " }],
    [
      "a pre-step over the selector bound",
      { preStepSelector: "a".repeat(513) },
    ],
    ["a control character", { preStepSelector: "#tab\u0000" }],
    ["an unknown submission", { submission: "requestSubmit" }],
    ["a non-boolean flag", { passwordOnly: "yes" }],
    ["a list", ["appFrame"]],
    ["a string", "appFrame"],
  ])("fails closed on custom options with %s", async (_name, customLogin) => {
    const { normalizeHttpApplicationSettings, resolveHttpApplicationLogin } =
      await load({ native: true, legacy: true });
    const normalized = normalizeHttpApplicationSettings({
      version: 1,
      id: "custom",
      loginMode: "form",
      customLogin,
    });
    expect(normalized).toEqual({
      version: 1,
      id: "custom",
      loginMode: "form",
      invalid: true,
    });
    expect(() => resolveHttpApplicationLogin(custom(customLogin))).toThrow(
      /invalid or unavailable/,
    );
  });

  it("builds the same step format as the catalog, on the connection's own origin only", async () => {
    const on = await load({ native: true, legacy: true });
    const login = on.resolveHttpApplicationLogin(
      custom({ frame: "appFrame", preStepSelector: " #open-login " }),
    );
    expect(login).toEqual({
      credentials: { username: "website-user", password: "fixture-password" },
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors,
      declarativeLogin: {
        source: "custom",
        mode: "exclusive",
        steps: {
          passwordOnly: false,
          loginSteps: [
            {
              kind: "click",
              frame: "appFrame",
              selectors: { control: "#open-login" },
            },
            {
              kind: "form",
              frame: "appFrame",
              selectors: { username: "#account", password: "#secret" },
            },
            {
              kind: "submit",
              submission: "click",
              selectors: { control: "#sign-in" },
            },
          ],
        },
      },
    });
    expect(validateUserHttpLoginSteps(login.declarativeLogin!.steps).ok).toBe(
      true,
    );
    const resolved = on.resolveHttpApplicationLoginSteps(login, {
      connectionOrigin: "https://fixture.example.test",
    });
    expect(resolved).toMatchObject({
      ok: true,
      value: {
        crossOrigin: false,
        credentialOrigins: ["https://fixture.example.test"],
        steps: [
          { kind: "click", frame: "appFrame" },
          { kind: "form", frame: "appFrame" },
          { kind: "submit", frame: "appFrame", submits: "form" },
        ],
      },
    });
    // HTTP only as the connection's own configured origin.
    expect(
      on.resolveHttpApplicationLoginSteps(login, {
        connectionOrigin: "http://fixture.example.test:8080",
      }),
    ).toMatchObject({ ok: false });
    expect(
      on.resolveHttpApplicationLoginSteps(login, {
        connectionOrigin: "http://fixture.example.test:8080",
        configuredHttpOrigin: "http://fixture.example.test:8080",
      }),
    ).toMatchObject({ ok: true });
  });

  it("needs no username selector for a password-only device and no submit selector for Enter", async () => {
    const on = await load({ native: true, legacy: true });
    const login = on.resolveHttpApplicationLogin(
      custom(
        { passwordOnly: true, submission: "enter" },
        {
          username: "",
          httpAutoLoginSelectors: { passwordSelector: "#pin" },
        },
      ),
    );
    expect(login).toEqual({
      credentials: { username: "", password: "fixture-password" },
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors: { passwordSelector: "#pin" },
      declarativeLogin: {
        source: "custom",
        mode: "exclusive",
        steps: {
          passwordOnly: true,
          loginSteps: [
            { kind: "password", selectors: { password: "#pin" } },
            { kind: "submit", submission: "enter" },
          ],
        },
      },
    });
    // A script-driven form keeps its reviewed button; the selector is required.
    expect(
      on.resolveHttpApplicationLogin(custom({ submission: "spa" }))
        .declarativeLogin?.steps.loginSteps[1],
    ).toEqual({
      kind: "submit",
      submission: "spa",
      selectors: { control: "#sign-in" },
    });
    for (const [customLogin, missing] of [
      [{ passwordOnly: true }, { passwordSelector: "#pin" }],
      [{ submission: "enter" }, { usernameSelector: "#account" }],
      [{ frame: "appFrame" }, { passwordSelector: "#pin" }],
    ] as const)
      expect(() =>
        on.resolveHttpApplicationLogin(
          custom(customLogin, { httpAutoLoginSelectors: missing }),
        ),
      ).toThrow(
        "Custom application form login requires explicit selectors for every field its options use. Review Application settings.",
      );
    expect(() =>
      on.resolveHttpApplicationLogin(
        custom({ passwordOnly: true }, { password: "" }),
      ),
    ).toThrow("Automatic login for this device requires the website password.");
  });

  it("never runs a custom login with options in an engine that does not know them", async () => {
    const off = await load({ native: false });
    expect(() =>
      off.resolveHttpApplicationLogin(custom({ frame: "appFrame" })),
    ).toThrow(
      "This custom login uses a login frame, password-only, pre-step or submit option that this build cannot run. Clear those options in Application settings or use manual login.",
    );
    const nativeOnly = await load({ native: true, legacy: false });
    expect(() =>
      nativeOnly.resolveHttpApplicationLogin(custom({ frame: "appFrame" })),
    ).toThrow(
      "Automatic login for Custom application needs the native browser engine in this build. Review the browser engine in Settings → Web Browser, or use manual login.",
    );
    // Manual mode stays credential-free with the options saved.
    for (const state of [off, nativeOnly])
      expect(
        state.resolveHttpApplicationLogin({
          ...custom({ frame: "appFrame" }),
          httpApplication: {
            version: 1,
            id: "custom",
            loginMode: "manual",
            customLogin: { frame: "appFrame" },
          } as HttpApplicationSettings,
        }),
      ).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
  });

  it("leaves a custom login without options exactly as it was", async () => {
    const base = await load({ native: false }, []);
    for (const flags of [
      { native: false },
      { native: true },
      { native: true, legacy: true },
    ]) {
      const state = await load(flags);
      const login = state.resolveHttpApplicationLogin(custom(undefined));
      expect(login).toEqual(
        base.resolveHttpApplicationLogin(custom(undefined)),
      );
      expect(login).toEqual({
        credentials: { username: "website-user", password: "fixture-password" },
        upstreamAuthMode: "none",
        autoLogin: true,
        selectors,
      });
      expect(() =>
        state.resolveHttpApplicationLogin(
          custom(undefined, {
            httpAutoLoginSelectors: { ...selectors, submitSelector: "" },
          }),
        ),
      ).toThrow(
        "Custom application form login requires explicit username, password, and submit selectors. Review Application settings.",
      );
    }
  });
});

describe("reviewed MEO identity plans", () => {
  it.each([
    ["meo-particulares", "https://my.meo.pt/"],
    [
      "meo-empresas",
      "https://cliente-empresas.meo.pt/Pages/Dashboard/Dashboard.aspx",
    ],
  ])(
    "%s exposes explicit native form login while preserving manual consent",
    async (id, entry) => {
      const on = await load({ native: true });
      const profile = on.getHttpApplicationProfile(id)!;
      expect(profile.hostedLoginUrl).toBe(entry);
      expect(profile.loginModes).toEqual(["manual", "form"]);
      expect(profile.declarativeLoginMode).toBe("exclusive");
      expect(profile.declarativeLogin?.credentialOrigins).toEqual([
        "https://login.telecom.pt",
      ]);
      expect(profile.declarativeLogin?.loginSteps[0]).toMatchObject({
        kind: "form",
        origin: "https://login.telecom.pt",
        paths: ["/AuthorizeService/authorize.aspx"],
      });
      expect(profile.selectors).toBeUndefined();
      expect(profile.totpChallenges).toBeUndefined();
      expect(profile.description).not.toMatch(MANUAL_ONLY_CLAIM);
      expect(profile.description).toContain("SMS");
      expect(
        on.normalizeHttpApplicationSettings({ version: 1, id })?.loginMode,
      ).toBe("manual");
      expect(
        on.normalizeHttpApplicationSettings({
          version: 1,
          id,
          loginMode: "form",
        })?.invalid,
      ).toBeUndefined();
      expect(on.resolveHttpApplicationLogin(connection(id, "manual"))).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
      expect(() => on.resolveHttpApplicationLogin(connection(id))).toThrow(
        /needs the native browser engine/,
      );
    },
  );
});
