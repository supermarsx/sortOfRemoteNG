import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import {
  getHttpApplicationProfile,
  getHttpApplicationLoginModes,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { originBrowserConnectionTarget } from "../../src/hooks/protocol/originBrowserConnectionTarget";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { nativeBrowsingMode } from "../../src/utils/connection/nativeBrowsingDefaults";

const saved = (id: string, hostname: string, protocol = "https", port = 443) =>
  ({
    id: "fixture",
    protocol,
    hostname,
    port,
    username: "fixture@example.test",
    password: "synthetic-password",
    httpApplication: { version: 1, id, loginMode: "form" },
  }) as Connection;
const target = (connection: Connection) =>
  originBrowserConnectionTarget(
    connection,
    connection as unknown as ConnectionSession,
  );
function Fixture({ value }: { value: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(value);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application", "authentication"]}
      />
      <output data-testid="value">{JSON.stringify(formData)}</output>
    </>
  );
}
const state = () =>
  JSON.parse(screen.getByTestId("value").textContent!) as Connection;
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};

describe("Activepieces applications", () => {
  for (const [id, label] of [
    ["activepieces", "Activepieces Cloud"],
    ["activepieces-self-hosted", "Activepieces (self-hosted)"],
  ]) {
    it(`${id} provides native-only password assistance with no automatic MFA`, () => {
      const profile = getHttpApplicationProfile(id)!;
      expect(getHttpApplicationLoginModes(profile)).toEqual(["manual", "form"]);
      expect(profile.declarativeLoginMode).toBe("exclusive");
      expect(profile.totpChallenges).toBeUndefined();
      const connection = saved(
        id,
        id === "activepieces"
          ? "cloud.activepieces.com"
          : "automation.example.test",
      );
      expect(target(connection)).toBe(`https://${connection.hostname}/sign-in`);
      expect(getHttpApplicationIconSuggestion(connection)?.icon.key).toBe(
        "activepieces",
      );
      expect(() => resolveHttpApplicationLogin(connection)).toThrow(
        /native browser engine/,
      );
      connection.httpApplication!.loginMode = "manual";
      expect(resolveHttpApplicationLogin(connection).credentials).toBeNull();
    });

    it(`${id} selection preserves credentials, policy, address and icon while disarming login`, () => {
      const value = {
        ...saved("generic-form", "custom.example.test", "https", 9443),
        icon: "server",
        httpAutoLogin: true,
        httpVerifySsl: false,
        httpProxyPolicy: {
          version: 1,
          pageScripts: "block",
          nativeBrowsingMode: "restricted",
        },
      } as Partial<Connection>;
      render(<Fixture value={value} />);
      choose("Website application", label);
      expect(state()).toMatchObject({
        ...value,
        httpAutoLogin: false,
        httpApplication: { version: 1, id, loginMode: "manual" },
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(screen.getByLabelText("Activepieces email")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Activepieces password"),
      ).toBeInTheDocument();
      expect(document.querySelector("details")).toBeNull();
    });
  }

  it("fills a blank Cloud address and keeps normal browsing defaults", () => {
    render(<Fixture value={{ protocol: "http", hostname: "", port: 80 }} />);
    choose("Website application", "Activepieces Cloud");
    expect(state()).toMatchObject({
      protocol: "https",
      hostname: "cloud.activepieces.com",
      port: 443,
      httpApplication: { loginMode: "manual" },
    });
    expect(state().httpProxyPolicy).toBeUndefined();
    expect(nativeBrowsingMode(state().httpProxyPolicy)).toBe("standard");
  });

  it.each([
    ["http://127.0.0.1:8080", "http", 8080, "http://127.0.0.1:8080/sign-in"],
    ["http://[::1]:8080", "http", 8080, "http://[::1]:8080/sign-in"],
    [
      "automation.internal",
      "https",
      9443,
      "https://automation.internal:9443/sign-in",
    ],
    [
      "https://automation.example.test:9443/flows?view=all#recent",
      "https",
      9443,
      "https://automation.example.test:9443/flows?view=all#recent",
    ],
  ])(
    "preserves the configured self-hosted authority and URL: %s",
    (host, protocol, port, expected) => {
      const connection = saved(
        "activepieces-self-hosted",
        host,
        protocol,
        port,
      );
      expect(target(connection)).toBe(expected);
      expect(() =>
        validateHttpApplicationTarget(connection, expected),
      ).not.toThrow();
    },
  );

  it.each([
    "https://cloud.activepieces.com.evil.test/sign-in",
    "http://cloud.activepieces.com/sign-in",
    "https://cloud.activepieces.com:9443/sign-in",
  ])("refuses a noncanonical Cloud origin: %s", (url) => {
    expect(() =>
      validateHttpApplicationTarget(
        saved("activepieces", "cloud.activepieces.com"),
        url,
      ),
    ).toThrow();
  });

  it("rejects conflicting self-hosted scheme or port", () => {
    expect(() =>
      target(
        saved(
          "activepieces-self-hosted",
          "http://automation.internal:8080",
          "https",
          8080,
        ),
      ),
    ).toThrow();
    expect(() =>
      target(
        saved(
          "activepieces-self-hosted",
          "https://automation.internal:9443",
          "https",
          8443,
        ),
      ),
    ).toThrow();
  });
});
