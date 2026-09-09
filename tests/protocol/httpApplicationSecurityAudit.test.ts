import { describe, expect, it } from "vitest";
import type {
  Connection,
  HttpApplicationSettings,
} from "../../src/types/connection/connection";
import {
  HTTP_APPLICATION_PROFILES,
  getHttpApplicationLoginModes,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  normalizeHttpApplicationSelectors,
  resolveHttpApplicationLogin,
} from "../../src/utils/auth/httpApplicationLogin";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import {
  normalizeImportedAdvancedProtocolConnection,
  prepareConnectionForClone,
  prepareConnectionForExport,
  serializeConnectionsToNativeXml,
  serializeDatasetsToNativeCsv,
  parseNativeAdvancedProtocolSettings,
  serializeNativeAdvancedProtocolSettings,
  hasAdvancedProtocolSettings,
} from "../../src/components/ImportExport/advancedProtocolPortability";
import {
  importFromCSV,
  importFromJSON,
  importFromXML,
} from "../../src/components/ImportExport/utils";

const base = (patch: Partial<Connection> = {}): Connection => ({
  id: "application-audit",
  name: "Fixture website",
  protocol: "https",
  hostname: "application.example.test",
  port: 443,
  isGroup: false,
  username: "generic-user",
  password: "fixture-generic-secret",
  basicAuthUsername: "website-user",
  basicAuthPassword: "fixture-website-secret",
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  httpApplication: { version: 1, id: "portainer", loginMode: "form" },
  ...patch,
});
const importedProfile = (value: unknown) =>
  base({ httpApplication: value as HttpApplicationSettings });

