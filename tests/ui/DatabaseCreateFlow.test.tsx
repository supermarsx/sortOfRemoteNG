import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import en from "../../src/i18n/locales/en-US.json";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const managerMocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  getAllDatabases: vi.fn(),
  getCurrentDatabase: vi.fn(),
  isDatabaseUnlocked: vi.fn(),
}));

vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => managerMocks,
  },
}));

vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    getProfiles: () => [],
    getChains: () => [],
    searchProfiles: () => [],
    searchChains: () => [],
  },
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ saveData: vi.fn(async () => {}) }),
}));

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: {
      animationsEnabled: true,
      passwordReveal: {
        enabled: true,
        mode: "toggle",
        autoHideSeconds: 0,
        showByDefault: false,
        maskIcon: false,
        maskCharacter: "",
        lockSavedPasswords: false,
      },
    },
  }),
  default: React.createContext({ settings: {} }),
}));

function translate(key: string, opts?: string | Record<string, unknown>) {
  const resolved = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en,
    );

  if (typeof resolved !== "string") {
    return typeof opts === "string" ? opts : key;
  }
  if (!opts || typeof opts === "string") return resolved;

  return resolved.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
    token in opts ? String(opts[token]) : match,
  );
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) =>
      translate(key, opts),
  }),
}));

import DatabasePanel from "../../src/components/database/DatabasePanel";

const CREATED_DATABASE: ConnectionDatabase = {
  id: "created-id",
  name: "MyDataBase",
  description: "Issue 240 regression",
  isEncrypted: false,
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:00:00.000Z",
  lastAccessed: "2026-07-23T12:00:00.000Z",
};

async function openAndFillCreateCard() {
  await waitFor(() => expect(managerMocks.getAllDatabases).toHaveBeenCalled());

  fireEvent.click(screen.getByTestId("database-create"));
  const confirm = screen.getByTestId("database-confirm");
  expect(confirm).toBeDisabled();

  fireEvent.change(screen.getByTestId("database-name"), {
    target: { value: "MyDataBase" },
  });
  fireEvent.change(screen.getByPlaceholderText("Optional description"), {
    target: { value: "Issue 240 regression" },
  });

  expect(confirm).toBeEnabled();
  return confirm;
}

beforeEach(() => {
  vi.clearAllMocks();
  managerMocks.getAllDatabases.mockResolvedValue([]);
  managerMocks.getCurrentDatabase.mockReturnValue(null);
  managerMocks.isDatabaseUnlocked.mockReturnValue(false);
});

describe("database creation user flow (issue #240)", () => {
  it("creates, lists, and opens a database from the real create card", async () => {
    managerMocks.createDatabase.mockResolvedValue(CREATED_DATABASE);
    const onDatabaseSelect = vi.fn(async () => {});

    render(
      <DatabasePanel onClose={vi.fn()} onDatabaseSelect={onDatabaseSelect} />,
    );

    fireEvent.click(await openAndFillCreateCard());

    await waitFor(() =>
      expect(managerMocks.createDatabase).toHaveBeenCalledWith(
        "MyDataBase",
        "Issue 240 regression",
        false,
        undefined,
      ),
    );
    await waitFor(() =>
      expect(onDatabaseSelect).toHaveBeenCalledWith("created-id", undefined),
    );

    expect(screen.queryByText("Create New Database")).not.toBeInTheDocument();
    expect(screen.getByText("MyDataBase")).toBeInTheDocument();
    expect(screen.getByText("Issue 240 regression")).toBeInTheDocument();
  });

  it("keeps the form open and surfaces a string error returned across Tauri IPC", async () => {
    managerMocks.createDatabase.mockRejectedValue(
      "database storage directory is not writable",
    );
    const onDatabaseSelect = vi.fn(async () => {});

    render(
      <DatabasePanel onClose={vi.fn()} onDatabaseSelect={onDatabaseSelect} />,
    );

    fireEvent.click(await openAndFillCreateCard());

    expect(
      await screen.findByText("database storage directory is not writable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Create New Database")).toBeInTheDocument();
    expect(screen.getByTestId("database-name")).toHaveValue("MyDataBase");
    expect(onDatabaseSelect).not.toHaveBeenCalled();
  });

  it("uses the translated fallback when the rejection contains no detail", async () => {
    managerMocks.createDatabase.mockRejectedValue({ code: "UNKNOWN" });

    render(<DatabasePanel onClose={vi.fn()} />);

    fireEvent.click(await openAndFillCreateCard());

    expect(
      await screen.findByText("Failed to create database"),
    ).toBeInTheDocument();
  });
});
