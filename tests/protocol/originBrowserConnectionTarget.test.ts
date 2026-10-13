import { describe, expect, it } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import {
  originBrowserConnectionTarget,
  originBrowserDisplayUrl,
  originBrowserSavedSource,
} from "../../src/hooks/protocol/originBrowserConnectionTarget";
import {
  NATIVE_BROWSER_AUTHORITY_EXCLUSIONS,
  nativeBrowserAuthoritySignature,
} from "../../src/utils/connection/nativeBrowserAuthoritySignature";
import exclusionFile from "../../src-tauri/src/origin_browser_digest_exclusions.json";

const connection = {
  id: "fixture",
  hostname: "fixture.invalid",
  protocol: "https",
  port: 443,
} as Connection;
const session = {
  ...connection,
  connectionId: connection.id,
  id: "tab",
  status: "connected",
  startTime: new Date(),
} as ConnectionSession;
describe("native connection target", () => {
  it("preserves a saved page while redacting its display URL", () => {
    const target = originBrowserConnectionTarget(connection, {
      ...session,
      hostname: "https://fixture.invalid/login?ticket=private#state",
    });
    expect(target).toBe("https://fixture.invalid/login?ticket=private#state");
    expect(originBrowserDisplayUrl(target)).toBe(
      "https://fixture.invalid/login",
    );
  });
  it("opens Drone CI's /login only for its bridged form login", () => {
    const drone = (loginMode: "manual" | "form"): Connection => ({
      ...connection,
      hostname: "ci.example.test",
      httpApplication: {
        version: 1,
        id: "drone-ci",
        loginMode,
        ...(loginMode === "form"
          ? {
              droneScmProvider: "gitea" as const,
              droneScmOrigin: "https://git.example.test",
            }
          : {}),
      },
    });
    const at = { ...session, hostname: "ci.example.test" };
    expect(originBrowserConnectionTarget(drone("form"), at)).toBe(
      "https://ci.example.test/login",
    );
    expect(originBrowserConnectionTarget(drone("manual"), at)).toBe(
      "https://ci.example.test/",
    );
  });
  it("preserves an explicit non-default saved port", () => {
    expect(
      originBrowserConnectionTarget({ ...connection, port: 8443 }, session),
    ).toBe("https://fixture.invalid:8443/");
  });
  it.each([undefined, "shared@example.test"])(
    "builds the configured HTTP OWA source with mailbox %s",
    (exchangeOwaMailbox) => {
      const httpConnection: Connection = {
        ...connection,
        protocol: "http",
        port: 8080,
        httpApplication: {
          version: 1,
          id: "exchange-owa",
          loginMode: "form",
          exchangeOwaMailbox,
        },
      };
      expect(
        originBrowserConnectionTarget(httpConnection, {
          ...session,
          protocol: "http",
        }),
      ).toBe(
        `http://fixture.invalid:8080/owa/${exchangeOwaMailbox ? `${exchangeOwaMailbox}/` : ""}`,
      );
    },
  );
  it.each([
    "http://fixture.invalid",
    "https://fixture.invalid:8443",
    "https://user:secret@fixture.invalid",
    "javascript:alert(1)",
  ])("rejects conflicting or unsafe saved targets: %s", (hostname) => {
    expect(() =>
      originBrowserConnectionTarget(connection, { ...session, hostname }),
    ).toThrow();
  });
  it("rejects unsafe display URLs", () => {
    expect(
      originBrowserDisplayUrl("https://user:secret@fixture.invalid/"),
    ).toBe("");
    expect(originBrowserDisplayUrl("javascript:alert(1)")).toBe("");
  });
});

describe("saved source of a native website tab", () => {
  // Native builds the source from the saved row alone and rejects a request
  // that differs, so the session row must follow the saved host and scheme.
  it.each([
    [{ hostname: "renamed.invalid" }, "https://renamed.invalid/"],
    [{ protocol: "http" as const, port: 80 }, "http://fixture.invalid/"],
    [
      { hostname: "https://renamed.invalid/login", port: 8443 },
      "https://renamed.invalid:8443/login",
    ],
  ])("follows a saved host or scheme edit: %j", (edit, target) => {
    const saved = { ...connection, ...edit };
    const source = originBrowserSavedSource(saved);
    expect(source).toEqual({
      protocol: saved.protocol,
      hostname: saved.hostname,
    });
    // The stale session row cannot produce the source native expects.
    let stale = "";
    try {
      stale = originBrowserConnectionTarget(saved, session);
    } catch {
      /* A conflicting scheme or port is not a target at all. */
    }
    expect(stale).not.toBe(target);
    expect(
      originBrowserConnectionTarget(saved, { ...session, ...source }),
    ).toBe(target);
  });
  it.each([{ protocol: "ssh" as const, port: 22 }, { isGroup: true }])(
    "has no website source once the saved row is %j",
    (edit) => {
      expect(originBrowserSavedSource({ ...connection, ...edit })).toBeNull();
    },
  );
});

