import { describe, expect, it } from "vitest";
import {
  normalizeExchangeOwaMailbox,
  resolveExchangeOwaInitialUrl,
} from "../../src/utils/connection/exchangeOwaProfile";
import { normalizeHttpApplicationSettings } from "../../src/utils/connection/httpApplicationProfiles";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import type { Connection } from "../../src/types/connection/connection";

const profile = { version: 1, id: "exchange-owa", loginMode: "form" } as const;
const saved: Partial<Connection> = {
  hostname: "mail.example.test",
  protocol: "https",
  port: 8443,
  username: "DOMAIN\\admin",
  password: "synthetic-admin-password",
  httpApplication: profile,
};
const origin = "https://mail.example.test:8443";

describe("Exchange OWA mailbox metadata and URL", () => {
  it.each([
    [undefined, ""],
    ["", ""],
    ["   ", ""],
    [" shared@example.test ", "shared@example.test"],
    [
      "Service_1+invoices@sub-domain.example.test",
      "Service_1+invoices@sub-domain.example.test",
    ],
    ["first.last@example.test", "first.last@example.test"],
  ])("normalizes only an optional ASCII mailbox: %s", (input, expected) => {
    expect(normalizeExchangeOwaMailbox(input)).toBe(expected);
    expect(
      normalizeHttpApplicationSettings({
        ...profile,
        exchangeOwaMailbox: input,
      }),
    ).toEqual({
      ...profile,
      ...(expected ? { exchangeOwaMailbox: expected } : {}),
    });
  });

  it.each([
    null,
    false,
    42,
    {},
    [],
    "https://other.test/owa/shared@example.test/",
    "//other.test/shared@example.test",
    "/owa/shared@example.test/",
    "../shared@example.test",
    "..@example.test",
    "shared/child@example.test",
    "shared\\child@example.test",
    "shared@example.test?x=1",
    "shared@example.test#x",
    "shared%40example.test",
    "shared%2fchild@example.test",
    "shared%@example.test",
    "shared@example.test\n",
    "\tshared@example.test",
    "shared\u0000@example.test",
    "shared\u007f@example.test",
    "sharéd@example.test",
    "shared@exämple.test",
    "shared @example.test",
    '"shared"@example.test',
    "shared@@example.test",
    "shared",
    "shared@localhost",
    ".shared@example.test",
    "shared.@example.test",
    "shared..user@example.test",
    "shared@-example.test",
    "shared@example-.test",
    "shared@under_score.test",
    "shared@example..test",
    "shared@example.test.",
    `${"a".repeat(65)}@example.test`,
    `shared@${"a".repeat(64)}.test`,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.test`,
  ])(
    "keeps malformed target fail-closed across serialization: %j",
    (exchangeOwaMailbox) => {
      expect(normalizeExchangeOwaMailbox(exchangeOwaMailbox)).toBeUndefined();
      expect(() =>
        resolveExchangeOwaInitialUrl(origin, exchangeOwaMailbox),
      ).toThrow(/mailbox email/);
      const normalized = normalizeHttpApplicationSettings({
        ...profile,
        exchangeOwaMailbox,
      });
      expect(normalized?.invalid).toBe(true);
      const reloaded = normalizeHttpApplicationSettings(
        JSON.parse(JSON.stringify(normalized)),
      );
      expect(reloaded).toEqual(normalized);
      expect(() =>
        resolveHttpApplicationLogin({ ...saved, httpApplication: reloaded }),
      ).toThrow(/invalid/);
      expect(
        getHttpApplicationExternalTarget(
          { ...saved, httpApplication: reloaded },
          origin,
        ),
      ).toBeNull();
    },
  );

  it("rejects mailbox metadata on other profiles, even when blank", () => {
    for (const id of ["exchange-ecp", "outlook-online", "generic-form"])
      for (const exchangeOwaMailbox of ["", "shared@example.test"])
        expect(
          normalizeHttpApplicationSettings({
            ...profile,
            id,
            exchangeOwaMailbox,
          })?.invalid,
        ).toBe(true);
  });

  it.each(["manual", "form"] as const)(
    "round-trips the target without changing %s consent or credentials",
    (loginMode) => {
      const connection = {
        ...saved,
        httpApplication: {
          ...profile,
          loginMode,
          exchangeOwaMailbox: "service+invoices@example.test",
        },
      };
      const before = structuredClone(connection);
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(JSON.stringify(connection)),
      );
      expect(restored).toEqual(before);
      expect(resolveHttpApplicationLogin(restored)).toMatchObject({
        credentials:
          loginMode === "form"
            ? { username: saved.username, password: saved.password }
            : null,
        autoLogin: loginMode === "form",
        upstreamAuthMode: "none",
      });
      expect(connection).toEqual(before);
    },
  );

  it.each([
    ["mail.example.test", undefined, "/owa/"],
    [`${origin}/`, "", "/owa/"],
    [
      `${origin}/owa/older@example.test/?view=calendar#week`,
      undefined,
      "/owa/older@example.test/?view=calendar#week",
    ],
    [
      `${origin}/owa/older@example.test/?view=calendar#week`,
      " ",
      "/owa/older@example.test/?view=calendar#week",
    ],
    [`${origin}/?view=calendar`, undefined, "/?view=calendar"],
    [
      `${origin}/owa/older@example.test/?view=calendar#week`,
      "service+invoices@example.test",
      "/owa/service+invoices@example.test/",
    ],
  ])(
    "shares saved entry semantics with the external shortcut: %s / %s",
    (hostname, exchangeOwaMailbox, path) => {
      const input = {
        ...saved,
        hostname,
        httpApplication: { ...profile, exchangeOwaMailbox },
      };
      const initial = hostname.startsWith("https:") ? hostname : origin;
      const expected = `${origin}${path}`;
      expect(resolveExchangeOwaInitialUrl(initial, exchangeOwaMailbox)).toBe(
        expected,
      );
      const external = getHttpApplicationExternalTarget(
        input,
        `${origin}/live?token=do-not-copy#session`,
      );
      expect(external?.url).toBe(expected);
      expect(external?.url).not.toContain("do-not-copy");
      if (exchangeOwaMailbox?.trim())
        expect(new URL(expected).pathname).not.toContain("%");
    },
  );

  it("requires the exact saved HTTPS origin for external handoff", () => {
    const input = {
      ...saved,
      httpApplication: {
        ...profile,
        exchangeOwaMailbox: "shared@example.test",
      },
    };
    for (const target of [
      "http://mail.example.test:8443/",
      "https://mail.example.test/",
      "https://other.test:8443/",
      "https://user:pass@mail.example.test:8443/",
    ])
      expect(getHttpApplicationExternalTarget(input, target)).toBeNull();
    expect(() =>
      resolveExchangeOwaInitialUrl(
        "http://mail.example.test/",
        "shared@example.test",
      ),
    ).toThrow(/HTTPS/);
    expect(() =>
      resolveExchangeOwaInitialUrl(
        "https://user:pass@mail.example.test/",
        "shared@example.test",
      ),
    ).toThrow(/credentials/);
  });
});
