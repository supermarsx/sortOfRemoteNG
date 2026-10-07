import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import { GOOGLE_SERVICE_PROFILES } from "../../src/utils/connection/googleServiceProfiles";
import {
  FIRST_PARTY_GOOGLE_HTTP_APPLICATION_IDS,
  getFirstPartyGoogleHostedApplicationUrl,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";

function Fixture({ initial }: { initial: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(initial);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application"]}
      />
      <output data-testid="google-service-record">
        {JSON.stringify(formData)}
      </output>
    </>
  );
}

const read = () =>
  JSON.parse(
    screen.getByTestId("google-service-record").textContent!,
  ) as Partial<Connection>;

function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}

const manualLabel = "Manual browsing — no saved credentials sent";
const formLabel = "Automatic form login — explicitly opt in";
const credentials = {
  username: "google-fixture@example.test",
  password: "synthetic-google-password",
};

afterEach(cleanup);

describe("rendered Google service presets", () => {
  describe.each(GOOGLE_SERVICE_PROFILES)("$id", (profile) => {
    const target = new URL(profile.hostedLoginUrl!);

    it("registers the complete URL, fills a blank address, and requires a fresh login opt-in", () => {
      expect(getHttpApplicationProfile(profile.id)).toBe(profile);
      expect(FIRST_PARTY_GOOGLE_HTTP_APPLICATION_IDS).toContain(profile.id);
      expect(getFirstPartyGoogleHostedApplicationUrl(profile.id)).toBe(
        target.href,
      );
      expect(
        normalizeHttpApplicationSettings({ version: 1, id: profile.id }),
      ).toEqual({
        version: 1,
        id: profile.id,
        loginMode: "manual",
      });
      render(
        <Fixture
          initial={{
            protocol: "http",
            hostname: "",
            port: 80,
            icon: "star",
            httpVerifySsl: true,
            ...credentials,
            authType: "basic",
            httpApplication: {
              version: 1,
              id: "generic-form",
              loginMode: "form",
            },
            httpAutoLogin: true,
            httpAutoLoginSelectors: { passwordSelector: "#previous-app" },
            httpAutoMfa: { version: 1, enabled: true },
          }}
        />,
      );
      choose("Website application", profile.label);
      expect(read()).toMatchObject({
        protocol: "https",
        hostname: target.hostname,
        port: 443,
        icon: "star",
        httpVerifySsl: true,
        ...credentials,
        httpApplication: { version: 1, id: profile.id, loginMode: "manual" },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(read().httpAutoLoginSelectors).toBeUndefined();
      expect(
        screen.getByText(target.href, { exact: true }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Application login mode")).toHaveTextContent(
        manualLabel,
      );
      expect(resolveHttpApplicationLogin(read())).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
      expect(getReviewedApplicationProfile(read())).toBe("google-hosted");
      expect(() =>
        validateHttpApplicationTarget(read(), target.href),
      ).not.toThrow();

      choose("Application login mode", formLabel);
      expect(read().httpApplication?.loginMode).toBe("form");
      expect(resolveHttpApplicationLogin(read())).toEqual({
        credentials,
        upstreamAuthMode: "google-form",
        loginFlow: "google",
        autoLogin: true,
      });
      expect(getReviewedApplicationProfile(read())).toBe("google-hosted");
      expect(read().httpAutoMfa?.enabled).toBe(false);
      expect(() =>
        resolveHttpApplicationLogin({
          ...read(),
          httpAutoLoginSelectors: { passwordSelector: "#unreviewed" },
        }),
      ).toThrow(/does not accept selector overrides/);

      choose("Application login mode", manualLabel);
      expect(resolveHttpApplicationLogin(read())).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
    });

    it("preserves a custom authority until the explicit canonical-address action", () => {
      render(
        <Fixture
          initial={{
            protocol: "https",
            hostname: "custom.example.test",
            port: 9443,
            icon: "star",
            httpVerifySsl: false,
            ...credentials,
          }}
        />,
      );
      choose("Website application", profile.label);
      expect(read()).toMatchObject({
        protocol: "https",
        hostname: "custom.example.test",
        port: 9443,
        httpVerifySsl: false,
        icon: "star",
        httpApplication: { version: 1, id: profile.id, loginMode: "manual" },
      });
      expect(
        screen.getByText(target.href, { exact: true }),
      ).toBeInTheDocument();
      expect(() =>
        validateHttpApplicationTarget(
          read(),
          "https://custom.example.test:9443/",
        ),
      ).toThrow(/requires HTTPS/);
      fireEvent.click(
        screen.getByRole("button", {
          name: `Use ${profile.label} login address`,
        }),
      );
      expect(read()).toMatchObject({
        protocol: "https",
        hostname: target.hostname,
        port: 443,
        httpVerifySsl: false,
        icon: "star",
        ...credentials,
        httpApplication: { version: 1, id: profile.id, loginMode: "manual" },
      });
      expect(resolveHttpApplicationLogin(read()).credentials).toBeNull();
    });
  });

  it("switches Forms, Play Store and Play Console without losing their distinct entry paths", () => {
    render(
      <Fixture
        initial={{
          protocol: "https",
          hostname: "docs.google.com",
          port: 443,
          ...credentials,
          httpApplication: {
            version: 1,
            id: "google-forms",
            loginMode: "form",
          },
        }}
      />,
    );
    for (const [id, label, url] of [
      [
        "google-play-store",
        "Google Play Store",
        "https://play.google.com/store/",
      ],
      [
        "google-play-console",
        "Google Play Console",
        "https://play.google.com/console/",
      ],
      ["google-forms", "Google Forms", "https://docs.google.com/forms/"],
    ]) {
      choose("Website application", label);
      expect(read()).toMatchObject({
        hostname: new URL(url).hostname,
        port: 443,
        httpApplication: { version: 1, id, loginMode: "manual" },
      });
      expect(screen.getByText(url, { exact: true })).toBeInTheDocument();
      expect(
        getFirstPartyGoogleHostedApplicationUrl(read().httpApplication?.id),
      ).toBe(url);
      expect(resolveHttpApplicationLogin(read()).credentials).toBeNull();
      choose("Application login mode", formLabel);
    }
  });

  it("preserves an explicit full saved URL when switching presets on the same Play origin", () => {
    const hostname = "https://play.google.com/store/apps?hl=en#games";
    render(
      <Fixture
        initial={{
          protocol: "https",
          hostname,
          port: 443,
          httpApplication: {
            version: 1,
            id: "google-play-store",
            loginMode: "form",
          },
        }}
      />,
    );
    choose("Website application", "Google Play Console");
    expect(read().hostname).toBe(hostname);
    expect(read().httpApplication).toEqual({
      version: 1,
      id: "google-play-console",
      loginMode: "manual",
    });
    expect(
      screen.getByText("https://play.google.com/console/", { exact: true }),
    ).toBeInTheDocument();
  });
});
