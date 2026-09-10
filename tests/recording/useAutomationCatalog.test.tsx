import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAutomationCatalog,
  type AutomationCatalogOptions,
} from "../../src/hooks/recording/useAutomationCatalog";
import type {
  AutomationEntry,
  AutomationLibraryApi,
  AutomationLibrarySnapshot,
} from "../../src/types/recording/automationLibrary";
import {
  catalogFromFile,
  exportAutomationCatalog,
  MAX_AUTOMATION_CATALOG_BYTES,
} from "../../src/utils/recording/automationCatalog";
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../../src/utils/recording/automationCatalog", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/automationCatalog")
  >()),
  fetchAutomationCatalog: h.fetch,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: h.open, save: h.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: h.stat,
  readTextFile: h.read,
  writeTextFile: h.write,
}));
const entry: AutomationEntry<"website-script"> = {
  family: "website-script",
  payload: {
    id: "fixture-script",
    kind: "script",
    name: "Fixture",
    description: "",
    code: "document.title",
    createdAt: "2026-09-10T10:00:00Z",
    updatedAt: "2026-09-10T10:00:00Z",
  },
};
const body = () =>
  exportAutomationCatalog({ name: "Fixture manifest", entries: [entry] });
const snapshot = (): AutomationLibrarySnapshot => ({
  scope: { kind: "database", databaseId: "database-a" },
  family: "website-script",
  receipt: "receipt-a",
  entries: [entry],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
beforeEach(async () => {
  vi.clearAllMocks();
  h.fetch.mockReset().mockResolvedValue(await catalogFromFile(body()));
  h.open.mockReset().mockResolvedValue("fixture.json");
  h.save.mockReset().mockResolvedValue("fixture-export.json");
  h.stat.mockReset().mockResolvedValue({ isFile: true, size: 1024 });
  h.read.mockReset().mockResolvedValue(body());
  h.write.mockReset().mockResolvedValue(undefined);
});
function mount() {
  const read = vi.fn(async () => snapshot());
  const apply = vi.fn(async () => snapshot());
  const api = { read, apply } as AutomationLibraryApi;
  let options: AutomationCatalogOptions = {
    api,
    scope: { kind: "database", databaseId: "database-a" },
    family: "website-script",
    enabled: true,
    accessKey: "lease-a-1",
  };
  const view = renderHook(() => useAutomationCatalog(options));
  return {
    ...view,
    read,
    apply,
    update(next: Partial<AutomationCatalogOptions>) {
      options = { ...options, ...next };
      view.rerender();
    },
  };
}
describe("manual catalog transport and review lifecycle", () => {
  it("refuses exporting a destination changed since explicit selection and masks it on lock", async () => {
    const view = mount();
    await act(async () => {
      await view.result.current.loadDestination();
    });
    const reviewed = view.result.current.destination!;
    view.read.mockResolvedValueOnce({ ...snapshot(), entries: [] });
    await act(async () => {
      await view.result.current.exportSelected([entry.payload.id], reviewed);
    });
    expect(h.save).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain("changed since review");
    const oldLoad = view.result.current.loadDestination;
    view.update({ enabled: false, accessKey: "locked" });
    expect(view.result.current.destination).toBeNull();
    view.update({ enabled: true, accessKey: "unlocked" });
    view.read.mockClear();
    await act(async () => {
      expect(await oldLoad()).toBe(false);
    });
    expect(view.read).not.toHaveBeenCalled();
    expect(view.result.current.destination).toBeNull();
  });
  it("never fetches/imports on mount and keeps fetch, review, and apply separate", async () => {
    const view = mount();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(view.read).not.toHaveBeenCalled();
    await act(async () => {
      await view.result.current.refresh("https://example.com/index.json");
    });
    expect(view.result.current.document).not.toBeNull();
    expect(view.apply).not.toHaveBeenCalled();
    await act(async () => {
      await view.result.current.review([entry.payload.id]);
    });
    expect(view.result.current.preview?.rows).toEqual([
      {
        id: entry.payload.id,
        name: "Fixture",
        conflict: true,
        canReplace: true,
      },
    ]);
    expect(view.apply).not.toHaveBeenCalled();
    await act(async () => {
      await view.result.current.apply({ [entry.payload.id]: "copy" });
    });
    expect(view.apply).toHaveBeenCalledOnce();
    expect(view.result.current.preview).toBeNull();
  });
  it("only publishes the latest manual refresh and cancellation ignores a late reply", async () => {
    const old = deferred<Awaited<ReturnType<typeof catalogFromFile>>>();
    h.fetch.mockReturnValueOnce(old.promise);
    const view = mount();
    let pending!: Promise<boolean>;
    act(() => {
      pending = view.result.current.refresh("https://example.com/old.json");
    });
    await act(async () => {
      await view.result.current.refresh("https://example.com/new.json");
    });
    const accepted = view.result.current.document;
    await act(async () => {
      old.resolve({
        ...(await catalogFromFile(body())),
        manifest: { ...accepted!.manifest, name: "OLD" },
      });
      await pending;
    });
    expect(view.result.current.document).toBe(accepted);
    const cancelled = deferred<Awaited<ReturnType<typeof catalogFromFile>>>();
    h.fetch.mockReturnValueOnce(cancelled.promise);
    act(() => {
      pending = view.result.current.refresh(
        "https://example.com/cancelled.json",
      );
    });
    act(() => view.result.current.cancel());
    await act(async () => {
      cancelled.resolve(await catalogFromFile(body()));
      await pending;
    });
    expect(view.result.current.document).toBe(accepted);
    expect(view.result.current.busy).toBe(false);
  });
  it("retains a failed refresh's last source as stale and refuses import review", async () => {
    const view = mount();
    await act(async () => {
      await view.result.current.refresh("https://example.com/index.json");
    });
    const accepted = view.result.current.document;
    h.fetch.mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => {
      await view.result.current.refresh("https://example.com/index.json");
    });
    expect(view.result.current.document).toBe(accepted);
    expect(view.result.current.stale).toBe(true);
    await act(async () => {
      await view.result.current.review([entry.payload.id]);
    });
    expect(view.result.current.error).toContain("valid source");
    expect(view.read).not.toHaveBeenCalled();
  });
  it("invalidates review on database switch and lock/unlock ABA", async () => {
    const view = mount();
    await act(async () => {
      await view.result.current.importFile();
      await view.result.current.review([entry.payload.id]);
    });
    expect(view.result.current.preview).not.toBeNull();
    view.update({
      scope: { kind: "database", databaseId: "database-b" },
      accessKey: "lease-b-1",
    });
    expect(view.result.current.preview).toBeNull();
    await act(async () => {
      await view.result.current.apply({ [entry.payload.id]: "replace" });
    });
    expect(view.apply).not.toHaveBeenCalled();
    view.update({ enabled: false, accessKey: "locked" });
    view.update({ enabled: true, accessKey: "lease-b-2" });
    expect(view.result.current.preview).toBeNull();
  });
  it("cancelled Open does not read, and changing access while Open waits prevents reads", async () => {
    h.open.mockResolvedValueOnce(null);
    const view = mount();
    await act(async () => {
      await view.result.current.importFile();
    });
    expect(h.stat).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    const dialog = deferred<string>();
    h.open.mockReturnValueOnce(dialog.promise);
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = view.result.current.importFile();
    });
    view.update({ accessKey: "revoked-then-unlocked" });
    await act(async () => {
      dialog.resolve("fixture.json");
      await pending;
    });
    expect(h.stat).not.toHaveBeenCalled();
  });
  it("enforces both stat-before-read and post-read byte bounds", async () => {
    const view = mount();
    h.stat.mockResolvedValueOnce({
      isFile: true,
      size: MAX_AUTOMATION_CATALOG_BYTES + 1,
    });
    await act(async () => {
      await view.result.current.importFile();
    });
    expect(h.read).not.toHaveBeenCalled();
    h.read.mockResolvedValueOnce("x".repeat(MAX_AUTOMATION_CATALOG_BYTES + 1));
    await act(async () => {
      await view.result.current.importFile();
    });
    expect(view.result.current.error).toContain("2 MiB");
    expect(view.result.current.document).toBeNull();
    expect(view.apply).not.toHaveBeenCalled();
  });
  it("stale Save dialog cannot export private source after access changes", async () => {
    const dialog = deferred<string>();
    h.save.mockReturnValueOnce(dialog.promise);
    const view = mount();
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = view.result.current.exportSelected([entry.payload.id]);
    });
    view.update({ accessKey: "new-owner-epoch" });
    await act(async () => {
      dialog.resolve("fixture.json");
      await pending;
    });
    expect(h.write).not.toHaveBeenCalled();
  });
  it("exports only current reviewed entries, rechecks after Save, and does not execute", async () => {
    const view = mount();
    await act(async () => {
      await view.result.current.exportSelected([entry.payload.id]);
    });
    expect(view.read).toHaveBeenCalledTimes(2);
    expect(h.write).toHaveBeenCalledOnce();
    expect(JSON.parse(h.write.mock.calls[0][1]).entries[0].payload).toEqual(
      entry.payload,
    );
    expect(view.apply).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
    h.write.mockClear();
    view.read
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce({ ...snapshot(), entries: [] });
    await act(async () => {
      await view.result.current.exportSelected([entry.payload.id]);
    });
    expect(h.write).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain("library changed");
  });
});
