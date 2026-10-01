import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import DatabaseList from "../../src/components/database/list/DatabaseList";
import { ImportExportNavigationContext } from "../../src/components/ImportExport/navigation";
import { useDatabaseSelector } from "../../src/hooks/connection/useDatabaseSelector";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

vi.mock("../../src/hooks/connection/useDatabaseSizes", () => ({
  useDatabaseSizes: () => ({ sizes: {}, loading: false, refresh: () => {} }),
}));

const mock = vi.hoisted(() => ({
  getAllDatabases: vi.fn(),
  getCurrentDatabase: vi.fn(),
  isDatabaseUnlocked: vi.fn(),
  getDatabaseProtectionStatus: vi.fn(),
  updateDatabase: vi.fn(),
  changeDatabasePassword: vi.fn(),
  removePasswordFromDatabase: vi.fn(),
  flush: vi.fn(),
  save: vi.fn(),
  select: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => mock },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ saveData: mock.save, flushPendingSave: mock.flush }),
}));
vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: { getProfiles: () => [], getChains: () => [] },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => ({ exportSecurity: {} }) }),
  },
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { animationsEnabled: false } }),
  default: React.createContext({ settings: { animationsEnabled: false } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

const managed: ConnectionDatabase = {
  id: "fixture",
  name: "Original",
  description: "Original description",
  isEncrypted: true,
  protectionFormat: "sorng-db",
  securityRevision: "revision",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
};
const field = (name: string) =>
  `databaseCenter.collections.${name}PasswordPlaceholder`;
function Harness() {
  return (
    <ImportExportNavigationContext.Provider value={vi.fn()}>
      <DatabaseList
        mgr={useDatabaseSelector(true, mock.select)}
        onClose={vi.fn()}
      />
    </ImportExportNavigationContext.Provider>
  );
}
async function edit() {
  render(<Harness />);
  fireEvent.click(
    await screen.findByRole("button", { name: "databaseCenter.actions.edit" }),
  );
}
function rename() {
  fireEvent.change(screen.getByDisplayValue("Original"), {
    target: { value: "Renamed" },
  });
  fireEvent.change(screen.getByDisplayValue("Original description"), {
    target: { value: "Edited description" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "databaseCenter.collections.updateAction",
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.getAllDatabases.mockResolvedValue([managed]);
  mock.getCurrentDatabase.mockReturnValue(managed);
  mock.isDatabaseUnlocked.mockReturnValue(true);
  mock.getDatabaseProtectionStatus.mockResolvedValue({
    kind: "managed",
    slots: [{ id: "vault", type: "os-vault" }],
  });
  mock.updateDatabase.mockResolvedValue(undefined);
  mock.flush.mockRejectedValue(
    new Error(
      "Invalid record ledger: runtime object. Existing metadata was retained.",
    ),
  );
});

describe("database metadata edit form", () => {
  it.each([true, false])(
    "renames an OS-vault database without password controls or a data flush (open=%s)",
    async (open) => {
      mock.getCurrentDatabase.mockReturnValue(open ? managed : null);
      mock.isDatabaseUnlocked.mockReturnValue(open);
      await edit();
      expect(
        await screen.findByText("Unlock methods: OS vault"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("databaseCenter.collections.encryptToggle"),
      ).toBeNull();
      for (const name of ["current", "new", "confirm"])
        expect(screen.queryByPlaceholderText(field(name))).toBeNull();
      rename();
      await waitFor(() =>
        expect(mock.updateDatabase).toHaveBeenCalledExactlyOnceWith({
          id: managed.id,
          name: "Renamed",
          description: "Edited description",
        }),
      );
      expect(mock.flush).not.toHaveBeenCalled();
      expect(mock.save).not.toHaveBeenCalled();
      expect(mock.changeDatabasePassword).not.toHaveBeenCalled();
      expect(mock.removePasswordFromDatabase).not.toHaveBeenCalled();
    },
  );

  it("keeps managed password slots in the protection summary", async () => {
    mock.getDatabaseProtectionStatus.mockResolvedValue({
      kind: "managed",
      slots: [{ type: "os-vault" }, { type: "password" }],
    });
    await edit();
    expect(
      await screen.findByText("Unlock methods: OS vault, Password"),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(field("new"))).toBeNull();
  });

  it("allows metadata editing when protection inspection fails without offering legacy passwords", async () => {
    mock.getDatabaseProtectionStatus.mockRejectedValue(
      new Error("Vault offline"),
    );
    await edit();
    expect(
      await screen.findByText("Unlock methods could not be inspected."),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(field("current"))).toBeNull();
    rename();
    await waitFor(() => expect(mock.updateDatabase).toHaveBeenCalledOnce());
  });

  it("ignores stale legacy password controls for managed metadata saves", async () => {
    const { result } = renderHook(() =>
      useDatabaseSelector(false, mock.select),
    );
    act(() => result.current.handleEditCollection(managed));
    act(() =>
      result.current.setEditPassword({
        current: "",
        next: "stale",
        confirm: "mismatch",
        enableEncryption: false,
      }),
    );
    await act(() => result.current.handleUpdateCollection());
    expect(mock.updateDatabase).toHaveBeenCalledOnce();
    expect(mock.changeDatabasePassword).not.toHaveBeenCalled();
    expect(mock.removePasswordFromDatabase).not.toHaveBeenCalled();
    expect(result.current.error).toBe("");
  });

  it("renames a legacy encrypted database with all password fields empty", async () => {
    mock.getAllDatabases.mockResolvedValue([
      { ...managed, protectionFormat: undefined },
    ]);
    await edit();
    expect(screen.getByPlaceholderText(field("current"))).toHaveValue("");
    rename();
    await waitFor(() => expect(mock.updateDatabase).toHaveBeenCalledOnce());
    expect(mock.flush).not.toHaveBeenCalled();
    expect(mock.changeDatabasePassword).not.toHaveBeenCalled();
  });

  it("still flushes pending edits before an explicit legacy password change", async () => {
    mock.getAllDatabases.mockResolvedValue([
      { ...managed, protectionFormat: undefined },
    ]);
    await edit();
    fireEvent.change(screen.getByPlaceholderText(field("current")), {
      target: { value: "synthetic-old" },
    });
    fireEvent.change(screen.getByPlaceholderText(field("new")), {
      target: { value: "synthetic-new" },
    });
    fireEvent.change(screen.getByPlaceholderText(field("confirm")), {
      target: { value: "synthetic-new" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "databaseCenter.collections.updateAction",
      }),
    );
    expect(
      await screen.findByText(
        "Invalid record ledger: runtime object. Existing metadata was retained.",
      ),
    ).toBeInTheDocument();
    expect(mock.flush).toHaveBeenCalledOnce();
    expect(mock.changeDatabasePassword).not.toHaveBeenCalled();
    expect(mock.updateDatabase).not.toHaveBeenCalled();
  });

  it("only shows new-password fields when enabling encryption on a plain database", async () => {
    mock.getAllDatabases.mockResolvedValue([
      { ...managed, protectionFormat: undefined, isEncrypted: false },
    ]);
    await edit();
    fireEvent.click(
      screen.getByText("databaseCenter.collections.encryptToggle"),
    );
    expect(screen.queryByPlaceholderText(field("current"))).toBeNull();
    expect(screen.getByPlaceholderText(field("new"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "databaseCenter.collections.updateAction",
      }),
    );
    expect(
      await screen.findByText(
        "databaseCenter.collections.errors.passwordRequiredToEncrypt",
      ),
    ).toBeInTheDocument();
    expect(mock.updateDatabase).not.toHaveBeenCalled();
  });

  it("only requires the current password for an explicit legacy encryption removal", async () => {
    mock.getAllDatabases.mockResolvedValue([
      { ...managed, protectionFormat: undefined },
    ]);
    await edit();
    fireEvent.click(
      screen.getByText("databaseCenter.collections.encryptToggle"),
    );
    expect(screen.queryByPlaceholderText(field("new"))).toBeNull();
    expect(screen.getByPlaceholderText(field("current"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "databaseCenter.collections.updateAction",
      }),
    );
    expect(
      await screen.findByText(
        "databaseCenter.collections.errors.currentPasswordRequiredToRemoveEncryption",
      ),
    ).toBeInTheDocument();
    expect(mock.updateDatabase).not.toHaveBeenCalled();
  });

  it("preserves the native metadata failure message", async () => {
    mock.updateDatabase.mockRejectedValue(
      "Database index changed; reload before retrying.",
    );
    await edit();
    rename();
    expect(
      await screen.findByText(
        "Database index changed; reload before retrying.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Renamed")).toBeInTheDocument();
  });
});
