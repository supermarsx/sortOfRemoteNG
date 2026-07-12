import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory can see it.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import KeepassToolsTab from "./KeepassToolsTab";
import { keepassToolsApi } from "../../../hooks/integration/keepass/useKeepassTools";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("keepassToolsApi", () => {
  it("maps a stateless command to its invoke name + camelCase args", () => {
    keepassToolsApi.quickSearch("db-1", "gmail");
    expect(invokeMock).toHaveBeenCalledWith("keepass_quick_search", {
      dbId: "db-1",
      term: "gmail",
    });
  });

  it("maps password generation to keepass_generate_password with req", () => {
    invokeMock.mockReset();
    keepassToolsApi.generatePassword({
      mode: "CharacterSet",
      length: 20,
      excludeLookalikes: true,
      ensureEachSet: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("keepass_generate_password", {
      req: expect.objectContaining({ mode: "CharacterSet", length: 20 }),
    });
  });
});

describe("KeepassToolsTab", () => {
  it("renders and wires quick search to keepass_quick_search for the open db", async () => {
    render(<KeepassToolsTab dbId="db-42" />);

    fireEvent.change(await screen.findByTestId("keepass-tools-search-term"), {
      target: { value: "vault" },
    });
    fireEvent.click(screen.getByTestId("keepass-tools-quick-search"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("keepass_quick_search", {
        dbId: "db-42",
        term: "vault",
      }),
    );
  });
});