describe("saved authority signature of a native website tab", () => {
  // The reviewed list. A path added to the shared file must be added here in
  // the same review: the native lease removes exactly these before hashing.
  const reviewed = [
    ["httpBookmarks"],
    ["httpAutomation", "items"],
    ["updatedAt"],
    ["lastConnected"],
    ["connectionCount"],
    ["name"],
    ["description"],
    ["tags"],
    ["icon"],
    ["colorTag"],
    ["tabColor"],
    ["favorite"],
    ["order"],
    ["parentId"],
    ["browserSession", "defaultZoomPercent"],
    ["browserSession", "showBookmarksBar"],
    ["browserSession", "showSecurityInfo"],
    ["browserSession", "showLoadingProgress"],
  ];
  const listed = exclusionFile.exclusions.map((entry) => entry.path);
  const row = {
    ...connection,
    name: "Fixture",
    isGroup: false,
    username: "saved-user",
    password: "saved-secret",
    tags: ["one"],
    httpAutomation: { version: 1, items: [], scriptInjectionEnabled: false },
    websiteDomainPermissions: { version: 1, websites: [] },
    browserSession: { version: 1, webglEnabled: true },
  } as unknown as Connection;
  const edited = (
    path: readonly string[],
    value: unknown,
    from: Connection = row,
  ): Connection => {
    const copy = structuredClone(from) as unknown as Record<string, unknown>;
    let node = copy;
    for (const key of path.slice(0, -1)) {
      node[key] ??= {};
      node = node[key] as Record<string, unknown>;
    }
    node[path[path.length - 1]] = value;
    return copy as unknown as Connection;
  };
  const without = (key: keyof Connection): Connection => {
    const copy = structuredClone(row);
    delete copy[key];
    return copy;
  };
  const signature = nativeBrowserAuthoritySignature(row);

  it("applies exactly the reviewed exclusion list of the shared file", () => {
    expect(exclusionFile.version).toBe(1);
    expect(listed).toEqual(reviewed);
    expect(NATIVE_BROWSER_AUTHORITY_EXCLUSIONS).toEqual(reviewed);
  });
  it.each(listed.map((path) => [path.join("."), path] as const))(
    "ignores an edit of %s",
    (_name, path) => {
      expect(typeof signature).toBe("string");
      expect(nativeBrowserAuthoritySignature(edited(path, "edited"))).toBe(
        signature,
      );
    },
  );
  it.each([
    [["hostname"], "renamed.invalid"],
    [["port"], 8443],
    [["protocol"], "http"],
    [["username"], "another-user"],
    [["password"], "another-secret"],
    [["credentialSource"], { kind: "vault", credentialId: "c1" }],
    [["httpApplication"], { version: 1, id: "grafana", loginMode: "form" }],
    [["httpVerifySsl"], false],
    [["websiteDomainPermissions", "websites"], [{ origin: "https://a.test" }]],
    [["httpAutomation", "scriptInjectionEnabled"], true],
    [["browserSession", "webglEnabled"], false],
    [["browserSession", "cookiesEnabled"], false],
    [["browserSession", "websiteExtensionsEnabled"], false],
    [["browserSession", "initialLoadTimeoutSeconds"], 45],
    [["browserSession", "sessionRetention"], { version: 1, mode: "memory" }],
    // Only the listed key path is excluded, never the same key elsewhere.
    [["httpAutomation", "name"], "edited"],
    [["httpApplication", "items"], ["edited"]],
    // Unknown and future fields stay part of the authority.
    [["someFutureField"], "edited"],
  ])("changes with an edit of %j", (path, value) => {
    expect(listed).not.toContainEqual(path);
    expect(nativeBrowserAuthoritySignature(edited(path, value))).not.toBe(
      signature,
    );
  });
  it("does not depend on key order or on absent optional fields", () => {
    const reordered = Object.fromEntries(
      Object.entries(row).reverse(),
    ) as unknown as Connection;
    expect(nativeBrowserAuthoritySignature(reordered)).toBe(signature);
    expect(nativeBrowserAuthoritySignature({ ...row, domain: undefined })).toBe(
      signature,
    );
  });
  it("never carries a saved secret or address in the signature", () => {
    expect(signature).not.toContain("saved-secret");
    expect(signature).not.toContain("fixture.invalid");
    expect(signature!.length).toBeLessThanOrEqual(64);
  });

  // An editor creates the override object with the first override and drops
  // it with the last, so a display override alone is not an edit of anything
  // else. The rule and its one object come from the shared file.
  const absent = exclusionFile.absentWhenOnly;
  it("reads the objects that count as absent from the shared file", () => {
    expect(absent.map((rule) => [rule.path, rule.members])).toEqual([
      [["browserSession"], { version: 1 }],
    ]);
  });
  it("treats an override object left with only its version as absent", () => {
    const bare = nativeBrowserAuthoritySignature(without("browserSession"));
    expect(bare).not.toBe(signature);
    expect(
      nativeBrowserAuthoritySignature(
        edited(["browserSession"], { version: 1 }),
      ),
    ).toBe(bare);
    // The first display override creates the object, the last removes it.
    expect(
      nativeBrowserAuthoritySignature(
        edited(["browserSession"], { version: 1, defaultZoomPercent: 150 }),
      ),
    ).toBe(bare);
  });
  it.each([
    [{ version: 2 }],
    [{}],
    [{ version: 1, webglEnabled: false }],
    [{ version: 1, defaultZoomPercent: 150, cookiesEnabled: false }],
    [[{ version: 1 }]],
    [null],
  ])("keeps an override object that is not exactly that: %j", (value) => {
    expect(
      nativeBrowserAuthoritySignature(edited(["browserSession"], value)),
    ).not.toBe(nativeBrowserAuthoritySignature(without("browserSession")));
  });
});
