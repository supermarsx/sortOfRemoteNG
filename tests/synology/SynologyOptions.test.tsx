import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import HTTPOptions from "../../src/components/connectionEditor/HTTPOptions";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";
import {
  anonymousRedirectConnection,
  parseHttpRedirectReview,
} from "../../src/utils/protocol/httpRedirectReview";
import { normalizeSynologySettings } from "../../src/types/protocols/synology";
import { DEVICE_TRUST_VAULT_REQUIRED_MESSAGE } from "../../src/utils/security/runtimeCredentialVault";

afterEach(cleanup);
function Editor({
  seed = {},
  advanced = false,
}: {
  seed?: Partial<Connection>;
  advanced?: boolean;
}) {
  const [data, setData] = useState<Partial<Connection>>({
    protocol: "https",
    hostname: "nas.example.test",
    port: 5001,
    httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
    ...seed,
  });
  return (
    <>
      <HTTPOptions
        formData={data}
        setFormData={setData}
        sections={advanced ? ["application", "advanced"] : ["application"]}
      />
      <output data-testid="saved-shape">{JSON.stringify(data)}</output>
    </>
  );
}
function selectMode(name: string) {
  fireEvent.click(
    screen.getByRole("combobox", { name: "Synology access mode" }),
  );
  fireEvent.mouseDown(screen.getByRole("option", { name }));
}
it("themes the DSM API password exactly like its username with protected reveal spacing", () => {
  render(<Editor />);
  selectMode("Synology NAS API");
  const password = screen.getByLabelText("DSM API password");
  expect(password).toHaveClass("sor-form-input");
  expect(screen.getByLabelText("DSM API username")).toHaveClass(
    "sor-form-input",
  );
  expect(password).toHaveAttribute("type", "password");
  expect(password).toHaveAttribute("autocomplete", "new-password");
  expect(password).toHaveStyle({ paddingRight: "2.25rem" });
});
const savedShape = () =>
  JSON.parse(screen.getByTestId("saved-shape").textContent!);
