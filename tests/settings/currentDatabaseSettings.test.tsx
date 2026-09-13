import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type {
  DatabaseSettings,
  DatabaseSettingsApi,
} from "../../src/types/settings/databaseSettings";
import { useCurrentDatabaseSettings } from "../../src/hooks/settings/useCurrentDatabaseSettings";
import { normalizeDatabaseSettings } from "../../src/utils/documents/documentTypePolicy";
import { CURRENT_DATABASE_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/currentDatabase";
import { SECURITY_SEARCH_ENTRIES } from "../../src/components/SettingsDialog/settingsSearchIndex/security";

vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "db-a", name: "Current fixture" }),
    }),
  },
}));
vi.mock(
  "../../src/components/SettingsDialog/sections/security/CurrentDatabaseSecuritySection",
  () => ({ default: () => <div>Owned protection control</div> }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/security/ConnectionRecycleBinSection",
  () => ({ default: () => <div>Owned retention control</div> }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/security/DatabaseCredentialVaultSection",
  () => ({ default: () => <div>Owned vault control</div> }),
);
import CurrentDatabaseSettings, {
  DatabaseDocumentTypesSection,
} from "../../src/components/SettingsDialog/sections/CurrentDatabaseSettings";

let data: DatabaseSettings, api: DatabaseSettingsApi;
const read = vi.fn(),
  write = vi.fn();
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionContext.Provider
    value={{ databaseSettings: api } as ConnectionContextType}
  >
    {children}
  </ConnectionContext.Provider>
);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  data = normalizeDatabaseSettings(undefined);
  read.mockReset().mockImplementation(async () => structuredClone(data));
  write.mockReset().mockImplementation(async (_scope, expected, proposed) => {
    expect(expected).toEqual(data);
    data = structuredClone(proposed);
  });
  api = {
    scope: { databaseId: "db-a", generation: 1 },
    changeRevision: 0,
    read,
    compareAndSwap: write,
  };
});
afterEach(cleanup);

describe("Current Database settings", () => {
  it("collects the three existing owner controls and persists document types only on explicit save", async () => {
    render(<CurrentDatabaseSettings />, { wrapper });
    expect(screen.getByText("Owned protection control")).toBeInTheDocument();
    expect(screen.getByText("Owned retention control")).toBeInTheDocument();
    expect(screen.getByText("Owned vault control")).toBeInTheDocument();
    const notes = await screen.findByRole("checkbox", { name: "Notes" });
    expect(notes).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(15);
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(notes);
    // Deliberately toggle out of catalogue order; durable canonicalization
    // must not suppress the successful-save confirmation.
    fireEvent.click(screen.getByRole("checkbox", { name: "Rich text" }));
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save document types" }),
    );
    await screen.findByText("Document types saved for this database.");
    expect(write).toHaveBeenCalledExactlyOnceWith(
      api.scope,
      normalizeDatabaseSettings(undefined),
      { version: 1, documentTypes: { disabled: ["rich-text", "note"] } },
    );
    expect(screen.getByText(/never deletes or hides/)).toBeInTheDocument();
  });
  it("keeps old setting search identities but sends them and type searches to the new tab", () => {
    for (const key of [
      "currentDatabaseSecurity",
      "currentDatabaseRecycleBin",
      "databaseCredentialVault",
      "databaseDocumentTypes",
    ]) {
      expect(
        CURRENT_DATABASE_SEARCH_ENTRIES.find((entry) => entry.key === key)
          ?.section,
      ).toBe("currentDatabase");
      expect(SECURITY_SEARCH_ENTRIES.some((entry) => entry.key === key)).toBe(
        false,
      );
    }
  });
  it("does not invent all-enabled permission when storage is locked or a preference read fails", async () => {
    read.mockRejectedValue(new Error("PRIVATE_NATIVE_DETAIL"));
    render(<DatabaseDocumentTypesSection />, { wrapper });
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "PRIVATE_NATIVE_DETAIL",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });
  it("does not retain the old database's settings when it closes and a same-ID scope later returns", async () => {
    const first = deferred<DatabaseSettings>(),
      next = deferred<DatabaseSettings>();
    read.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const view = renderHook(useCurrentDatabaseSettings, { wrapper });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    api = { ...api, scope: null };
    view.rerender();
    api = { ...api, scope: { databaseId: "db-a", generation: 1 } };
    view.rerender();
    await act(async () => {
      first.resolve({ version: 1, documentTypes: { disabled: ["note"] } });
    });
    expect(view.result.current.settings).toBeNull();
    expect(view.result.current.scope).toBeNull();
    await act(async () => {
      next.resolve(data);
    });
    expect(view.result.current.settings).toEqual(data);
  });
  it("invalidates an already verified cached receipt during an owner ABA, until the new read completes", async () => {
    const view = renderHook(useCurrentDatabaseSettings, { wrapper });
    await waitFor(() => expect(view.result.current.settings).toEqual(data));
    api = { ...api, scope: null };
    view.rerender();
    const held = deferred<DatabaseSettings>();
    read.mockReturnValueOnce(held.promise);
    api = { ...api, scope: { databaseId: "db-a", generation: 1 } };
    view.rerender();
    expect(view.result.current.settings).toBeNull();
    await act(async () => {
      held.resolve(data);
    });
    expect(view.result.current.settings).toEqual(data);
  });
  it("refuses stale save completion after the owner switches and never replays it", async () => {
    const view = renderHook(useCurrentDatabaseSettings, { wrapper });
    await waitFor(() => expect(view.result.current.settings).toEqual(data));
    const held = deferred<void>();
    write.mockReturnValueOnce(held.promise);
    let pending!: Promise<boolean>;
    act(() => {
      pending = view.result.current.save({
        version: 1,
        documentTypes: { disabled: ["note"] },
      });
    });
    api = { ...api, scope: { databaseId: "db-b", generation: 2 } };
    view.rerender();
    await act(async () => {
      held.resolve();
      expect(await pending).toBe(false);
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(view.result.current.scope?.databaseId).toBe("db-b");
  });
  it("keeps failed or mismatched save verification actionable, without claiming success", async () => {
    const view = renderHook(useCurrentDatabaseSettings, { wrapper });
    await waitFor(() => expect(view.result.current.settings).toEqual(data));
    write.mockResolvedValueOnce(undefined);
    await act(async () => {
      expect(
        await view.result.current.save({
          version: 1,
          documentTypes: { disabled: ["note"] },
        }),
      ).toBe(false);
    });
    expect(view.result.current.error).toMatch(
      /could not be saved and verified/,
    );
    expect(view.result.current.settings).toEqual(data);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