describe("independent HTTP application security audit", () => {
  it.each(HTTP_APPLICATION_PROFILES)(
    "enforces declared login capabilities for $id",
    (profile) => {
      const allowed = getHttpApplicationLoginModes(profile);
      for (const loginMode of ["manual", "form", "basic"] as const) {
        const connection = base({
          httpApplication: { version: 1, id: profile.id, loginMode },
          ...(profile.id === "custom"
            ? {
                httpAutoLoginSelectors: {
                  usernameSelector: "#custom-user",
                  passwordSelector: "#custom-pass",
                  submitSelector: "#custom-submit",
                },
              }
            : {}),
        });
        if (!allowed.includes(loginMode)) {
          expect(
            normalizeHttpApplicationSettings(connection.httpApplication)
              ?.invalid,
          ).toBe(true);
          expect(() => resolveHttpApplicationLogin(connection)).toThrow(
            /invalid|unavailable/,
          );
          continue;
        }
        const result = resolveHttpApplicationLogin(connection);
        if (loginMode === "manual")
          expect(result).toEqual({
            credentials: null,
            upstreamAuthMode: "none",
            autoLogin: false,
          });
        if (loginMode === "form")
          expect(result).toMatchObject({
            upstreamAuthMode: "none",
            autoLogin: true,
          });
        if (loginMode === "basic")
          expect(result).toMatchObject({
            upstreamAuthMode: "basic",
            autoLogin: false,
          });
      }
      if (profile.capability === "manual") expect(allowed).toEqual(["manual"]);
      if (profile.capability === "none") expect(allowed).toEqual([]);
    },
  );

  const hostile: [string, unknown][] = [
    ["null", null],
    ["array", []],
    ["string", "portainer"],
    ["number", 1],
    ["boolean", true],
    ["empty object", {}],
    ["unknown id", { version: 1, id: "unrecognized", loginMode: "form" }],
    ["wrong version", { version: 2, id: "portainer", loginMode: "form" }],
    ["string version", { version: "1", id: "portainer", loginMode: "form" }],
    ["unknown mode", { version: 1, id: "portainer", loginMode: "oauth" }],
    ["null mode", { version: 1, id: "portainer", loginMode: null }],
    ["overlong id", { version: 1, id: "x".repeat(81), loginMode: "form" }],
    ["control id", { version: 1, id: "portainer\u0000", loginMode: "form" }],
    [
      "invalid marker",
      { version: 1, id: "portainer", loginMode: "form", invalid: true },
    ],
    [
      "malformed realm",
      { version: 1, id: "proxmox", loginMode: "form", realm: "pam@other" },
    ],
    [
      "overlong realm",
      { version: 1, id: "proxmox", loginMode: "form", realm: "x".repeat(129) },
    ],
  ];
  it.each(hostile)(
    "keeps malformed-present %s invalid and never falls back to legacy Basic",
    (_label, value) => {
      const normalized = normalizeHttpApplicationSettings(value);
      expect(normalized?.invalid).toBe(true);
      expect(normalizeHttpApplicationSettings(normalized)).toEqual(normalized);
      expect(() => resolveHttpApplicationLogin(importedProfile(value))).toThrow(
        /invalid|unavailable/,
      );
    },
  );

  it("defaults a selected profile to manual and keeps genuine legacy mode unchanged", () => {
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "portainer" }),
    ).toEqual({ version: 1, id: "portainer", loginMode: "manual" });
    const legacy = resolveHttpApplicationLogin(
      base({ httpApplication: undefined, httpAutoLogin: true }),
    );
    expect(legacy).toMatchObject({
      credentials: {
        username: "website-user",
        password: "fixture-website-secret",
      },
      autoLogin: true,
    });
    expect(legacy).not.toHaveProperty("upstreamAuthMode");
  });

  it("drops injected credential, endpoint and arbitrary properties from profile metadata", () => {
    const raw = {
      version: 1,
      id: "proxmox",
      loginMode: "form",
      realm: "pve",
      password: "profile-secret",
      apiKey: "profile-token",
      selectors: { passwordSelector: "#evil" },
      hostname: "elsewhere.example.test",
    };
    expect(normalizeHttpApplicationSettings(raw)).toEqual({
      version: 1,
      id: "proxmox",
      loginMode: "form",
      realm: "pve",
    });
    expect(raw.password).toBe("profile-secret");
    const normalized = normalizeAdvancedProtocolConnection(
      importedProfile(raw),
    );
    expect(normalized.hostname).toBe("application.example.test");
    expect(normalized.httpApplication).toEqual({
      version: 1,
      id: "proxmox",
      loginMode: "form",
      realm: "pve",
    });
  });

  it("uses one credential pair without combining a dedicated username and unrelated generic password", () => {
    expect(() =>
      resolveHttpApplicationLogin(base({ basicAuthPassword: undefined })),
    ).toThrow(/both/);
    const result = resolveHttpApplicationLogin(
      base({ basicAuthUsername: "", basicAuthPassword: "" }),
    );
    expect(result.credentials).toEqual({
      username: "generic-user",
      password: "fixture-generic-secret",
    });
    const basic = resolveHttpApplicationLogin(
      base({
        basicAuthPassword: undefined,
        httpApplication: { version: 1, id: "portainer", loginMode: "basic" },
      }),
    );
    expect(basic.credentials).toEqual({
      username: "website-user",
      password: "",
    });
  });

  it("manual mode ignores all retained passwords, legacy auto-login and unsafe selectors", () => {
    const result = resolveHttpApplicationLogin(
      base({
        httpApplication: { version: 1, id: "portainer", loginMode: "manual" },
        httpAutoLogin: true,
        httpAutoLoginSelectors: { passwordSelector: "<invalid>" },
      }),
    );
    expect(result).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
  });

  it("adds Proxmox realm only to the volatile username and retains explicit selector overrides", () => {
    const connection = base({
      httpApplication: {
        version: 1,
        id: "proxmox",
        loginMode: "form",
        realm: "pve",
      },
      httpAutoLoginSelectors: { submitSelector: "#reviewed-login" },
    });
    const snapshot = JSON.stringify(connection);
    Object.freeze(connection.httpApplication);
    Object.freeze(connection.httpAutoLoginSelectors);
    Object.freeze(connection);
    const result = resolveHttpApplicationLogin(connection);
    expect(result.credentials?.username).toBe("website-user@pve");
    expect(result.selectors).toMatchObject({
      usernameSelector: 'input[name="username"]',
      passwordSelector: 'input[name="password"]',
      submitSelector: "#reviewed-login",
    });
    expect(JSON.stringify(connection)).toBe(snapshot);
    expect(
      resolveHttpApplicationLogin(
        base({
          basicAuthUsername: "user@ldap",
          httpApplication: {
            version: 1,
            id: "proxmox",
            loginMode: "form",
            realm: "pve",
          },
        }),
      ).credentials?.username,
    ).toBe("user@ldap");
  });

  it.each(["[", "<input>", "x".repeat(513), "#pass\u0000"])(
    "rejects unsafe selector override without exposing it: %j",
    (selector) => {
      const connection = base({
        httpAutoLoginSelectors: { passwordSelector: selector },
      });
      expect(() => resolveHttpApplicationLogin(connection)).toThrow(
        /Invalid application login selector/,
      );
    },
  );

  it("selector normalizer drops arbitrary properties without changing reviewed fields", () => {
    expect(
      normalizeHttpApplicationSelectors({
        usernameSelector: "#user",
        passwordSelector: "",
        submitSelector: "#submit",
        password: "secret",
        url: "https://elsewhere.example.test",
      }),
    ).toEqual({ usernameSelector: "#user", submitSelector: "#submit" });
  });

  it("round-trips profile metadata through credential-free JSON export/import and independent clone", async () => {
    const connection = base({
      httpApplication: {
        version: 1,
        id: "proxmox",
        loginMode: "form",
        realm: "pve",
      },
      httpAutoLoginSelectors: { passwordSelector: "#pass" },
      httpHeaders: {
        Authorization: "Bearer fixture-header-secret",
        "X-Trace": "trace",
      },
    });
    const snapshot = JSON.stringify(connection);
    const exported = prepareConnectionForExport(connection, false);
    expect(JSON.stringify(exported)).not.toMatch(
      /fixture-(?:website|generic|header)-secret/,
    );
    const [imported] = await importFromJSON(
      JSON.stringify({ connections: [exported] }),
    );
    expect(imported.httpApplication).toEqual(connection.httpApplication);
    expect(imported.httpAutoLoginSelectors).toEqual(
      connection.httpAutoLoginSelectors,
    );
    const clone = prepareConnectionForClone(connection, false);
    expect(clone.httpApplication).toEqual(connection.httpApplication);
    expect(clone.httpApplication).not.toBe(connection.httpApplication);
    expect(clone.password).toBeUndefined();
    expect(clone.basicAuthPassword).toBeUndefined();
    expect(JSON.stringify(connection)).toBe(snapshot);
  });

  it.each(["form", "basic"] as const)(
    "never transmits the reserved export sentinel after %s profile import",
    async (loginMode) => {
      const exported = prepareConnectionForExport(
        base({ httpApplication: { version: 1, id: "portainer", loginMode } }),
        false,
      );
      expect(exported.password).toBe("***ENCRYPTED***");
      expect(exported.basicAuthPassword).toBe("***ENCRYPTED***");
      const [imported] = await importFromJSON(JSON.stringify([exported]));
      expect(imported.password).toBeUndefined();
      expect(imported.basicAuthPassword).toBeUndefined();
      if (loginMode === "form")
        expect(() => resolveHttpApplicationLogin(imported)).toThrow(
          /both|credentials/,
        );
      else
        expect(
          resolveHttpApplicationLogin(imported).credentials?.password,
        ).toBe("");
      expect(
        normalizeImportedAdvancedProtocolConnection(
          base({
            password: "ordinary-password",
            basicAuthPassword: "ordinary-website-password",
          }),
        ).basicAuthPassword,
      ).toBe("ordinary-website-password");
    },
  );

  it.each(["xml", "csv"] as const)(
    "round-trips non-secret profile and selectors in native %s",
    async (format) => {
      const source = prepareConnectionForExport(
        base({
          httpApplication: {
            version: 1,
            id: "proxmox",
            loginMode: "form",
            realm: "pam",
          },
          httpAutoLoginSelectors: {
            usernameSelector: 'input[name="user"], #fallback',
            passwordSelector: "#pass",
            submitSelector: "button[type=submit]",
          },
        }),
        false,
      );
      const text =
        format === "xml"
          ? serializeConnectionsToNativeXml([source])
          : serializeDatasetsToNativeCsv([
              {
                databaseId: "fixture-db",
                databaseName: "Fixture",
                connections: [source],
              },
            ]);
      expect(text).not.toMatch(/fixture-(?:website|generic)-secret/);
      const imported = await (format === "xml"
        ? importFromXML(text)
        : importFromCSV(text));
      expect(imported).toHaveLength(1);
      expect(imported[0].httpApplication).toEqual(source.httpApplication);
      expect(imported[0].httpAutoLoginSelectors).toEqual(
        source.httpAutoLoginSelectors,
      );
      expect(imported[0].username).toBe("website-user");
      expect(imported[0].password).toBeUndefined();
      expect(imported[0].basicAuthPassword).toBeUndefined();
    },
  );

  it("keeps old native records absent but malformed present profile/selector columns fail-closed", () => {
    expect(
      parseNativeAdvancedProtocolSettings({ Name: "old" }),
    ).not.toHaveProperty("httpApplication");
    for (const record of [
      { HttpApplication: "{" },
      { HttpApplication: "null" },
      {
        HttpApplication: JSON.stringify({
          version: 1,
          id: "portainer",
          loginMode: "form",
        }),
        HttpAutoLoginSelectors: '{"passwordSelector":"["}',
      },
    ]) {
      const parsed = parseNativeAdvancedProtocolSettings(record);
      expect(parsed.httpApplication?.invalid).toBe(true);
      expect(() => resolveHttpApplicationLogin(base(parsed))).toThrow(
        /invalid|unavailable/,
      );
    }
  });

  it("exports only allowlisted profile and selector fields in native columns", () => {
    const source = importedProfile({
      version: 1,
      id: "proxmox",
      loginMode: "form",
      realm: "pve",
      password: "profile-secret",
      authToken: "profile-token",
    });
    source.httpAutoLoginSelectors = {
      passwordSelector: "#password",
      password: "selector-secret",
    } as Connection["httpAutoLoginSelectors"];
    const columns = serializeNativeAdvancedProtocolSettings(source);
    expect(JSON.parse(columns.HttpApplication!)).toEqual({
      version: 1,
      id: "proxmox",
      loginMode: "form",
      realm: "pve",
    });
    expect(JSON.parse(columns.HttpAutoLoginSelectors!)).toEqual({
      passwordSelector: "#password",
    });
    expect(JSON.stringify(columns)).not.toMatch(
      /profile-secret|profile-token|selector-secret|fixture-website-secret/,
    );
  });

  it.each([
    [],
    { passwordSelector: "[" },
    { passwordSelector: "x".repeat(513) },
  ])(
    "refuses malformed native-export selectors instead of losing the override",
    (value) => {
      const source = base({
        httpAutoLoginSelectors: value as Connection["httpAutoLoginSelectors"],
      });
      expect(() => serializeConnectionsToNativeXml([source])).toThrow(
        /Invalid application login selector/,
      );
      expect(() =>
        serializeDatasetsToNativeCsv([
          {
            databaseId: "fixture",
            databaseName: "Fixture",
            connections: [source],
          },
        ]),
      ).toThrow(/Invalid application login selector/);
    },
  );

  it("normalizes case-insensitive native columns and blocks unsupported profile versions", () => {
    const parsed = parseNativeAdvancedProtocolSettings({
      httpapplication:
        '{"version":1,"id":"proxmox","loginMode":"manual","realm":"pve"}',
      httpautologinselectors: '{"passwordSelector":"#pass"}',
    });
    expect(parsed.httpApplication).toEqual({
      version: 1,
      id: "proxmox",
      loginMode: "manual",
      realm: "pve",
    });
    expect(parsed.httpAutoLoginSelectors).toEqual({
      passwordSelector: "#pass",
    });
    const future = parseNativeAdvancedProtocolSettings({
      HttpApplication: '{"version":2,"id":"proxmox","loginMode":"form"}',
    });
    expect(future.httpApplication?.invalid).toBe(true);
  });

  it("includes profiles and selector overrides in foreign-format loss warnings", () => {
    expect(hasAdvancedProtocolSettings(base())).toBe(true);
    expect(
      hasAdvancedProtocolSettings(
        base({
          httpApplication: undefined,
          httpAutoLoginSelectors: { passwordSelector: "#pass" },
        }),
      ),
    ).toBe(true);
    expect(
      hasAdvancedProtocolSettings(base({ httpApplication: undefined })),
    ).toBe(false);
  });

  it("preserves real passwords only when export or clone explicitly includes credentials", () => {
    const source = base();
    for (const result of [
      prepareConnectionForExport(source, true),
      prepareConnectionForClone(source, true),
    ]) {
      expect(result.password).toBe("fixture-generic-secret");
      expect(result.basicAuthPassword).toBe("fixture-website-secret");
      expect(result.httpApplication).toEqual(source.httpApplication);
      expect(result.httpApplication).not.toBe(source.httpApplication);
    }
    expect(
      normalizeImportedAdvancedProtocolConnection(
        base({ password: "", basicAuthPassword: "" }),
      ),
    ).toMatchObject({ password: "", basicAuthPassword: "" });
  });

  it.each(["xml", "csv"] as const)(
    "keeps generic/other-protocol usernames unchanged in native %s",
    async (format) => {
      const sources = [
        base({ id: "generic", httpApplication: undefined }),
        base({ id: "other", protocol: "ssh" }),
      ];
      const text =
        format === "xml"
          ? serializeConnectionsToNativeXml(sources)
          : serializeDatasetsToNativeCsv([
              {
                databaseId: "fixture",
                databaseName: "Fixture",
                connections: sources,
              },
            ]);
      const imported = await (format === "xml"
        ? importFromXML(text)
        : importFromCSV(text));
      expect(imported.map((connection) => connection.username)).toEqual([
        "generic-user",
        "generic-user",
      ]);
      expect(text).not.toMatch(/fixture-website-secret|fixture-generic-secret/);
    },
  );

  it.each(["json", "xml", "csv", "clone"] as const)(
    "preserves a custom profile and its exact reviewed selectors through credential-free %s",
    async (format) => {
      const source = base({
        httpApplication: { version: 1, id: "custom", loginMode: "form" },
        httpAutoLoginSelectors: {
          usernameSelector: 'form[data-login="custom"] input[name="user"]',
          passwordSelector: 'form[data-login="custom"] input[name="pass"]',
          submitSelector: 'form[data-login="custom"] button[type="submit"]',
        },
      });
      const snapshot = JSON.stringify(source);
      const exported = prepareConnectionForExport(source, false);
      let imported: Connection;
      if (format === "clone")
        imported = prepareConnectionForClone(source, false);
      else if (format === "json")
        [imported] = await importFromJSON(JSON.stringify([exported]));
      else if (format === "xml")
        [imported] = await importFromXML(
          serializeConnectionsToNativeXml([exported]),
        );
      else
        [imported] = await importFromCSV(
          serializeDatasetsToNativeCsv([
            {
              databaseId: "fixture",
              databaseName: "Fixture",
              connections: [exported],
            },
          ]),
        );
      expect(imported.httpApplication).toEqual(source.httpApplication);
      expect(imported.httpAutoLoginSelectors).toEqual(
        source.httpAutoLoginSelectors,
      );
      expect(imported.password).toBeUndefined();
      expect(imported.basicAuthPassword).toBeUndefined();
      expect(() => resolveHttpApplicationLogin(imported)).toThrow(
        /both|credentials/,
      );
      expect(
        resolveHttpApplicationLogin({
          ...imported,
          basicAuthUsername: "reviewed-user",
          basicAuthPassword: "fresh-fixture-password",
        }),
      ).toMatchObject({
        upstreamAuthMode: "none",
        autoLogin: true,
        selectors: source.httpAutoLoginSelectors,
      });
      expect(JSON.stringify(source)).toBe(snapshot);
    },
  );

  it.each([
    "{",
    "null",
    '{"passwordSelector":"["}',
    '{"passwordSelector":"' + "x".repeat(513) + '"}',
  ])(
    "does not downgrade a custom profile with malformed imported selectors",
    (selectors) => {
      const imported = parseNativeAdvancedProtocolSettings({
        HttpApplication: '{"version":1,"id":"custom","loginMode":"form"}',
        HttpAutoLoginSelectors: selectors,
      });
      expect(imported.httpApplication?.invalid).toBe(true);
      expect(() => resolveHttpApplicationLogin(base(imported))).toThrow(
        /invalid|unavailable/,
      );
    },
  );
});
