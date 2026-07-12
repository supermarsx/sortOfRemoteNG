import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import MssqlPanel, { mssqlDescriptor } from "./MssqlPanel";
import { mssqlApi } from "../../hooks/integration/useMssql";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "mssql_list_sessions":
        return Promise.resolve([]);
      case "mssql_connect":
        return Promise.resolve("mssql-session-1");
      case "mssql_get_session":
        return Promise.resolve({
          id: "mssql-session-1",
          host: "sql.lab.local",
          port: 1433,
          status: "Connected",
          queries_executed: 0,
          total_rows_fetched: 0,
          via_ssh_tunnel: false,
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("MssqlPanel", () => {
  it("renders the connect form when no backend session exists", async () => {
    render(<MssqlPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("sql.lab.local"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /^Connect$/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to mssql_connect with a snake_case config + externally-tagged auth", async () => {
    const { container } = render(<MssqlPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("sql.lab.local"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("sql.lab.local"), {
      target: { value: "sql.lab.local" },
    });
    fireEvent.change(screen.getByPlaceholderText("sa"), {
      target: { value: "sa" },
    });
    const pw = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(pw, { target: { value: "hunter2" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "mssql_connect",
        expect.objectContaining({
          config: expect.objectContaining({
            host: "sql.lab.local",
            port: 1433,
            auth: { SqlAuth: { username: "sa", password: "hunter2" } },
          }),
        }),
      ),
    );
  });

  it("exposes a well-formed database descriptor", () => {
    expect(mssqlDescriptor.key).toBe("mssql");
    expect(mssqlDescriptor.category).toBe("database");
    expect(typeof mssqlDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct command names and thread the session id", () => {
    mssqlApi.executeQuery("s1", "SELECT 1");
    mssqlApi.listTables("s1", "dbo");
    mssqlApi.killProcess("s1", 55);
    expect(invokeMock).toHaveBeenCalledWith("mssql_execute_query", {
      sessionId: "s1",
      sql: "SELECT 1",
    });
    expect(invokeMock).toHaveBeenCalledWith("mssql_list_tables", {
      sessionId: "s1",
      schema: "dbo",
    });
    expect(invokeMock).toHaveBeenCalledWith("mssql_kill_process", {
      sessionId: "s1",
      spid: 55,
    });
  });
});
