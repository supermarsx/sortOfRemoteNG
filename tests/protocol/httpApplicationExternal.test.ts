import { describe, expect, it } from "vitest";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import type { Connection } from "../../src/types/connection/connection";
const connection = (
  id: string,
  hostname = "service.example.test",
): Partial<Connection> => ({
  protocol: "https",
  hostname,
  port: 443,
  httpApplication: { version: 1, id, loginMode: "manual" },
  username: "fixture-user",
  password: "fixture-password",
});
describe("safe true-origin browser handoff", () => {
  it.each([
    ["github", "github.com", "https://github.com/login"],
    ["brevo", "login.brevo.com", "https://login.brevo.com/"],
    ["gitea", "git.example.test", "https://git.example.test/user/login"],
    ["exchange-ecp", "mail.example.test", "https://mail.example.test/ecp/"],
    ["rdweb", "rds.example.test", "https://rds.example.test/RDWeb/"],
    ["drone-ci", "ci.example.test", "https://ci.example.test/"],
  ])(
    "%s uses only saved origin plus static login path",
    (id, hostname, url) => {
      expect(
        getHttpApplicationExternalTarget(
          connection(id, hostname),
          `https://${hostname}/callback?token=fixture#credential`,
        )?.url,
      ).toBe(url);
    },
  );
  it.each(["github", "brevo"])(
    "pins %s hosted credentials to its exact HTTPS origin",
    (id) => {
      const host = id === "github" ? "github.com" : "login.brevo.com";
      expect(() =>
        validateHttpApplicationTarget(connection(id, host), `https://${host}/`),
      ).not.toThrow();
      for (const url of [
        `http://${host}/`,
        `https://${host}:8443/`,
        `https://${host}.evil.test/`,
        `https://user:secret@${host}/`,
      ]) {
        expect(() =>
          validateHttpApplicationTarget(connection(id, host), url),
        ).toThrow(/requires HTTPS/);
        expect(
          getHttpApplicationExternalTarget(connection(id, host), url),
        ).toBeNull();
      }
    },
  );
  it("refuses stale authority, mixed scheme, userinfo and malformed saved metadata", () => {
    const saved = connection("gitea");
    for (const url of [
      "https://other.example.test/",
      "http://service.example.test/",
      "https://user:secret@service.example.test/",
      "not-url",
    ])
      expect(getHttpApplicationExternalTarget(saved, url)).toBeNull();
    expect(
      getHttpApplicationExternalTarget(
        { ...saved, hostname: "service.example.test/path?token=x" },
        "https://service.example.test/",
      ),
    ).toBeNull();
    expect(
      getHttpApplicationExternalTarget(
        { ...saved, protocol: "http" },
        "https://service.example.test/",
      ),
    ).toBeNull();
    expect(
      getHttpApplicationExternalTarget(
        { ...saved, port: 0 },
        "https://service.example.test/",
      ),
    ).toBeNull();
  });
  it("manual provider-dependent profiles do not forward old passwords, API tokens or Basic headers", () => {
    for (const id of ["drone-ci", "exchange-ecp", "rdweb"]) {
      expect(
        resolveHttpApplicationLogin({
          ...connection(id),
          authType: "basic",
          httpAutoLogin: true,
        }),
      ).toEqual({
        credentials: null,
        autoLogin: false,
        upstreamAuthMode: "none",
      });
      expect(() =>
        resolveHttpApplicationLogin({
          ...connection(id),
          httpApplication: { version: 1, id, loginMode: "form" },
        }),
      ).toThrow(/invalid/);
    }
  });
});
