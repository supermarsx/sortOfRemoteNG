import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
  HttpAutoLoginSelectors,
} from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  connection: {} as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [mocks.connection] },
    dispatch: vi.fn(),
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }),
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({}));

import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import { normalizeHttpApplicationSettings } from "../../src/utils/connection/httpApplicationProfiles";
import {
  normalizeImportedAdvancedProtocolConnection,
  prepareConnectionForExport,
} from "../../src/components/ImportExport/advancedProtocolPortability";

const initial: Connection = {
  id: "custom-app-fixture",
  name: "Custom fixture",
  protocol: "http",
  hostname: "custom.example.test",
  port: 8080,
  isGroup: false,
  username: "fixture-user",
  password: "fixture-secret",
  createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z",
};
const selectors: HttpAutoLoginSelectors = {
  usernameSelector: '#login > input[name="account"]',
  passwordSelector: "#secret",
  submitSelector: "button[data-login]",
};
const custom = (
  selectorValues: HttpAutoLoginSelectors = selectors,
): Connection => ({
  ...initial,
  httpApplication: { version: 1, id: "custom", loginMode: "form" },
  httpAutoLoginSelectors: selectorValues,
});
function Fixture() {
  const [formData, setFormData] = React.useState<Partial<Connection>>(initial);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application"]}
      />
      <output data-testid="custom-form-data">{JSON.stringify(formData)}</output>
    </>
  );
}
function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
function value(): Connection {
  return JSON.parse(screen.getByTestId("custom-form-data").textContent!);
}

describe("Custom HTTP application", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.connection = initial as unknown as Record<string, unknown>;
  });
  afterEach(cleanup);
  it("is selectable globally and under Custom websites, defaults manual and preserves authority/secrets", () => {
    render(<Fixture />);
    choose("Application category", "Custom websites");
    choose("Website application", "Custom application");
    expect(value()).toMatchObject({
      ...initial,
      httpApplication: { version: 1, id: "custom", loginMode: "manual" },
    });
    expect(resolveHttpApplicationLogin(value())).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    expect(screen.queryByLabelText("Website password")).not.toBeInTheDocument();
    choose("Application category", "All website applications");
    fireEvent.click(screen.getByLabelText("Website application"));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search all website applications…" }),
      { target: { value: "custom" } },
    );
    expect(
      screen.getByRole("option", { name: "Custom application" }),
    ).toBeInTheDocument();
  });
  it("keeps credentials in Application and requires all three bounded selectors after form opt-in", () => {
    render(<Fixture />);
    choose("Website application", "Custom application");
    choose(
      "Application login mode",
      "Automatic form login — explicitly opt in",
    );
    expect(
      screen.getByText("Custom form selectors (required)"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Website username")).toHaveValue(
      initial.username,
    );
    expect(screen.getByLabelText("Website password")).toHaveValue(
      initial.password,
    );
    expect(() => resolveHttpApplicationLogin(value())).toThrow(/selector/i);
    for (const [label, key] of [
      ["Username field selector", "usernameSelector"],
      ["Password field selector", "passwordSelector"],
      ["Submit button selector", "submitSelector"],
    ] as const) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("maxlength", "512");
      expect(input).toBeVisible();
      fireEvent.change(input, { target: { value: selectors[key] } });
    }
    expect(resolveHttpApplicationLogin(value())).toMatchObject({
      credentials: { username: initial.username, password: initial.password },
      selectors,
      upstreamAuthMode: "none",
      autoLogin: true,
    });
    expect(value().httpApplication).not.toHaveProperty("password");
  });
  it.each(["usernameSelector", "passwordSelector", "submitSelector"] as const)(
    "requires explicit %s with no heuristic fallback",
    (key) => {
      expect(() =>
        resolveHttpApplicationLogin(custom({ ...selectors, [key]: "" })),
      ).toThrow(/selector/i);
      expect(() =>
        resolveHttpApplicationLogin(custom({ ...selectors, [key]: "   " })),
      ).toThrow(/selector/i);
    },
  );
  it.each(["[", "input\u0000", "<script>", "a".repeat(513)])(
    "rejects malformed selectors before any proxy command",
    async (selector) => {
      mocks.connection = custom({
        ...selectors,
        passwordSelector: selector,
      }) as unknown as Record<string, unknown>;
      const session: ConnectionSession = {
        id: "custom-web-fixture",
        connectionId: initial.id,
        name: initial.name,
        protocol: "http",
        hostname: initial.hostname,
        status: "connected",
        startTime: new Date(),
      };
      const { result } = renderHook(() => useWebBrowser(session));
      await waitFor(() =>
        expect(result.current.loadError).toMatch(/Application settings/),
      );
      expect(
        mocks.invoke.mock.calls.some(
          ([command]) =>
            command === "start_basic_auth_proxy" ||
            command === "get_tls_certificate_info",
        ),
      ).toBe(false);
      expect(result.current.loadError).not.toContain(initial.password);
    },
  );
  it("round-trips custom profile and selectors without introducing profile secrets", () => {
    const connection = custom();
    const normalized = normalizeImportedAdvancedProtocolConnection(
      JSON.parse(JSON.stringify(connection)),
    );
    expect(normalized.httpApplication).toEqual(connection.httpApplication);
    expect(normalized.httpAutoLoginSelectors).toEqual(selectors);
    expect(
      normalizeHttpApplicationSettings(normalized.httpApplication)?.invalid,
    ).not.toBe(true);
    const exported = prepareConnectionForExport(connection, false);
    expect(exported.httpApplication).toEqual(connection.httpApplication);
    expect(exported.httpAutoLoginSelectors).toEqual(selectors);
    expect(JSON.stringify(exported)).not.toContain(initial.password);
  });
});
