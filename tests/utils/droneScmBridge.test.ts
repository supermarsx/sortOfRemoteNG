import { describe, expect, it } from "vitest";
import {
  DRONE_SCM_PROVIDERS,
  DRONE_SCM_SPECS,
  checkDroneScmAuthorizeUrl,
  deriveDroneScmFromRedirect,
  linkDroneScmFromConnection,
  normalizeDroneScmSettings,
  resolveDroneScmBridge,
} from "../../src/utils/connection/droneScmBridge";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
import type { Connection } from "../../src/types/connection/connection";

const DRONE = "https://ci.example.test";
const GITEA = "https://git.example.test";
const CLIENT = "3f0c2a8e-1b7d-4c55-9a0e-6d2b1f8e7c41";

const authorize = (
  origin: string,
  path: string,
  params: Record<string, string>,
) => {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return url.href;
};
const giteaAuthorize = (overrides: Record<string, string> = {}) =>
  authorize(GITEA, "/login/oauth/authorize", {
    client_id: CLIENT,
    redirect_uri: `${DRONE}/login`,
    response_type: "code",
    state: "opaque-state",
    ...overrides,
  });

const ok = <T>(
  result: { ok: true; value: T } | { ok: false; issue: string },
): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.issue}`);
  return result.value;
};
const issue = (
  result: { ok: true } | { ok: false; issue: string },
): string | null => (result.ok ? null : result.issue);

describe("Drone SCM bridge settings", () => {
  it("accepts exactly the five SCMs Drone ships with", () => {
    expect([...DRONE_SCM_PROVIDERS]).toEqual([
      "gitea",
      "gogs",
      "github",
      "gitlab",
      "bitbucket",
    ]);
  });

  it("canonicalises the SCM origin and refuses anything that is not a bare origin", () => {
    expect(
      ok(
        normalizeDroneScmSettings({
          provider: "gitea",
          origin: "HTTPS://Git.Example.Test:443/",
          clientId: CLIENT,
        }),
      ),
    ).toEqual({ provider: "gitea", origin: GITEA, clientId: CLIENT });
    for (const origin of [
      "https://git.example.test/gitea",
      "https://user:pw@git.example.test",
      "https://git.example.test/?next=/",
      "https://git.example.test/#x",
      "https://*.example.test",
      "ftp://git.example.test",
      "git.example.test",
      "",
      42,
    ])
      expect(
        issue(normalizeDroneScmSettings({ provider: "gitea", origin })),
        String(origin),
      ).toBe("invalid-scm-origin");
  });

  it("refuses unknown providers, unknown fields and malformed client ids", () => {
    expect(issue(normalizeDroneScmSettings({ provider: "gitee" }))).toBe(
      "invalid-provider",
    );
    expect(
      issue(normalizeDroneScmSettings({ provider: "gitea", extra: true })),
    ).toBe("unknown-field");
    expect(issue(normalizeDroneScmSettings(null))).toBe("invalid-settings");
    for (const clientId of ["", "a b", "x".repeat(129), "id\u0000", "<id>"])
      expect(
        issue(
          normalizeDroneScmSettings({
            provider: "gitea",
            origin: GITEA,
            clientId,
          }),
        ),
      ).toBe("invalid-client-id");
  });
});

describe("resolving the bridge for one Drone connection", () => {
  it("Gitea: types only on the saved SCM origin, never on Drone, and binds TOTP and consent to it", () => {
    const bridge = ok(
      resolveDroneScmBridge(
        { provider: "gitea", origin: GITEA, clientId: CLIENT },
        `${DRONE}/`,
      ),
    );
    expect(bridge.droneOrigin).toBe(DRONE);
    expect(bridge.scmOrigin).toBe(GITEA);
    expect(bridge.entryUrl).toBe(`${DRONE}/login`);
    expect(bridge.redirectUri).toBe(`${DRONE}/login`);
    expect(bridge.credentialOrigins).toEqual([GITEA]);
    expect(bridge.credentialOrigins).not.toContain(DRONE);
    expect(bridge.navigationOrigins).toEqual([GITEA]);
    expect(bridge.signIn?.origin).toBe(GITEA);
    expect(bridge.totp?.origin).toBe(GITEA);
    expect(bridge.totp?.challenge.paths).toEqual(["/user/two_factor"]);
    expect(bridge.consent).toEqual({
      origin: GITEA,
      paths: ["/login/oauth/authorize"],
      formAction: "/login/oauth/grant",
      formSelector: 'form[method="post" i][action$="/login/oauth/grant"]',
      buttonSelector:
        'button#authorize-app[type="submit"][name="granted"][value="true"]',
      clientId: CLIENT,
      redirectUri: `${DRONE}/login`,
    });
  });

  it("Gitea without a saved client id signs in but leaves the consent click to the user", () => {
    const bridge = ok(
      resolveDroneScmBridge({ provider: "gitea", origin: GITEA }, DRONE),
    );
    expect(bridge.credentialOrigins).toEqual([GITEA]);
    expect(bridge.consent).toBeNull();
    expect(bridge.interactive).toContain("consent-needs-client-id");
  });

  it("an SCM must be configured explicitly for self-hosted providers", () => {
    for (const provider of ["gitea", "gitlab"] as const)
      expect(issue(resolveDroneScmBridge({ provider }, DRONE))).toBe(
        "scm-origin-required",
      );
  });

  it("refuses an SCM on the Drone origin itself and any plaintext SCM", () => {
    expect(
      issue(resolveDroneScmBridge({ provider: "gitea", origin: DRONE }, DRONE)),
    ).toBe("scm-origin-is-drone");
    expect(
      issue(
        resolveDroneScmBridge(
          { provider: "gitea", origin: "http://git.example.test" },
          DRONE,
        ),
      ),
    ).toBe("insecure-scm-origin");
    // Not even behind a plaintext Drone on a LAN: the password and the
    // one-time code travel on the SCM leg. An HTTPS SCM on a private address
    // with its own port is fine.
    expect(
      issue(
        resolveDroneScmBridge(
          { provider: "gitea", origin: "http://192.168.1.10:3000" },
          "http://192.168.1.11:8080",
        ),
      ),
    ).toBe("insecure-scm-origin");
    const lan = ok(
      resolveDroneScmBridge(
        { provider: "gitea", origin: "https://192.168.1.10:3000" },
        "http://192.168.1.11:8080",
      ),
    );
    expect(lan.credentialOrigins).toEqual(["https://192.168.1.10:3000"]);
    expect(lan.totp?.origin).toBe("https://192.168.1.10:3000");
  });

  it("Gogs: Drone shows its own form; credentials go to the Drone origin only", () => {
    const bridge = ok(resolveDroneScmBridge({ provider: "gogs" }, DRONE));
    expect(bridge.scmOrigin).toBeNull();
    expect(bridge.credentialOrigins).toEqual([DRONE]);
    expect(bridge.navigationOrigins).toEqual([]);
    expect(bridge.signIn).toEqual({
      origin: DRONE,
      paths: ["/login/form"],
      selectors: DRONE_SCM_SPECS.gogs.signIn!.selectors,
    });
    expect(bridge.totp).toBeNull();
    expect(bridge.consent).toBeNull();
  });

  it("GitHub: github.com by default with the reviewed form; Enterprise origins sign in by hand", () => {
    const hosted = ok(resolveDroneScmBridge({ provider: "github" }, DRONE));
    expect(hosted.scmOrigin).toBe("https://github.com");
    expect(hosted.credentialOrigins).toEqual(["https://github.com"]);
    expect(hosted.consent).toBeNull();
    const enterprise = ok(
      resolveDroneScmBridge(
        { provider: "github", origin: "https://ghe.example.test" },
        DRONE,
      ),
    );
    expect(enterprise.credentialOrigins).toEqual([]);
    expect(enterprise.navigationOrigins).toEqual(["https://ghe.example.test"]);
    expect(enterprise.interactive).toContain("sign-in-unreviewed");
  });

  it("GitLab: self-hosted uses the reviewed local form; gitlab.com signs in by hand", () => {
    const own = ok(
      resolveDroneScmBridge(
        { provider: "gitlab", origin: "https://gitlab.example.test" },
        DRONE,
      ),
    );
    expect(own.credentialOrigins).toEqual(["https://gitlab.example.test"]);
    const hosted = ok(
      resolveDroneScmBridge(
        { provider: "gitlab", origin: "https://gitlab.com" },
        DRONE,
      ),
    );
    expect(hosted.credentialOrigins).toEqual([]);
  });

  it("Bitbucket: fixed origin, nothing typed or clicked", () => {
    const bridge = ok(resolveDroneScmBridge({ provider: "bitbucket" }, DRONE));
    expect(bridge.scmOrigin).toBe("https://bitbucket.org");
    expect(bridge.credentialOrigins).toEqual([]);
    expect(bridge.consent).toBeNull();
    expect(
      issue(
        resolveDroneScmBridge(
          { provider: "bitbucket", origin: "https://bb.example.test" },
          DRONE,
        ),
      ),
    ).toBe("scm-origin-fixed");
  });

  it("refuses a Drone address that is not a plain web origin", () => {
    for (const drone of ["ftp://ci.example.test", "not a url", ""])
      expect(issue(resolveDroneScmBridge({ provider: "gogs" }, drone))).toBe(
        "invalid-drone-origin",
      );
  });

  it("reuses the reviewed Gitea, GitHub and GitLab profiles verbatim", () => {
    const pick = (id: string) => {
      const profile = getHttpApplicationProfile(id)!;
      return profile.selectors;
    };
    expect(DRONE_SCM_SPECS.gitea.signIn!.selectors).toEqual(pick("gitea"));
    expect(DRONE_SCM_SPECS.github.signIn!.selectors).toEqual(pick("github"));
    expect(DRONE_SCM_SPECS.gitlab.signIn!.selectors).toEqual(
      pick("gitlab-self-hosted"),
    );
    const giteaTotp = getHttpApplicationProfile("gitea")!.totpChallenges![0];
    const { id: _id, label: _label, ...shape } = giteaTotp;
    const { id, label: _l, ...bridged } = DRONE_SCM_SPECS.gitea.totp!;
    expect(id).toBe("drone-ci-gitea-totp");
    expect(bridged).toEqual(shape);
  });
});

describe("deriving the SCM from Drone's /login redirect", () => {
  it("proposes the Gitea origin and client id from a well-formed authorize redirect", () => {
    expect(ok(deriveDroneScmFromRedirect(DRONE, giteaAuthorize()))).toEqual({
      providers: ["gitea", "github"],
      origin: GITEA,
      clientId: CLIENT,
    });
    expect(
      ok(
        deriveDroneScmFromRedirect(
          DRONE,
          authorize("https://github.com", "/login/oauth/authorize", {
            client_id: "Iv1.0123456789abcdef",
            redirect_uri: `${DRONE}/login`,
            response_type: "code",
          }),
        ),
      ).providers,
    ).toEqual(["github"]);
  });

  it("recognises GitLab, Bitbucket and the Gogs form on Drone itself", () => {
    expect(
      ok(
        deriveDroneScmFromRedirect(
          DRONE,
          authorize("https://gitlab.example.test", "/oauth/authorize", {
            client_id: "a".repeat(64),
            redirect_uri: `${DRONE}/login`,
            response_type: "code",
          }),
        ),
      ),
    ).toEqual({
      providers: ["gitlab"],
      origin: "https://gitlab.example.test",
      clientId: "a".repeat(64),
    });
    expect(
      ok(
        deriveDroneScmFromRedirect(
          DRONE,
          authorize("https://bitbucket.org", "/site/oauth2/authorize", {
            client_id: "KeyAbc123",
            redirect_uri: `${DRONE}/login`,
            response_type: "code",
          }),
        ),
      ).providers,
    ).toEqual(["bitbucket"]);
    expect(ok(deriveDroneScmFromRedirect(DRONE, "/login/form"))).toEqual({
      providers: ["gogs"],
      origin: null,
      clientId: null,
    });
  });

  it("never proposes a target whose callback is not this Drone", () => {
    for (const redirect_uri of [
      "https://evil.example.test/login",
      `${DRONE}/login/extra`,
      `${DRONE}:8443/login`,
      `http://ci.example.test/login`,
      "",
    ])
      expect(
        issue(
          deriveDroneScmFromRedirect(DRONE, giteaAuthorize({ redirect_uri })),
        ),
        redirect_uri,
      ).toBe("callback-not-drone");
  });

  it("refuses wrong response types, missing client ids, credentials in the URL and unknown paths", () => {
    expect(
      issue(
        deriveDroneScmFromRedirect(
          DRONE,
          giteaAuthorize({ response_type: "token" }),
        ),
      ),
    ).toBe("not-an-authorize-redirect");
    expect(
      issue(
        deriveDroneScmFromRedirect(DRONE, giteaAuthorize({ client_id: "" })),
      ),
    ).toBe("invalid-client-id");
    expect(
      issue(
        deriveDroneScmFromRedirect(
          DRONE,
          giteaAuthorize().replace("https://", "https://u:p@"),
        ),
      ),
    ).toBe("invalid-redirect-target");
    expect(
      issue(
        deriveDroneScmFromRedirect(
          DRONE,
          giteaAuthorize().replace("https://", "https://u@"),
        ),
      ),
    ).toBe("invalid-redirect-target");
    expect(
      issue(
        deriveDroneScmFromRedirect(
          DRONE,
          authorize(GITEA, "/gitea/login/oauth/authorize", {
            client_id: CLIENT,
            redirect_uri: `${DRONE}/login`,
            response_type: "code",
          }),
        ),
      ),
    ).toBe("not-an-authorize-redirect");
    expect(
      issue(deriveDroneScmFromRedirect(DRONE, "javascript:alert(1)")),
    ).toBe("invalid-redirect-target");
    expect(
      issue(deriveDroneScmFromRedirect(DRONE, `${DRONE}/somewhere-else`)),
    ).toBe("not-an-authorize-redirect");
  });

  it("never proposes a plaintext SCM", () => {
    expect(
      issue(
        deriveDroneScmFromRedirect(
          DRONE,
          giteaAuthorize().replace(GITEA, "http://git.example.test"),
        ),
      ),
    ).toBe("insecure-scm-origin");
  });

  it("does not let a Bitbucket path on another host pass as Bitbucket", () => {
    expect(
      issue(
        deriveDroneScmFromRedirect(
          DRONE,
          authorize(
            "https://bitbucket.example.test",
            "/site/oauth2/authorize",
            {
              client_id: "KeyAbc123",
              redirect_uri: `${DRONE}/login`,
              response_type: "code",
            },
          ),
        ),
      ),
    ).toBe("not-an-authorize-redirect");
  });
});

