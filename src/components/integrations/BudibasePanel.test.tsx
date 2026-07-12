import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import BudibasePanel, { budibaseDescriptor } from "./BudibasePanel";
import { budibaseApi } from "../../hooks/integration/useBudibase";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "budibase_connect":
        return Promise.resolve({
          connected: true,
          host: "https://budibase.example.com",
          version: "3.2.0",
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("BudibasePanel", () => {
  it("renders the connect form when disconnected", async () => {
    render(<BudibasePanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("https://budibase.example.com"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeInTheDocument();
  });

  it("connect maps to budibase_connect with a camelCase wire config", async () => {
    render(<BudibasePanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("https://budibase.example.com"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(
      screen.getByPlaceholderText("https://budibase.example.com"),
      { target: { value: "https://budibase.example.com" } },
    );
    // API key is required to enable Connect.
    const apiKeyInput = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "bb-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "budibase_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "https://budibase.example.com",
            apiKey: "bb-secret",
          }),
        }),
      ),
    );
  });

  it("exposes a well-formed app-service descriptor", () => {
    expect(budibaseDescriptor.key).toBe("budibase");
    expect(budibaseDescriptor.category).toBe("app-service");
    expect(typeof budibaseDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct registered command names and args", () => {
    budibaseApi.listApps("c1");
    budibaseApi.getApp("c1", "app_1");
    budibaseApi.searchRows("c1", "ta_1", { query: { equal: {} } });
    budibaseApi.deleteTable("c1", "ta_1", "rev_1");
    expect(invokeMock).toHaveBeenCalledWith("budibase_list_apps", { id: "c1" });
    expect(invokeMock).toHaveBeenCalledWith("budibase_get_app", {
      id: "c1",
      appId: "app_1",
    });
    expect(invokeMock).toHaveBeenCalledWith("budibase_search_rows", {
      id: "c1",
      tableId: "ta_1",
      request: { query: { equal: {} } },
    });
    expect(invokeMock).toHaveBeenCalledWith("budibase_delete_table", {
      id: "c1",
      tableId: "ta_1",
      rev: "rev_1",
    });
  });
});
