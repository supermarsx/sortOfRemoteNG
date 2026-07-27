import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

import MssqlPanel from "./MssqlPanel";
import { resetIntegrationConfigStoreForTests } from "../../hooks/integrations/useIntegrationConfigStore";

describe("MssqlPanel capability gates", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetIntegrationConfigStoreForTests();
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_app_data") return Promise.resolve(null);
      if (command === "mssql_get_connection") return Promise.resolve(null);
      if (command === "mssql_list_sessions") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
  });

  it("offers SQL authentication only and labels unsupported transports before connect", async () => {
    render(<MssqlPanel isOpen onClose={() => {}} />);

    const auth = await screen.findByRole("combobox", {
      name: "Authentication",
    });
    const windowsOption = screen.getByRole("option", {
      name: /Windows.*unavailable/i,
    });
    const azureOption = screen.getByRole("option", {
      name: /Azure AD.*unavailable/i,
    });
    expect(windowsOption).toBeDisabled();
    expect(azureOption).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /SQL Server login is the only supported.*SSH tunnelling.*unavailable/i,
    );
    expect(
      screen.getByRole("checkbox", {
        name: /Connect through SSH tunnel.*unavailable/i,
      }),
    ).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("sql.lab.local"), {
      target: { value: "sql.example.test" },
    });
    fireEvent.change(screen.getByPlaceholderText("sa"), {
      target: { value: "db-user" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Connect$/i })).toBeEnabled(),
    );

    // A legacy persisted value may still hydrate one of these variants. It
    // remains visibly selected but cannot reach the native connect command.
    fireEvent.change(auth, { target: { value: "WindowsAuth" } });
    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "mssql_connect",
      expect.anything(),
    );
  });
});
