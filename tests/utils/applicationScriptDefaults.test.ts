import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";
import {
  applicationScriptDefaultOrigin,
  applicationScriptsAllowed,
  setApplicationScriptPermission,
} from "../../src/utils/connection/applicationScriptDefaults";

const row = (
  id = "instagram",
  hostname = "www.instagram.com",
): Partial<Connection> => ({
  protocol: "https",
  hostname,
  port: 443,
  httpApplication: { version: 1, id, loginMode: "manual" },
});

describe("origin-bound application script defaults", () => {
  it.each([
    ["instagram", "www.instagram.com"],
    ["linkedin", "www.linkedin.com"],
    ["zoom", "zoom.us"],
  ])(
    "applies %s before normalization-produced false can hide the default",
    (id, hostname) => {
      const connection = row(id, hostname);
      const normalized = normalizeHttpProxyPolicy(undefined);
      expect(normalized.allowAllScripts).toBe(false);
      expect(applicationScriptsAllowed(connection, normalized, undefined)).toBe(
        true,
      );
      expect(
        applicationScriptsAllowed(
          { ...connection, httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY } },
          normalized,
          undefined,
        ),
      ).toBe(true);
      expect(connection.httpProxyPolicy).toBeUndefined();
    },
  );
  it("rejects unrelated profiles, source aliases, mismatched ports, HTTP and invalid application settings", () => {
    for (const connection of [
      row("generic-form"),
      row("instagram", "www.instagram.com.evil.test"),
      row("linkedin", "www.instagram.com"),
      { ...row(), protocol: "http" as const },
      { ...row(), port: 8443 },
      { ...row(), port: 0 },
      { ...row(), port: NaN },
      { ...row(), isGroup: true },
      { ...row(), hostname: "https://www.instagram.com:8443/login" },
      {
        ...row(),
        httpApplication: {
          version: 1 as const,
          id: "instagram",
          loginMode: "manual" as const,
          invalid: true as const,
        },
      },
    ]) {
      expect(applicationScriptDefaultOrigin(connection)).toBeNull();
    }
  });
  it("preserves explicit script-class denials and origin-only/page-script restrictions", () => {
    const permissions = {
      version: 1,
      websites: [
        {
          origin: "https://www.instagram.com",
          requestClasses: { script: "deny" },
          destinations: [],
        },
      ],
    };
    const policy = normalizeHttpProxyPolicy(undefined);
    expect(
      applicationScriptsAllowed(
        {
          ...row(),
          websiteDomainPermissions:
            permissions as Connection["websiteDomainPermissions"],
        },
        policy,
        undefined,
      ),
    ).toBe(false);
    expect(applicationScriptsAllowed(row(), policy, permissions)).toBe(false);
    expect(
      applicationScriptsAllowed(
        row(),
        { ...policy, sameOriginOnly: true },
        undefined,
      ),
    ).toBe(false);
    expect(
      applicationScriptsAllowed(
        row(),
        { ...policy, pageScripts: "block" },
        undefined,
      ),
    ).toBe(false);
  });
  it("persists an unambiguous class block and preserves individual destination blocks when explicitly reenabled", () => {
    const existing = {
      version: 1 as const,
      websites: [
        {
          origin: "https://www.instagram.com",
          requestClasses: { "fetch-xhr": "deny" as const },
          destinations: [
            {
              origin: "https://cdn.example",
              requestClasses: { script: "deny" as const },
            },
          ],
        },
      ],
    };
    const connection = { ...row(), websiteDomainPermissions: existing };
    const denied = setApplicationScriptPermission(connection, false);
    expect(denied.websites[0].requestClasses).toEqual({
      "fetch-xhr": "deny",
      script: "deny",
    });
    const allowed = setApplicationScriptPermission(
      { ...connection, websiteDomainPermissions: denied },
      true,
    );
    expect(allowed.websites[0].requestClasses.script).toBe("allow");
    expect(allowed.websites[0].destinations).toEqual(
      existing.websites[0].destinations,
    );
    expect(existing.websites[0].requestClasses).toEqual({
      "fetch-xhr": "deny",
    });
  });
});
