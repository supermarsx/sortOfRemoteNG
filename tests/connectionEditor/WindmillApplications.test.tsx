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
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";

const saved = (id = "windmill", hostname = "app.windmill.dev") =>
  ({
    id: "windmill-fixture",
    protocol: "https",
    hostname,
    port: 443,
    username: "fixture@example.test",
    password: "fixture-secret",
    httpApplication: { version: 1, id, loginMode: "manual" },
  }) as Connection;
const target = (connection: Connection) =>
  originBrowserConnectionTarget(connection, {
    ...connection,
    id: "tab",
    connectionId: connection.id,
    status: "connected",
    startTime: new Date(),
  } as ConnectionSession);

describe("Windmill application presets", () => {
  it.each(["windmill", "windmill-self-hosted"])(
    "%s offers exclusive native password assistance and the publisher icon",
    (id) => {
      const profile = getHttpApplicationProfile(id)!;
      expect(getHttpApplicationLoginModes(profile)).toEqual(["manual", "form"]);
      expect(profile.declarativeLoginMode).toBe("exclusive");
      expect(profile.totpChallenges).toBeUndefined();
      expect(profile.selectors).toBeUndefined();
      expect(getHttpApplicationIconSuggestion(saved(id))?.icon.key).toBe(
        "windmill",
      );
      expect(resolveHttpApplicationLogin(saved(id)).credentials).toBeNull();
      expect(() =>
        resolveHttpApplicationLogin({
          ...saved(id),
          httpApplication: { version: 1, id, loginMode: "form" },
        }),
      ).toThrow(/native browser engine/);
    },
  );

  it("pins cloud credentials to the exact HTTPS origin", () => {
    expect(target(saved())).toBe("https://app.windmill.dev/user/login");
    expect(
      getHttpApplicationProfile("windmill")?.declarativeLogin
        ?.credentialOrigins,
    ).toEqual(["https://app.windmill.dev"]);
    for (const url of [
      "https://app.windmill.dev.evil.test/user/login",
      "http://app.windmill.dev/user/login",
      "https://app.windmill.dev:8443/user/login",
    ]) {
      expect(() => validateHttpApplicationTarget(saved(), url)).toThrow(
        /requires HTTPS/,
      );
    }
  });

  it.each([
    ["http", "127.0.0.1", 8000, "http://127.0.0.1:8000/user/login"],
    ["http", "[::1]", 8080, "http://[::1]:8080/user/login"],
    [
      "https",
      "windmill.example.test",
      8443,
      "https://windmill.example.test:8443/user/login",
    ],
    [
      "https",
      "https://windmill.example.test:8443/apps/example?theme=dark#view",
      8443,
      "https://windmill.example.test:8443/apps/example?theme=dark#view",
    ],
  ] as const)(
    "preserves configured %s origin %s and port %s",
    (protocol, hostname, port, expected) => {
      const connection = {
        ...saved("windmill-self-hosted", hostname),
        protocol,
        port,
      } as Connection;
      expect(target(connection)).toBe(expected);
      expect(() =>
        validateHttpApplicationTarget(connection, expected),
      ).not.toThrow();
    },
  );

  it("does not turn a configured HTTP instance into redirect or downgrade consent", () => {
    const connection = {
      ...saved("windmill-self-hosted", "127.0.0.1"),
      protocol: "http",
      port: 8000,
    } as Connection;
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "http://127.0.0.1:8001/user/login",
      ),
    ).toThrow();
    expect(() =>
      validateHttpApplicationTarget(
        {
          ...connection,
          httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY, httpsOnly: true },
        },
        target(connection),
      ),
    ).toThrow();
  });

  it.each([
    ["Windmill", "windmill", "", "app.windmill.dev", 443],
    [
      "Windmill",
      "windmill",
      "custom.example.test",
      "custom.example.test",
      8443,
    ],
    [
      "Windmill (self-hosted)",
      "windmill-self-hosted",
      "custom.example.test",
      "custom.example.test",
      8443,
    ],
  ])(
    "selecting %s preserves account, permissions, and explicit addresses",
    (label, id, hostname, expectedHost, expectedPort) => {
      function Fixture() {
        const [formData, setFormData] = React.useState<Partial<Connection>>({
          ...saved("generic-form", hostname as string),
          port: 8443,
          icon: "server",
          httpAutoLogin: true,
          httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
        });
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
      const { container } = render(<Fixture />);
      fireEvent.click(screen.getByLabelText("Website application"));
      fireEvent.mouseDown(
        screen.getByRole("option", { name: label as string }),
      );
      expect(
        JSON.parse(screen.getByTestId("value").textContent!),
      ).toMatchObject({
        hostname: expectedHost,
        port: expectedPort,
        username: "fixture@example.test",
        password: "fixture-secret",
        icon: "server",
        httpApplication: { id, loginMode: "manual" },
        httpAutoLogin: false,
        httpAutoMfa: { enabled: false },
        httpProxyPolicy: DEFAULT_HTTP_PROXY_POLICY,
      });
      expect(container.querySelector("details")).toBeNull();
      expect(
        screen.getByText(/Log in without third-party/),
      ).toBeInTheDocument();
    },
  );
});
