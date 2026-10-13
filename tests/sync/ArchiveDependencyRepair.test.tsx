import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { fullData, collection } from "../fixtures/fullDatabaseArchive";
import { ArchiveDependencyRepair } from "../../src/components/sync/ArchiveDependencyRepair";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  commit: vi.fn(),
  flush: vi.fn(),
  refresh: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "source-db" }),
      loadDatabaseData: mocks.load,
      commitArchiveDependencyRepair: mocks.commit,
    }),
  },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    flushPendingSave: mocks.flush,
    loadData: mocks.refresh,
  }),
}));
vi.mock("../../src/utils/recording/automationLibrary", () => ({
  createAutomationLibraryApi: () => ({ read: mocks.read }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("dependency repair review", () => {
  it("does not read private data until requested; commits copy+rebind together and can undo", async () => {
    const data = await fullData();
    const source = {
      ...data.automationLibrary!.terminalScripts.customScripts[0],
      id: "app-script",
      script: "uptime",
    };
    data.connections[1].sshQuickActions!.items = [
      { kind: "script", id: source.id },
    ];
    mocks.load.mockResolvedValueOnce(data).mockImplementation(async () => data);
    mocks.read.mockResolvedValue({
      entries: [{ family: "terminal-script", payload: source }],
    });
    render(<ArchiveDependencyRepair databaseId={collection.id} />);
    expect(mocks.load).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Review dependency fixes" }),
    );
    await screen.findByRole("button", {
      name: "Copy into this database and reselect",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Fix all safe issues" }),
    );
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    const replacement = mocks.commit.mock.calls[0][2];
    expect(
      replacement.automationLibrary.terminalScripts.customScripts,
    ).toHaveLength(2);
    expect(replacement.connections[1].sshQuickActions.items[0].scope).toEqual({
      kind: "database",
      databaseId: collection.id,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Undo dependency repairs" }),
    );
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(2));
    expect(mocks.commit.mock.calls[1][1]).toBe(replacement);
    expect(mocks.commit.mock.calls[1][2]).toBe(data);
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("requires explicit removal for a missing target and leaves failed transactions unchanged", async () => {
    const data = await fullData();
    data.connections[1].sshQuickActions!.items = [
      { kind: "macro", id: "absent" },
    ];
    const original = structuredClone(data);
    mocks.load.mockResolvedValue(data);
    mocks.read.mockResolvedValue({ entries: [] });
    mocks.commit.mockRejectedValue(new Error("conflict"));
    render(<ArchiveDependencyRepair databaseId={collection.id} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Review dependency fixes" }),
    );
    await screen.findByRole("button", { name: "Remove this reference" });
    expect(
      screen.getByRole("button", { name: "Fix all safe issues" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove this reference" }),
    );
    await screen.findByText(/The operation did not finish/);
    expect(data).toEqual(original);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