describe("the run-time authorize check", () => {
  const bridge = ok(
    resolveDroneScmBridge(
      { provider: "gitea", origin: GITEA, clientId: CLIENT },
      DRONE,
    ),
  );

  it("accepts only the saved SCM, the reviewed path, the saved client and this Drone's callback", () => {
    expect(checkDroneScmAuthorizeUrl(bridge, giteaAuthorize())).toBe(true);
    expect(
      checkDroneScmAuthorizeUrl(
        bridge,
        giteaAuthorize().replace(GITEA, "https://git.evil.test"),
      ),
    ).toBe(false);
    expect(
      checkDroneScmAuthorizeUrl(bridge, giteaAuthorize({ client_id: "other" })),
    ).toBe(false);
    expect(
      checkDroneScmAuthorizeUrl(
        bridge,
        giteaAuthorize({ redirect_uri: "https://evil.example.test/login" }),
      ),
    ).toBe(false);
    expect(checkDroneScmAuthorizeUrl(bridge, `${GITEA}/user/login`)).toBe(
      false,
    );
    expect(checkDroneScmAuthorizeUrl(bridge, "not a url")).toBe(false);
  });

  it("is always false for an SCM with no origin (Gogs)", () => {
    const gogs = ok(resolveDroneScmBridge({ provider: "gogs" }, DRONE));
    expect(checkDroneScmAuthorizeUrl(gogs, giteaAuthorize())).toBe(false);
  });
});

