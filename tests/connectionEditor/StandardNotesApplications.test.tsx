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
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { originBrowserConnectionTarget } from "../../src/hooks/protocol/originBrowserConnectionTarget";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";

const presets = [
  [
    "standard-notes",
    "Standard Notes",
    "app.standardnotes.com",
    "standard-notes",
  ],
  [
    "standard-notes-self-hosted",
    "Standard Notes (self-hosted)",
    "notes.example.test",
    "standard-notes",
  ],
  [
    "standard-red-notes",
    "Standard Red Notes",
    "red.example.test",
    "standard-red-notes",
  ],
] as const;
const saved = (
  id: string,
  hostname: string,
  loginMode: "manual" | "form" = "form",
) =>
  ({
    id: "notes",
    protocol: "https",
    hostname,
    port: 443,
    username: "fixture@example.test",
    password: "fixture-secret",
    httpApplication: { version: 1, id, loginMode },
  }) as Connection;
const tab = (connection: Connection) =>
  ({
    ...connection,
    id: "tab",
    connectionId: connection.id,
    status: "connected",
    startTime: new Date(),
  }) as ConnectionSession;

describe("Standard Notes application presets", () => {
  it.each(presets)(
    "%s has an exact native SPA plan and its own icon",
    (id, _label, hostname, icon) => {
      const profile = getHttpApplicationProfile(id)!;
      expect(getHttpApplicationLoginModes(profile)).toEqual(["manual", "form"]);
      expect(profile.declarativeLoginMode).toBe("exclusive");
      expect(profile.declarativeLogin?.loginSteps).toEqual([
        expect.objectContaining({
          kind: "form",
          paths: ["/", "/index.html", "/popup.html"],
        }),
        expect.objectContaining({ kind: "submit", submission: "spa" }),
      ]);
      expect(profile.totpChallenges).toBeUndefined();
      expect(
        normalizeHttpApplicationSettings({ version: 1, id })?.loginMode,
      ).toBe("manual");
      expect(
        getHttpApplicationIconSuggestion(saved(id, hostname))?.icon.key,
      ).toBe(icon);
      expect(() => resolveHttpApplicationLogin(saved(id, hostname))).toThrow(
        /native browser engine/,
      );
    },
  );

  it.each(presets)(
    "%s opens the source-backed account entry only in form mode",
    (id, _label, hostname) => {
      const connection = saved(id, hostname);
      const target = originBrowserConnectionTarget(connection, tab(connection));
      expect(target).toBe(`https://${hostname}/?settings=account`);
      expect(getHttpApplicationExternalTarget(connection, target)?.url).toBe(
        target,
      );
      const manual = saved(id, hostname, "manual");
      expect(originBrowserConnectionTarget(manual, tab(manual))).toBe(
        `https://${hostname}/`,
      );
      expect(resolveHttpApplicationLogin(manual).credentials).toBeNull();
    },
  );

  it.each(presets)(
    "%s can be selected without changing a saved account or requiring research notices",
    (id, label, hostname) => {
      function Fixture() {
        const [formData, setFormData] = React.useState<Partial<Connection>>({
          ...saved("generic-form", hostname),
          httpAutoLogin: true,
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
      render(<Fixture />);
      fireEvent.click(screen.getByLabelText("Website application"));
      fireEvent.mouseDown(screen.getByRole("option", { name: label }));
      expect(
        JSON.parse(screen.getByTestId("value").textContent!),
      ).toMatchObject({
        hostname,
        username: "fixture@example.test",
        password: "fixture-secret",
        httpApplication: { id, loginMode: "manual" },
        httpAutoLogin: false,
      });
      expect(
        screen.queryByTestId("login-steps-evidence"),
      ).not.toBeInTheDocument();
    },
  );

  it("self-hosted entry retains an explicit local HTTP port and replaces only the settings query", () => {
    const connection = {
      ...saved(
        "standard-red-notes",
        "http://127.0.0.1:3001/index.html?theme=dark&settings=old",
      ),
      protocol: "http",
      port: 3001,
    } as Connection;
    const target = originBrowserConnectionTarget(connection, tab(connection));
    expect(target).toBe(
      "http://127.0.0.1:3001/index.html?theme=dark&settings=account",
    );
    expect(() =>
      validateHttpApplicationTarget(connection, target),
    ).not.toThrow();
    const shared = {
      ...connection,
      hostname: "http://127.0.0.1:3001/shared?settings=old",
    };
    expect(originBrowserConnectionTarget(shared, tab(shared))).toBe(
      "http://127.0.0.1:3001/shared?settings=old",
    );
  });

  it.each([
    "?settings=old&theme=dark",
    "?settings=old&theme=dark&settings=other",
  ])("keeps native and frontend query ordering equal for %s", (query) => {
    const connection = saved(
      "standard-red-notes",
      `https://red.example.test/${query}`,
    );
    expect(originBrowserConnectionTarget(connection, tab(connection))).toBe(
      "https://red.example.test/?theme=dark&settings=account",
    );
  });

  it("hosted account credentials stay bound to the official app origin", () => {
    const connection = saved("standard-notes", "app.standardnotes.com");
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "https://app.standardnotes.com.evil.test/",
      ),
    ).toThrow(/requires HTTPS/);
    expect(
      getHttpApplicationProfile("standard-notes")?.declarativeLogin
        ?.credentialOrigins,
    ).toEqual(["https://app.standardnotes.com"]);
  });
});
