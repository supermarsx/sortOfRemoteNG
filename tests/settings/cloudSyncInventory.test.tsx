import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SyncItemsGrid from "../../src/components/SettingsDialog/sections/cloudSync/SyncItemsGrid";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../src/utils/storage/appDataJsonStore";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";

const mocks = vi.hoisted(() => ({ discover: vi.fn(), update: vi.fn() }));
vi.mock("../../src/utils/services/cloudSyncPayload", () => ({
  discoverCloudSyncItems: mocks.discover,
}));

const inventory = [
  {
    id: "file:work",
    label: "Work database",
    kind: "file",
    available: true,
    bytes: 2048,
    sensitive: true,
  },
  {
    id: "record:theme",
    label: "Theme preferences",
    kind: "record",
    available: true,
    bytes: 80,
  },
  {
    id: "file:locked",
    label: "Locked vault",
    kind: "file",
    available: false,
    unavailableReason: "Unlock this vault first.",
  },
];

function Harness({
  initial,
  busy = false,
}: {
  initial?: string[];
  busy?: boolean;
}) {
  const [cloudSync, setConfig] = useState<CloudSyncConfig>({
    ...defaultCloudSyncConfig,
    selectedItems: initial,
  });
  const mgr = {
    cloudSync,
    isBusy: busy,
    updateCloudSync: (patch: Partial<CloudSyncConfig>) => {
      mocks.update(patch);
      setConfig((current) => ({ ...current, ...patch }));
    },
  } as Mgr;
  return <SyncItemsGrid mgr={mgr} />;
}