describe("Synology HTTP application views", () => {
  it("offers safe reviewed redirects off by default without enabling downgrades", () => {
    render(<Editor advanced />);
    const alias = screen.getByRole("checkbox", {
      name: "Allow reviewed redirects to another address",
    });
    expect(alias).not.toBeChecked();
    expect(savedShape().httpProxyPolicy).toBeUndefined();
    fireEvent.click(alias);
    expect(savedShape().httpProxyPolicy).toEqual({
      ...DEFAULT_HTTP_PROXY_POLICY,
      allowCrossOriginRedirects: true,
    });
    expect(savedShape().httpRedirectAuthentication).toBeUndefined();
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: /^Allow reviewed cross-origin redirects/,
      }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /^Allow reviewed cross-origin redirects/,
      }),
    );
    expect(alias).not.toBeChecked();
  });
  it("roundtrips the safe alias with Advanced while preserving strict HTTPS and other policy", () => {
    const policy = {
      ...DEFAULT_HTTP_PROXY_POLICY,
      httpsOnly: true,
      cacheMode: "bypass" as const,
      queryParameters: [{ name: "tenant", value: "synthetic" }],
    };
    const { unmount } = render(
      <Editor seed={{ httpProxyPolicy: policy }} advanced />,
    );
    const alias = screen.getByRole("checkbox", {
      name: "Allow reviewed redirects to another address",
    });
    expect(alias).toBeEnabled();
    fireEvent.click(alias);
    const saved = savedShape();
    expect(saved.httpProxyPolicy).toEqual({
      ...policy,
      allowCrossOriginRedirects: true,
    });
    unmount();
    render(<Editor seed={JSON.parse(JSON.stringify(saved))} advanced />);
    expect(
      screen.getByRole("checkbox", {
        name: "Allow reviewed redirects to another address",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Allow reviewed redirects to another address",
      }),
    );
    expect(savedShape().httpProxyPolicy).toEqual(policy);
  });
  it("starts as a website and switches to an API explorer without inventing a protocol", () => {
    render(<Editor />);
    expect(
      screen.getByRole("combobox", { name: "Synology access mode" }),
    ).toHaveTextContent("Website");
    expect(screen.queryByLabelText("DSM API password")).not.toBeInTheDocument();
    selectMode("Synology NAS API");
    expect(
      screen.getByRole("combobox", { name: "Synology access mode" }),
    ).toHaveTextContent("Synology NAS API");
    expect(
      screen.getByText(
        /provides File Station and supported NAS administration/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("synology-authenticator-section"),
    ).toBeInTheDocument();
    expect(savedShape()).toMatchObject({
      protocol: "https",
      hostname: "nas.example.test",
      port: 5001,
      synologySettings: { accessMode: "native" },
      httpAutoLogin: false,
    });
    fireEvent.change(screen.getByLabelText("DSM API username"), {
      target: { value: "dsm-user" },
    });
    fireEvent.change(screen.getByLabelText("DSM API password"), {
      target: { value: "synthetic-secret" },
    });
    expect(savedShape()).toMatchObject({
      basicAuthUsername: "dsm-user",
      basicAuthPassword: "synthetic-secret",
    });
    selectMode("Website — DSM in browser");
    expect(savedShape()).toMatchObject({
      protocol: "https",
      port: 5001,
      synologySettings: { accessMode: "website" },
      httpApplication: { loginMode: "manual" },
      basicAuthPassword: "synthetic-secret",
    });
    expect(screen.queryByLabelText("DSM API password")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("synology-authenticator-section"),
    ).not.toBeInTheDocument();
  });
  it("describes automatic one-time codes instead of interactive-only prompts", () => {
    render(<Editor />);
    expect(screen.queryByTestId("synology-authenticator-section")).toBeNull();
    selectMode("Synology NAS API");
    const copy = screen.getByText(
      /provides File Station and supported NAS administration/,
    );
    expect(copy).toHaveTextContent(
      "After DSM asks for a code, the app generates one from the selected authenticator and submits it once; if it's rejected, or no authenticator is selected, you're asked to type a code. One-time codes are never saved; the authenticator secret is stored with this connection's credentials like the DSM password, and database exports remove it.",
    );
    expect(copy).not.toHaveTextContent(/asks for one-time codes interactively/);
  });
  it("follows the selected HTTP transport, retaining a custom NAS port", () => {
    render(
      <Editor
        seed={{
          protocol: "http",
          port: 5443,
          synologySettings: {
            version: 1,
            useHttps: true,
            accessMode: "native",
          },
        }}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Synology transport" }),
    ).toHaveTextContent("HTTP — unencrypted");
    fireEvent.click(
      screen.getByRole("combobox", { name: "Synology transport" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "HTTPS — verified system certificates",
      }),
    );
    expect(savedShape()).toMatchObject({
      protocol: "https",
      port: 5443,
      synologySettings: { useHttps: true, accessMode: "native" },
    });
  });
  it("defaults the website alias off and persists only the existing proxy-policy permissions", () => {
    const initial = {
      basicAuthUsername: "alice",
      basicAuthPassword: "synthetic-secret",
      httpVerifySsl: true,
      httpProxyPolicy: {
        ...DEFAULT_HTTP_PROXY_POLICY,
        pageScripts: "inline-only" as const,
        cacheMode: "bypass" as const,
        queryParameters: [{ name: "tenant", value: "example" }],
      },
    };
    const { unmount } = render(<Editor seed={initial} advanced />);
    const alias = screen.getByRole("checkbox", {
      name: "Allow insecure redirects",
    });
    expect(alias).not.toBeChecked();
    fireEvent.click(alias);
    const saved = savedShape();
    expect(saved).toMatchObject({
      ...initial,
      httpProxyPolicy: {
        ...initial.httpProxyPolicy,
        allowCrossOriginRedirects: true,
        allowHttpDowngradeRedirects: true,
      },
    });
    expect(
      screen.getByRole("checkbox", {
        name: /^Allow reviewed cross-origin redirects/,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: /^Allow reviewed HTTPS-to-HTTP downgrades/,
      }),
    ).toBeChecked();
    expect(saved.synologySettings).toBeUndefined();
    expect(normalizeHttpProxyPolicy(saved.httpProxyPolicy)).toEqual(
      saved.httpProxyPolicy,
    );
    unmount();
    render(<Editor seed={JSON.parse(JSON.stringify(saved))} />);
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    );
    expect(savedShape().httpProxyPolicy).toEqual({
      ...saved.httpProxyPolicy,
      allowHttpDowngradeRedirects: false,
    });
  });
  it("reflects the Advanced checkbox and never turns strict HTTPS protection off", () => {
    render(
      <Editor
        advanced
        seed={{
          httpProxyPolicy: {
            ...DEFAULT_HTTP_PROXY_POLICY,
            allowCrossOriginRedirects: true,
          },
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /^Allow reviewed HTTPS-to-HTTP downgrades/,
      }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^Require HTTPS upstream/ }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/takes precedence. This checkbox/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    );
    expect(savedShape().httpProxyPolicy.httpsOnly).toBe(true);
  });
  it("keeps malformed saved policies blocked instead of resetting security through the alias", () => {
    const invalid = {
      ...DEFAULT_HTTP_PROXY_POLICY,
      httpsOnly: "invalid",
    } as unknown as Connection["httpProxyPolicy"];
    render(<Editor seed={{ httpProxyPolicy: invalid }} />);
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "saved proxy controls are invalid",
    );
    expect(savedShape().httpProxyPolicy).toEqual(invalid);
    expect(
      screen.getByRole("checkbox", {
        name: "Allow reviewed redirects to another address",
      }),
    ).toBeDisabled();
  });
  it.each([
    { protocol: "ssh" as const },
    { protocol: "synology" as const },
    {
      httpApplication: {
        version: 1 as const,
        id: "gitea",
        loginMode: "manual" as const,
      },
    },
    {
      synologySettings: {
        version: 1 as const,
        useHttps: true,
        accessMode: "native" as const,
      },
    },
  ])(
    "does not expose the website exception outside HTTP(S) DSM website mode: %j",
    (seed) => {
      render(<Editor seed={seed} />);
      expect(
        screen.queryByRole("checkbox", { name: "Allow insecure redirects" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("checkbox", {
          name: "Allow reviewed redirects to another address",
        }),
      ).not.toBeInTheDocument();
    },
  );
  it("hides the website alias when switching to NAS API without altering the stored browser policy", () => {
    render(<Editor />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    );
    const policy = savedShape().httpProxyPolicy;
    selectMode("Synology NAS API");
    expect(
      screen.queryByRole("checkbox", { name: "Allow insecure redirects" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /website redirect exception does not apply to the NAS API/,
      ),
    ).toBeInTheDocument();
    expect(savedShape().httpProxyPolicy).toEqual(policy);
    expect(
      screen.queryByRole("checkbox", {
        name: "Allow reviewed redirects to another address",
      }),
    ).not.toBeInTheDocument();
    selectMode("Website — DSM in browser");
    expect(
      screen.getByRole("checkbox", {
        name: "Allow reviewed redirects to another address",
      }),
    ).toBeChecked();
    expect(savedShape().httpProxyPolicy).toEqual(policy);
  });
  it("maps the explicit choice to the existing anonymous reviewed handoff, not credential forwarding", () => {
    render(
      <Editor
        seed={{
          basicAuthUsername: "alice",
          basicAuthPassword: "synthetic-secret",
          httpHeaders: { "X-Example": "private" },
        }}
      />,
    );
    const review = {
      receiptId: "12345678-1234-1234-1234-123456789abc",
      sessionId: "session-a",
      sourceOrigin: "https://nas.example.test:5001",
      destinationUrl: "http://nas.example.test:5000/",
      navigationToken: null,
      documentSequence: 1,
      removedQuery: false,
    };
    expect(
      parseHttpRedirectReview(
        review,
        review.sessionId,
        review.sourceOrigin,
        normalizeHttpProxyPolicy(savedShape().httpProxyPolicy),
      ),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    );
    const source = savedShape() as Connection;
    expect(
      parseHttpRedirectReview(
        review,
        review.sessionId,
        review.sourceOrigin,
        source.httpProxyPolicy,
      ),
    ).toEqual(review);
    const target = anonymousRedirectConnection(source, review);
    expect(target).toMatchObject({
      protocol: "http",
      hostname: "nas.example.test",
      port: 5000,
      httpAutoLogin: false,
      httpVerifySsl: true,
      httpsTrustPolicy: "inherit",
    });
    expect(target.basicAuthUsername).toBeUndefined();
    expect(target.basicAuthPassword).toBeUndefined();
    expect(target.httpHeaders).toBeUndefined();
    expect(target.httpApplication).toBeUndefined();
    expect(target.httpProxyPolicy?.queryParameters).toEqual([]);
    expect(
      parseHttpRedirectReview(review, review.sessionId, review.sourceOrigin, {
        ...source.httpProxyPolicy!,
        httpsOnly: true,
      }),
    ).toBeNull();
  });
});
describe("Synology NAS API trusted-device preference", () => {
  const nativeSeed: Partial<Connection> = {
    protocol: "https",
    synologySettings: { version: 1, useHttps: true, accessMode: "native" },
  };
  const vaultSeed: Partial<Connection> = {
    ...nativeSeed,
    credentialSource: {
      kind: "vault",
      credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  };
  const preference = () =>
    screen.getByRole("checkbox", {
      name: "Trust this device after a successful two-factor sign-in",
    });
  it("saves an opt-in preference for vault connections and keeps it across transport changes", () => {
    render(<Editor seed={vaultSeed} />);
    expect(preference()).toBeEnabled();
    expect(preference()).not.toBeChecked();
    expect(screen.getByText(/Off by default\./)).toBeInTheDocument();
    expect(savedShape().synologySettings).not.toHaveProperty("trustDevice");
    fireEvent.click(preference());
    expect(preference()).toBeChecked();
    const saved = savedShape().synologySettings;
    expect(saved).toEqual({
      version: 1,
      useHttps: true,
      accessMode: "native",
      trustDevice: true,
    });
    expect(normalizeSynologySettings(saved)).toEqual(saved);
    fireEvent.click(
      screen.getByRole("combobox", { name: "Synology transport" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "HTTP — unencrypted (trusted networks only)",
      }),
    );
    expect(savedShape().synologySettings).toEqual({
      version: 1,
      useHttps: false,
      accessMode: "native",
      trustDevice: true,
    });
    fireEvent.click(preference());
    // Off is stored as the pre-existing shape, not an extra key.
    expect(savedShape().synologySettings).toEqual({
      version: 1,
      useHttps: false,
      accessMode: "native",
    });
  });
  it("keeps the NAS API authenticator reference and the trusted-device preference across transport changes", () => {
    const settings = {
      version: 1 as const,
      useHttps: true,
      accessMode: "native" as const,
      trustDevice: true,
      otpAuthenticatorId: "dsm-authenticator",
    };
    render(
      <Editor
        seed={{
          ...nativeSeed,
          synologySettings: settings,
          totpConfigs: [
            {
              id: "dsm-authenticator",
              secret: "JBSWY3DPEHPK3PXP",
              issuer: "Synology DSM",
              account: "admin",
              digits: 6,
              period: 30,
              algorithm: "sha1",
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "NAS API authenticator" }),
    ).toHaveTextContent("Synology DSM — admin");
    for (const [option, useHttps] of [
      ["HTTP — unencrypted (trusted networks only)", false],
      ["HTTPS — verified system certificates", true],
    ] as const) {
      fireEvent.click(
        screen.getByRole("combobox", { name: "Synology transport" }),
      );
      fireEvent.mouseDown(screen.getByRole("option", { name: option }));
      expect(savedShape().synologySettings).toEqual({ ...settings, useHttps });
    }
    expect(normalizeSynologySettings(savedShape().synologySettings)).toEqual(
      settings,
    );
    // Switching views keeps the reference for the next NAS API sign-in.
    selectMode("Website — DSM in browser");
    expect(savedShape().synologySettings).toEqual({
      ...settings,
      accessMode: "website",
    });
    selectMode("Synology NAS API");
    expect(savedShape().synologySettings).toEqual(settings);
  });
  it("is disabled with guidance for local credentials, even when a preference was saved", () => {
    render(
      <Editor
        seed={{
          ...nativeSeed,
          synologySettings: {
            version: 1,
            useHttps: true,
            accessMode: "native",
            trustDevice: true,
          },
        }}
      />,
    );
    expect(preference()).toBeDisabled();
    expect(preference()).not.toBeChecked();
    expect(
      screen.getByText(DEVICE_TRUST_VAULT_REQUIRED_MESSAGE),
    ).toBeInTheDocument();
    fireEvent.click(preference());
    expect(savedShape().synologySettings.trustDevice).toBe(true);
    selectMode("Website — DSM in browser");
    expect(
      screen.queryByRole("checkbox", {
        name: "Trust this device after a successful two-factor sign-in",
      }),
    ).not.toBeInTheDocument();
  });
});
