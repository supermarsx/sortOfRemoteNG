import { describe, expect, it } from "vitest";
import {
  normalizeSynologySettings,
  setSynologyAccessMode,
  assertSynologyNativeRoute,
  isSynologyFileConnection,
} from "../../src/types/protocols/synology";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { normalizeImportedProtocol } from "../../src/utils/connection/normalizeImportedProtocol";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import {
  getRuntimeProtocolUnavailableMessage,
  UNAVAILABLE_RUNTIME_CAPABILITIES,
} from "../../src/utils/runtime/runtimeCapabilities";
import { getProtocolSubtabs } from "../../src/components/connection/editor/protocolSubtabs";

describe("saved Synology schema and access modes", () => {
  it("initializes versioned verified HTTPS without auth artifacts", () => {
    expect(
      normalizeAdvancedProtocolConnection({
        protocol: "SYNOLOGY",
        isGroup: false,
      }),
    ).toMatchObject({
      protocol: "synology",
      port: 5001,
      synologySettings: { version: 1, useHttps: true },
    });
    expect(normalizeImportedProtocol({ raw: "synology" }).protocol).toBe(
      "synology",
    );
    for (const extra of [
      { otpCode: "123456" },
      { password: "secret" },
      { sessionId: "sid" },
    ])
      expect(() =>
        normalizeSynologySettings({ version: 1, useHttps: true, ...extra }),
      ).toThrow();
  });
  it("preserves explicit routes and trust across mode changes, refusing unsupported native use", () => {
    const source = {
      protocol: "synology" as const,
      hostname: "nas.example.test",
      port: 5001,
      username: "user",
      password: "secret",
      proxyChainId: "route",
      httpsTrustPolicy: "strict" as const,
    };
    const website = setSynologyAccessMode(source, "website");
    expect(website).toMatchObject({
      ...source,
      protocol: "https",
      httpApplication: { id: "synology-dsm", loginMode: "manual" },
    });
    const native = setSynologyAccessMode(website, "native");
    expect(native).toMatchObject({
      ...source,
      protocol: "https",
      synologySettings: { accessMode: "native" },
    });
    expect(isSynologyFileConnection(native)).toBe(true);
    expect(isSynologyFileConnection(website)).toBe(false);
    expect(() => assertSynologyNativeRoute(native)).toThrow(/proxy\/VPN/);
    expect(() =>
      assertSynologyNativeRoute({ httpsTrustPolicy: "always-trust" }),
    ).toThrow(/trust/);
    expect(() => assertSynologyNativeRoute({})).not.toThrow();
  });
  it("defaults DSM website login to manual, requires explicit reviewed form opt-in, and keeps native capability dual-gated", () => {
    expect(getHttpApplicationProfile("synology-dsm")).toMatchObject({
      capability: "known-form",
      loginModes: ["manual", "form"],
      loginFlow: "synology",
      requiresHttps: true,
    });
    const defaults = normalizeHttpApplicationSettings({
      version: 1,
      id: "synology-dsm",
    })!;
    expect(defaults.loginMode).toBe("manual");
    expect(
      resolveHttpApplicationLogin({
        protocol: "https",
        httpApplication: defaults,
        username: "user",
        password: "secret",
        httpAutoLogin: true,
      }),
    ).toMatchObject({
      autoLogin: false,
      credentials: null,
      upstreamAuthMode: "none",
    });
    expect(
      resolveHttpApplicationLogin({
        protocol: "https",
        httpApplication: {
          version: 1,
          id: "synology-dsm",
          loginMode: "manual",
        },
        username: "user",
        password: "secret",
        httpAutoLogin: true,
      }),
    ).toMatchObject({
      autoLogin: false,
      credentials: null,
      upstreamAuthMode: "none",
    });
    expect(
      resolveHttpApplicationLogin({
        protocol: "https",
        httpApplication: { ...defaults, loginMode: "form" },
        username: "user",
        password: "secret",
      }),
    ).toMatchObject({
      autoLogin: true,
      credentials: { username: "user", password: "secret" },
      upstreamAuthMode: "synology-form",
      loginFlow: "synology",
    });
    expect(
      getProtocolSubtabs({ protocol: "synology" }).map((tab) => tab.id),
    ).toEqual(["connection", "recovery"]);
    expect(
      getRuntimeProtocolUnavailableMessage("synology", {
        ...UNAVAILABLE_RUNTIME_CAPABILITIES,
        ops: true,
        source: "native",
      }),
    ).toContain("platform");
    expect(
      getRuntimeProtocolUnavailableMessage("synology", {
        ...UNAVAILABLE_RUNTIME_CAPABILITIES,
        ops: true,
        platform: true,
        source: "native",
      }),
    ).toBeNull();
  });
});