describe("cloud sync actual inventory selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discover.mockResolvedValue(inventory);
  });
  afterEach(cleanup);

  it("loads actual items grouped by kind without selecting them or using legacy defaults", async () => {
    render(<Harness />);
    expect(
      await screen.findByRole("checkbox", { name: /Work database/ }),
    ).not.toBeChecked();
    expect(screen.getByRole("group", { name: "record" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "file" })).toBeInTheDocument();
    expect(screen.getByText(/2.0 KiB · Sensitive data/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 selected");
    expect(
      screen.getByRole("checkbox", { name: /Locked vault/ }),
    ).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /connections, documents, password vault, trust records, and automation together/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not arbitrary file or folder sync/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Database-owned saved terminal scripts and terminal macros are included/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /App-wide libraries appear separately and can be selected independently/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Deselecting an item stops future synchronization but does not delete data already stored in the cloud/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search archives and libraries…"),
    ).toBeInTheDocument();
  });

  it("searches without changing selection and selects/deselects only available inventory", async () => {
    render(<Harness initial={["missing"]} />);
    await screen.findByRole("checkbox", { name: /Work database/ });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search sync items" }),
      { target: { value: "theme" } },
    );
    expect(
      screen.queryByRole("checkbox", { name: /Work database/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Theme preferences/ }),
    ).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all available" }),
    );
    expect(mocks.update).toHaveBeenLastCalledWith({
      selectedItems: ["missing", "file:work", "record:theme"],
    });
    expect(screen.getByRole("status")).toHaveTextContent("3 selected");
    fireEvent.click(screen.getByRole("button", { name: "Deselect available" }));
    expect(mocks.update).toHaveBeenLastCalledWith({
      selectedItems: ["missing"],
    });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove unavailable selection missing",
      }),
    );
    expect(mocks.update).toHaveBeenLastCalledWith({ selectedItems: [] });
  });

  it("refresh preserves missing selections, and never auto-selects newly found files", async () => {
    render(<Harness initial={["file:work"]} />);
    expect(
      await screen.findByRole("checkbox", { name: /Work database/ }),
    ).toBeChecked();
    mocks.discover.mockResolvedValue([
      { id: "file:new", label: "New database", kind: "file", available: true },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(
      await screen.findByRole("checkbox", { name: /New database/ }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /file:work/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /file:work/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 selected · 1 size unknown · 1 unavailable",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps selection and safely reports discovery failure without backend exception text", async () => {
    mocks.discover.mockRejectedValue(new Error("sensitive path and secret"));
    render(<Harness initial={["record:theme"]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load",
    );
    expect(screen.queryByText(/sensitive path/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select all available" }),
    ).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.discover.mockResolvedValue(inventory);
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(
      await screen.findByRole("checkbox", { name: /Theme preferences/ }),
    ).toBeChecked();
  });

  it("ignores a discovery completion after unmount", async () => {
    let finish!: (items: typeof inventory) => void;
    mocks.discover.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<Harness />);
    await waitFor(() => expect(mocks.discover).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => finish(inventory));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("distinguishes archive estimates, portable settings and locked stored sizes in rows and totals", async () => {
    mocks.discover.mockResolvedValue([
      { ...inventory[0], sizeKind: "archive-estimate" },
      { ...inventory[1], sizeKind: "portable-settings" },
      { ...inventory[2], bytes: 4096, sizeKind: "stored-encrypted" },
    ]);
    render(
      <Harness
        initial={["file:work", "record:theme", "file:locked", "missing"]}
      />,
    );
    await screen.findByRole("checkbox", { name: /Work database/ });
    expect(
      screen.getByText("2.0 KiB · archive estimate · Sensitive data"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("80 B · portable settings JSON"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("4.0 KiB · stored encrypted database file"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Locked vault/ }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 selected · 2.1 KiB estimated sync data · 4.0 KiB stored data · 1 size unknown · 2 unavailable",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not turn an unknown size into a zero total and explains missing metadata", async () => {
    mocks.discover.mockResolvedValue([
      {
        ...inventory[0],
        bytes: undefined,
        sizeUnavailableReason: "Stored file metadata is unavailable.",
      },
    ]);
    render(<Harness initial={["file:work"]} />);
    await screen.findByRole("checkbox", { name: /Work database/ });
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 selected · 1 size unknown",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("0 B");
    expect(
      screen.getByTitle("Stored file metadata is unavailable."),
    ).toHaveTextContent("Size unavailable");
  });

  it("updates measured sizes on refresh while preserving selections", async () => {
    render(<Harness initial={["file:work"]} />);
    await screen.findByRole("checkbox", { name: /Work database/ });
    mocks.discover.mockResolvedValue([
      { ...inventory[0], bytes: 8192, sizeKind: "archive-estimate" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(
      await screen.findByText("8.0 KiB · archive estimate · Sensitive data"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Work database/ }),
    ).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 selected · 8.0 KiB estimated sync data",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refreshes actual database bytes after saves and window focus without changing selections", async () => {
    const database = {
      ...inventory[0],
      kind: "database",
      sizeKind: "stored-encrypted",
    };
    mocks.discover.mockResolvedValue([database]);
    const view = render(<Harness initial={[database.id]} />);
    expect(
      await screen.findByText(
        "2.0 KiB · stored encrypted database file · Sensitive data",
      ),
    ).toBeInTheDocument();
    mocks.discover.mockResolvedValue([{ ...database, bytes: 8192 }]);
    act(() => {
      window.dispatchEvent(new Event("sorng-database-data-saved"));
      window.dispatchEvent(new Event("sorng-database-data-saved"));
    });
    expect(
      await screen.findByText(
        "8.0 KiB · stored encrypted database file · Sensitive data",
      ),
    ).toHaveAttribute("title", "8,192 bytes · stored encrypted database file");
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    mocks.discover.mockResolvedValue([{ ...database, bytes: 16384 }]);
    fireEvent.focus(window);
    await screen.findByText(
      "16.0 KiB · stored encrypted database file · Sensitive data",
    );
    expect(
      screen.getByRole("checkbox", { name: /Work database/ }),
    ).toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled();
    view.unmount();
    fireEvent.focus(window);
    window.dispatchEvent(new Event("sorng-database-data-saved"));
    expect(mocks.discover).toHaveBeenCalledTimes(3);
  });

  it("shows a missing database file distinctly and makes its reason visible", async () => {
    const reason =
      "The current database file is missing. Recovery backups are not counted.";
    mocks.discover.mockResolvedValue([
      {
        ...inventory[0],
        bytes: undefined,
        sizeStatus: "missing",
        sizeUnavailableReason: reason,
      },
    ]);
    render(<Harness />);
    expect(
      await screen.findByText("Database file missing · Sensitive data"),
    ).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeVisible();
    expect(screen.queryByText(/^0 B/)).not.toBeInTheDocument();
  });

  it("shows unselected empty app-wide libraries and includes them in select all", async () => {
    mocks.discover.mockResolvedValue([
      ...inventory,
      {
        id: "app:recording.terminal-macros",
        label: "Terminal macros (App-wide)",
        kind: "library",
        available: true,
        bytes: 45,
      },
    ]);
    render(<Harness />);
    await screen.findByRole("checkbox", { name: /Work database/ });
    expect(
      screen.getByRole("checkbox", { name: /Terminal macros \(App-wide\)/ }),
    ).not.toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Select all available" }),
    );
    expect(mocks.update).toHaveBeenLastCalledWith({
      selectedItems: [
        "file:work",
        "record:theme",
        "app:recording.terminal-macros",
      ],
    });
  });

  it("keeps an empty app-wide library visible after deselection and allows selecting it again", async () => {
    const id = "app:recording.terminal-macros";
    mocks.discover.mockResolvedValue([
      {
        id,
        label: "Terminal macros (App-wide)",
        kind: "library",
        available: true,
        bytes: 900,
        sizeKind: "stored-json",
      },
    ]);
    render(<Harness initial={[id]} />);
    expect(
      await screen.findByRole("checkbox", {
        name: /Terminal macros \(App-wide\)/,
      }),
    ).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 selected · 900 B stored data",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Deselect available" }));
    expect(mocks.update).toHaveBeenLastCalledWith({ selectedItems: [] });
    expect(
      screen.getByRole("checkbox", { name: /Terminal macros \(App-wide\)/ }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Terminal macros \(App-wide\)/ }),
    );
    expect(mocks.update).toHaveBeenLastCalledWith({ selectedItems: [id] });
  });

  it("selects app-wide documents independently of databases and refreshes their stored size without changing consent", async () => {
    const documents = {
      id: "app:documents.app-wide.v1",
      label: "Documents (App-wide)",
      kind: "library",
      available: true,
      sensitive: true,
      bytes: 128,
      sizeKind: "stored-json",
    };
    mocks.discover.mockResolvedValue([...inventory, documents]);
    render(<Harness />);
    const row = await screen.findByRole("checkbox", {
      name: /Documents \(App-wide\)/,
    });
    expect(row).not.toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      selectedItems: [documents.id],
    });
    expect(
      screen.getByRole("checkbox", { name: /Work database/ }),
    ).not.toBeChecked();
    mocks.discover.mockResolvedValue([
      ...inventory,
      { ...documents, bytes: 512 },
    ]);
    act(() =>
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: "documents.app-wide.v1" },
        }),
      ),
    );
    await screen.findByText("512 B · stored JSON · Sensitive data");
    expect(
      screen.getByRole("checkbox", { name: /Documents \(App-wide\)/ }),
    ).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 selected · 512 B stored data",
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  const migrated = {
    id: "app:recording.terminal-macros",
    label: "Terminal macros (App-wide)",
    kind: "library",
    available: true,
    emptyLegacy: true,
    retiredLegacy: { databaseId: "owner" },
    bytes: 2048,
    sizeKind: "stored-json",
  };
  const destination = {
    id: "database:owner",
    label: "Destination database",
    kind: "database",
    available: true,
  };

  it("ignores old retirement flags and preserves app-wide consent without selecting the destination", async () => {
    mocks.discover.mockResolvedValue([...inventory, destination, migrated]);
    render(<Harness initial={[migrated.id, "file:work", "missing"]} />);
    expect(
      await screen.findByRole("checkbox", {
        name: /Terminal macros \(App-wide\)/,
      }),
    ).toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: /Destination database/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Terminal macros \(App-wide\)/ }),
    ).toBeEnabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "3 selected · 4.0 KiB stored data · 1 size unknown · 1 unavailable",
    );
  });

  it("preserves app-wide selection and sizes when sync goes from busy to idle", async () => {
    mocks.discover.mockResolvedValue([destination, migrated]);
    const view = render(<Harness initial={[migrated.id]} busy />);
    expect(
      await screen.findByRole("checkbox", {
        name: /Terminal macros \(App-wide\)/,
      }),
    ).toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled();
    view.rerender(<Harness initial={[migrated.id]} busy={false} />);
    await waitFor(() => expect(mocks.discover).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Loading inventory…")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("checkbox", { name: /Terminal macros \(App-wide\)/ }),
    ).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 selected · 2.0 KiB stored data",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: /Destination database/ }),
    ).not.toBeChecked();
  });

  it("keeps unselected app-wide libraries visible even with old retirement flags", async () => {
    mocks.discover.mockResolvedValue([destination, migrated]);
    render(<Harness />);
    expect(
      await screen.findByRole("checkbox", {
        name: /Terminal macros \(App-wide\)/,
      }),
    ).not.toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Terminal macros \(App-wide\)/ }),
    );
    expect(mocks.update).toHaveBeenLastCalledWith({
      selectedItems: [migrated.id],
    });
    expect(
      screen.getByRole("checkbox", { name: /Destination database/ }),
    ).not.toBeChecked();
  });

  it("preserves app-wide selections through a completed migration and inventory refresh", async () => {
    mocks.discover.mockResolvedValue([
      destination,
      { ...migrated, retiredLegacy: undefined },
    ]);
    render(<Harness initial={[migrated.id, destination.id]} />);
    await screen.findByRole("checkbox", {
      name: /Terminal macros \(App-wide\)/,
    });
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.discover.mockResolvedValue([destination, migrated]);
    act(() =>
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: "recording.terminal-library-migration.v1" },
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await waitFor(() => expect(mocks.discover).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Loading inventory…")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("checkbox", { name: /Terminal macros \(App-wide\)/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Destination database/ }),
    ).toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not change selections from an unmounted discovery with old retirement flags", async () => {
    let finish!: (items: unknown[]) => void;
    mocks.discover.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<Harness initial={[migrated.id]} />);
    view.unmount();
    await act(async () => finish([destination, migrated]));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refreshes on relevant successful store writes, coalesces batches and preserves selections", async () => {
    render(<Harness initial={["file:work"]} />);
    await screen.findByRole("checkbox", { name: /Work database/ });
    mocks.discover.mockResolvedValue([{ ...inventory[0], bytes: 8192 }]);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: "unrelated" },
        }),
      );
    });
    expect(mocks.discover).toHaveBeenCalledTimes(1);
    act(() => {
      for (const key of [
        "recording.managed-scripts",
        "recording.terminal-macros",
        "recording.web-automation.v1",
        "documents.app-wide.v1",
      ])
        window.dispatchEvent(
          new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, { detail: { key } }),
        );
    });
    await screen.findByText("8.0 KiB · Sensitive data");
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("checkbox", { name: /Work database/ }),
    ).toBeChecked();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("ignores pre-write discovery and removes store listeners on unmount", async () => {
    let finish!: (items: typeof inventory) => void;
    mocks.discover.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<Harness />);
    mocks.discover.mockResolvedValue([{ ...inventory[0], bytes: 8192 }]);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: "recording.managed-scripts" },
        }),
      );
    });
    await act(async () => finish(inventory));
    expect(
      screen.queryByText("2.0 KiB · Sensitive data"),
    ).not.toBeInTheDocument();
    await screen.findByText("8.0 KiB · Sensitive data");
    view.unmount();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: "recording.terminal-macros" },
        }),
      );
    });
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });
});
