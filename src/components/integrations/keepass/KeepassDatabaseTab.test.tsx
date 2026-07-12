import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory can see it.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import KeepassDatabaseTab from "./KeepassDatabaseTab";
import { keepassDatabaseApi } from "../../../hooks/integration/keepass/useKeepassDatabase";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("keepassDatabaseApi", () => {
  it("maps every wrapper to a keepass_* command with dbId args", async () => {
    invokeMock.mockResolvedValue([]);
    await keepassDatabaseApi.listGroups("db-1");
    expect(invokeMock).toHaveBeenCalledWith("keepass_list_groups", {
      dbId: "db-1",
    });

    invokeMock.mockClear();
    await keepassDatabaseApi.createEntry("db-1", { groupUuid: "g-1" });
    expect(invokeMock).toHaveBeenCalledWith("keepass_create_entry", {
      dbId: "db-1",
      req: { groupUuid: "g-1" },
    });

    invokeMock.mockClear();
    // The unused underscore param must still be present as `sourceFilePath`.
    await keepassDatabaseApi.mergeDatabase(
      "db-1",
      {
        remotePath: "/r.kdbx",
        conflictResolution: "PreferNewer",
        syncDeletions: false,
        mergeCustomIcons: true,
      },
      "/r.kdbx",
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "keepass_merge_database",
      expect.objectContaining({ dbId: "db-1", sourceFilePath: "/r.kdbx" }),
    );
  });
});

describe("KeepassDatabaseTab", () => {
  it("renders the section switcher and defaults to overview", () => {
    render(<KeepassDatabaseTab dbId="db-1" />);
    expect(screen.getByTestId("keepass-db-section-overview")).toBeTruthy();
    expect(screen.getByTestId("keepass-db-section-groups")).toBeTruthy();
    expect(screen.getByTestId("keepass-db-section-history")).toBeTruthy();
  });

  it("loads statistics via keepass_get_database_statistics", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "keepass_get_database_statistics")
        return Promise.resolve({ totalEntries: 7, totalGroups: 2 });
      return Promise.resolve(undefined);
    });
    render(<KeepassDatabaseTab dbId="db-9" />);
    fireEvent.click(screen.getByText("Load statistics"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "keepass_get_database_statistics",
        { dbId: "db-9" },
      ),
    );
  });

  it("switches to the groups section and lists groups", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "keepass_list_groups")
        return Promise.resolve([
          { uuid: "g-1", name: "Web", entryCount: 3 },
        ]);
      return Promise.resolve(undefined);
    });
    render(<KeepassDatabaseTab dbId="db-1" />);
    fireEvent.click(screen.getByTestId("keepass-db-section-groups"));
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("keepass_list_groups", {
        dbId: "db-1",
      }),
    );
    await screen.findByText(/Web/);
  });
});