describe("linking a saved Gitea connection", () => {
  const gitea = (overrides: Partial<Connection> = {}) =>
    ({
      id: "g1",
      name: "Gitea",
      protocol: "https",
      hostname: "git.example.test",
      port: 443,
      httpApplication: { version: 1, id: "gitea", loginMode: "form" },
      ...overrides,
    }) as unknown as Connection;

  it("takes the SCM origin from the saved connection and shares its vault entry, never its secrets", () => {
    const credentialSource = {
      kind: "vault" as const,
      credentialId: "6a1f7f3e-2a0a-4c37-9d5f-1a2b3c4d5e6f",
      totpId: "0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e",
    };
    const linked = ok(
      linkDroneScmFromConnection(
        gitea({
          credentialSource,
          basicAuthPassword: "must-not-travel",
          password: "must-not-travel",
        } as Partial<Connection>),
      ),
    );
    expect(linked).toEqual({
      settings: { provider: "gitea", origin: GITEA },
      credentialSource,
    });
    expect(JSON.stringify(linked)).not.toContain("must-not-travel");
  });

  it("links the origin only when the Gitea connection keeps its own local sign-in", () => {
    const linked = ok(linkDroneScmFromConnection(gitea()));
    expect(linked).toEqual({
      settings: { provider: "gitea", origin: GITEA },
      credentialSource: null,
    });
    expect(
      ok(
        linkDroneScmFromConnection(
          gitea({ credentialSource: { kind: "local" } }),
        ),
      ).credentialSource,
    ).toBeNull();
  });

  it("maps GitHub and self-hosted GitLab connections, and refuses other applications", () => {
    expect(
      ok(
        linkDroneScmFromConnection(
          gitea({
            hostname: "gitlab.example.test",
            httpApplication: {
              version: 1,
              id: "gitlab-self-hosted",
              loginMode: "form",
            },
          }),
        ),
      ).settings,
    ).toEqual({ provider: "gitlab", origin: "https://gitlab.example.test" });
    expect(
      issue(
        linkDroneScmFromConnection(
          gitea({
            httpApplication: { version: 1, id: "portainer", loginMode: "form" },
          }),
        ),
      ),
    ).toBe("not-an-scm-connection");
    expect(
      issue(
        linkDroneScmFromConnection(
          gitea({ protocol: "ssh" } as Partial<Connection>),
        ),
      ),
    ).toBe("not-an-scm-connection");
  });
});
