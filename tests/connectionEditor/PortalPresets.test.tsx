import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import type { HttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
import { PORTUGAL_PORTAL_PROFILES } from "../../src/utils/connection/portugalPortalProfiles";
import { INTERNATIONAL_PORTAL_PROFILES } from "../../src/utils/connection/internationalPortalProfiles";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";

// Exercise the registered options through the real editor. Google service
// presets and central catalog counts belong to other suites/owners.
const profiles = [
  ...PORTUGAL_PORTAL_PROFILES,
  ...INTERNATIONAL_PORTAL_PROFILES,
];
const hostedProfiles = profiles.filter((profile) => profile.hostedLoginUrl);
const tenantProfiles = profiles.filter((profile) => !profile.hostedLoginUrl);
const manualLabel = "Manual browsing — no saved credentials sent";

function Fixture({ initial }: { initial: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(initial);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application"]}
      />
      <output data-testid="portal-draft">{JSON.stringify(formData)}</output>
    </>
  );
}

const draft = () =>
  JSON.parse(
    screen.getByTestId("portal-draft").textContent!,
  ) as Partial<Connection>;

function selectProfile(profile: HttpApplicationProfile) {
  fireEvent.click(screen.getByLabelText("Website application"));
  fireEvent.mouseDown(screen.getByRole("option", { name: profile.label }));
}

const protectedSettings = (): Partial<Connection> => ({
  username: "fixture-user",
  password: "fixture-password",
  basicAuthUsername: "fixture-web-user",
  basicAuthPassword: "fixture-web-password",
  credentialSource: { kind: "local" },
  icon: "star",
  httpVerifySsl: false,
  httpHeaders: { "X-Fixture": "keep-this-header" },
  httpRedirectAuthentication: {
    version: 1,
    mode: "none",
    allowInsecureHttp: false,
  },
  httpTrustedRedirectDestinations: {
    version: 1,
    origins: ["https://approved.example.test"],
  },
  httpProxyPolicy: {
    version: 1,
    pageScripts: "block",
    allowAllScripts: false,
    allowAllRequests: false,
    httpsOnly: true,
    sameOriginOnly: true,
    allowExternalFonts: false,
    externalFontOrigins: [],
    externalResourceOrigins: [],
    allowCrossOriginRedirects: false,
    allowHttpDowngradeRedirects: false,
    cacheMode: "bypass",
    queryParameters: [],
  },
  proxyProfileId: "fixture-proxy-route",
});

function expectManualSelection(profile: HttpApplicationProfile) {
  expect(draft().httpApplication).toEqual({
    version: 1,
    id: profile.id,
    loginMode: "manual",
  });
  expect(draft().httpAutoLogin).toBe(false);
  expect(draft().httpAutoLoginSelectors).toBeUndefined();
  // Changing the application revokes stale automatic-MFA consent; it must
  // never transfer that grant to a new portal or enable a new challenge.
  expect(draft().httpAutoMfa).toEqual({ version: 1, enabled: false });
  expect(resolveHttpApplicationLogin(draft())).toEqual({
    credentials: null,
    upstreamAuthMode: "none",
    autoLogin: false,
  });
  expect(screen.getByLabelText("Application login mode")).toHaveTextContent(
    manualLabel,
  );
  expect(screen.queryByLabelText("Website password")).not.toBeInTheDocument();
}

function expectHostedAddress(profile: HttpApplicationProfile) {
  const canonical = new URL(profile.hostedLoginUrl!);
  expect(draft()).toMatchObject({
    protocol: "https",
    hostname: canonical.hostname,
    port: Number(canonical.port || 443),
  });
  // Inspect actual saved authority fields, not the explanatory URL text.
  expect(
    new URL(`${draft().protocol}://${draft().hostname}:${draft().port}`).origin,
  ).toBe(canonical.origin);
}

describe("Portugal and international portal editor integration", () => {
  it.each(hostedProfiles)(
    "$id fills a blank host and offers an explicit address action without changing protected settings",
    (profile) => {
      for (const hostname of ["", " \t "]) {
        const preserved = protectedSettings();
        const view = render(
          <Fixture
            initial={{
              ...preserved,
              hostname,
              protocol: "http",
              port: 8080,
              httpAutoLogin: true,
              httpAutoLoginSelectors: { passwordSelector: "#stale-secret" },
              httpAutoMfa: {
                version: 1,
                enabled: true,
                origin: "https://old.example.test",
                totpConfigId: "old-authenticator",
                challengeId: "old-challenge",
              },
            }}
          />,
        );
        selectProfile(profile);
        expectHostedAddress(profile);
        expectManualSelection(profile);
        expect(draft()).toMatchObject(preserved);
        fireEvent.click(
          screen.getByRole("button", {
            name: `Use ${profile.label} login address`,
          }),
        );
        expectHostedAddress(profile);
        expectManualSelection(profile);
        expect(draft()).toMatchObject(preserved);
        view.unmount();
      }
    },
  );

  it.each(hostedProfiles)(
    "$id preserves a populated custom URL until Use address is clicked",
    (profile) => {
      const preserved: Partial<Connection> = {
        ...protectedSettings(),
        httpVerifySsl: true,
        credentialSource: {
          kind: "vault",
          credentialId: "00000000-0000-4000-8000-000000000001",
          totpId: "00000000-0000-4000-8000-000000000002",
        },
      };
      const customAddress = {
        hostname: "http://custom.example.test:9443/my/portal?view=saved#tab",
        protocol: "http" as const,
        port: 9443,
      };
      render(
        <Fixture
          initial={{
            ...preserved,
            ...customAddress,
            httpAutoMfa: { version: 1, enabled: false },
          }}
        />,
      );
      selectProfile(profile);
      expect(draft()).toMatchObject({ ...preserved, ...customAddress });
      expectManualSelection(profile);
      fireEvent.click(
        screen.getByRole("button", {
          name: `Use ${profile.label} login address`,
        }),
      );
      expectHostedAddress(profile);
      expectManualSelection(profile);
      expect(draft()).toMatchObject(preserved);
    },
  );

  it.each(tenantProfiles)(
    "$id preserves blank and configured tenant addresses without inventing a hosted destination",
    (profile) => {
      for (const hostname of [
        "",
        "tenant.example.test",
        "https://tenant.example.test:9443/deployment/frontend/?view=saved#tab",
      ]) {
        const preserved = protectedSettings();
        const address = { hostname, protocol: "https" as const, port: 9443 };
        const view = render(<Fixture initial={{ ...preserved, ...address }} />);
        selectProfile(profile);
        expect(draft()).toMatchObject({ ...preserved, ...address });
        expectManualSelection(profile);
        expect(
          screen.queryByRole("button", {
            name: `Use ${profile.label} login address`,
          }),
        ).not.toBeInTheDocument();
        view.unmount();
      }
    },
  );

  it.each(profiles)(
    "$id exposes only its actual supported login modes, with manual selected",
    (profile) => {
      render(
        <Fixture initial={{ hostname: "", protocol: "https", port: 443 }} />,
      );
      selectProfile(profile);
      expectManualSelection(profile);
      fireEvent.click(screen.getByLabelText("Application login mode"));
      const modes = screen
        .getAllByRole("option")
        .map((node) => node.textContent);
      // The finalized international array, including Zabbix, is manual-only.
      expect(profile.capability).toBe("manual");
      expect(modes).toEqual([manualLabel]);
    },
  );
});
