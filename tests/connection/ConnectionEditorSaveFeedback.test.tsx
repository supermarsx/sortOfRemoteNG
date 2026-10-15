import React, { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import type { Connection } from "../../src/types/connection/connection";

const fixture = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  autoSaveEnabled: false,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("../../src/utils/connection/databaseManager", () => {
  const manager = {
    getCurrentDatabase: () => ({ id: "fixture-db" }),
    onCurrentDatabaseChange: () => () => {},
    registerBeforeDatabaseTransition: () => () => {},
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "fixture-db",
      assertAccessible: () => {},
      load: fixture.load,
      save: fixture.save,
    }),
  };
  return {
    DatabaseManager: { getInstance: () => manager },
    onCurrentDatabaseChange: () => () => {},
  };
});
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: fixture.toast }),
}));
vi.mock("../../src/contexts/SettingsContext", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/contexts/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        ...actual.defaultSettings,
        autoSaveEnabled: fixture.autoSaveEnabled,
      },
      updateSettings: vi.fn(),
    }),
  };
});

const initial: Connection = {
  id: "fixture-connection",
  name: "Fixture connection",
  protocol: "http",
  hostname: "fixture.example",
  port: 80,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// Match ToolPanel's live reducer lookup, not a fixed connection prop. A save
// publishes its optimistic connection before the storage promise settles.
function LiveEditor({
  id = initial.id,
  isOpen = true,
  onClose,
}: {
  id?: string;
  isOpen?: boolean;
  onClose: () => void;
}) {
  const { state, loadData } = useConnections();
  useEffect(() => {
    void loadData("fixture-db");
  }, [loadData]);
  const connection = state.connections.find((candidate) => candidate.id === id);
  return connection ? (
    <ConnectionEditor
      connection={connection}
      isOpen={isOpen}
      onClose={onClose}
    />
  ) : null;
}
function mountEditor(onClose = vi.fn()) {
  const view = render(
    <ConnectionProvider>
      <LiveEditor onClose={onClose} />
    </ConnectionProvider>,
  );
  return { ...view, onClose };
}
async function editName(name = "Edited connection") {
  const input = await screen.findByDisplayValue(initial.name);
  fireEvent.change(input, { target: { value: name } });
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.autoSaveEnabled = false;
  fixture.save.mockReset().mockResolvedValue(undefined);
  fixture.load.mockResolvedValue({
    connections: [initial],
    settings: {},
    timestamp: 0,
    tabGroups: [],
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("live connection editor save feedback", () => {
  it("reports success exactly once only after the real provider flush finishes", async () => {
    const pending = deferred();
    fixture.save.mockImplementationOnce(() => pending.promise);
    const { onClose } = mountEditor();
    await editName();
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1));
    expect(screen.getByDisplayValue("Edited connection")).toBeInTheDocument();
    expect(fixture.toast.success).not.toHaveBeenCalled();
    expect(fixture.toast.error).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    await waitFor(() => expect(fixture.toast.success).toHaveBeenCalledTimes(1));
    expect(fixture.toast.success).toHaveBeenCalledWith(
      '"Edited connection" saved',
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(fixture.toast.info).toHaveBeenCalledWith("No changes to save");
    expect(fixture.toast.info).toHaveBeenCalledTimes(1);
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.toast.success).toHaveBeenCalledTimes(1);
  });

  it("reports a failed flush, retains the draft, and retries instead of declaring no changes", async () => {
    const pending = deferred();
    fixture.save.mockImplementationOnce(() => pending.promise);
    const { onClose } = mountEditor();
    await editName();
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1));
    await act(async () => {
      pending.reject(new Error("Fixture storage unavailable"));
      await pending.promise.catch(() => {});
    });
    await waitFor(() => expect(fixture.toast.error).toHaveBeenCalledTimes(1));
    expect(fixture.toast.error).toHaveBeenCalledWith(
      "Connection was not saved. Fixture storage unavailable",
    );
    expect(fixture.toast.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Edited connection")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.toast.success).toHaveBeenCalledTimes(1));
    expect(fixture.save).toHaveBeenCalledTimes(2);
    expect(fixture.toast.info).not.toHaveBeenCalled();
    expect(fixture.toast.error).toHaveBeenCalledTimes(1);
  });

  it("saves a reverted draft instead of saying no changes while an older write is pending", async () => {
    const pending = deferred();
    fixture.save.mockImplementationOnce(() => pending.promise);
    const { onClose } = mountEditor();
    const input = await editName();
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: initial.name } });
    // Saving is single-flight: the reverted draft waits for the next Save.
    expect(screen.getByTestId("editor-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.toast.info).not.toHaveBeenCalled();
    expect(fixture.toast.success).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("editor-save")).not.toBeDisabled(),
    );
    expect(fixture.toast.info).not.toHaveBeenCalled();
    expect(fixture.toast.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.toast.success).toHaveBeenCalledTimes(1));
    expect(fixture.save).toHaveBeenCalledTimes(2);
    expect(fixture.save.mock.calls[1][0].connections[0].name).toBe(
      initial.name,
    );
    expect(fixture.toast.success).toHaveBeenCalledWith(
      '"Fixture connection" saved',
    );
    expect(fixture.toast.info).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("pending bookmark connection save", () => {
  it("persists a name-only bookmark draft through the main Save without a nested save", async () => {
    fixture.load.mockResolvedValue({
      connections: [
        { ...initial, httpBookmarks: [{ name: "Status", path: "/status" }] },
      ],
      settings: {},
      timestamp: 0,
      tabGroups: [],
    });
    mountEditor();
    await screen.findByDisplayValue(initial.name);
    fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
    fireEvent.click(
      screen.getByTestId("connection-editor-protocol-subtab-favorites"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit bookmark Status" }),
    );
    fireEvent.change(screen.getByLabelText("Bookmark name"), {
      target: { value: "New status" },
    });
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1));
    expect(fixture.save.mock.calls[0][0].connections[0].httpBookmarks).toEqual([
      { name: "New status", path: "/status" },
    ]);
    expect(fixture.toast.info).not.toHaveBeenCalledWith("No changes to save");
  });
});

async function openBookmarkDraft() {
  fixture.load.mockResolvedValue({
    connections: [
      {
        ...initial,
        httpBookmarks: [
          {
            name: "Status",
            path: "/status",
            customMetadata: { color: "green" },
          },
        ],
      },
    ],
    settings: {},
    timestamp: 0,
    tabGroups: [],
  });
  mountEditor();
  await screen.findByDisplayValue(initial.name);
  fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
  fireEvent.click(
    screen.getByTestId("connection-editor-protocol-subtab-favorites"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit bookmark Status" }));
}

describe("main Save bookmark validation and cancellation", () => {
  it.each([
    ["Bookmark name", "   "],
    ["Bookmark URL or path", ""],
    ["Bookmark URL or path", "javascript:alert(1)"],
    ["Bookmark URL or path", "https://user:password@fixture.example/"],
  ])(
    "blocks invalid %s (%s) without saving another changed field",
    async (label, value) => {
      await openBookmarkDraft();
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.click(screen.getByTestId("connection-editor-tab-general"));
      fireEvent.change(screen.getByDisplayValue(initial.name), {
        target: { value: "Other change" },
      });
      fireEvent.click(screen.getByTestId("editor-save"));
      await waitFor(() => expect(fixture.toast.error).toHaveBeenCalledTimes(1));
      expect(fixture.save).not.toHaveBeenCalled();
      expect(fixture.toast.success).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toHaveValue(value);
    },
  );
  it("cancels the local name and saves an unrelated edit with the original tree", async () => {
    await openBookmarkDraft();
    fireEvent.change(screen.getByLabelText("Bookmark name"), {
      target: { value: "Discard me" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel bookmark edit" }),
    );
    fireEvent.click(screen.getByTestId("connection-editor-tab-general"));
    fireEvent.change(screen.getByDisplayValue(initial.name), {
      target: { value: "Other change" },
    });
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(1));
    expect(fixture.save.mock.calls[0][0].connections[0].httpBookmarks).toEqual([
      { name: "Status", path: "/status", customMetadata: { color: "green" } },
    ]);
  });
  it("retains the pending bookmark across tabs and failed durable saves for retry", async () => {
    await openBookmarkDraft();
    fireEvent.change(screen.getByLabelText("Bookmark name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByTestId("connection-editor-tab-general"));
    fixture.save.mockRejectedValueOnce(new Error("disk unavailable"));
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.toast.error).toHaveBeenCalled());
    expect(fixture.toast.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
    expect(screen.getByLabelText("Bookmark name")).toHaveValue("Renamed");
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(fixture.toast.success).toHaveBeenCalledTimes(1));
    expect(
      fixture.save.mock.calls[fixture.save.mock.calls.length - 1][0]
        .connections[0].httpBookmarks,
    ).toEqual([
      { name: "Renamed", path: "/status", customMetadata: { color: "green" } },
    ]);
    expect(screen.queryByLabelText("Bookmark name")).not.toBeInTheDocument();
  });
});

it("clears a bookmark error when correcting the field before main Save", async () => {
  await openBookmarkDraft();
  fireEvent.change(screen.getByLabelText("Bookmark URL or path"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByTestId("editor-save"));
  await screen.findByRole("alert");
  fireEvent.change(screen.getByLabelText("Bookmark URL or path"), {
    target: { value: "/fixed" },
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("editor-save"));
  await waitFor(() => expect(fixture.toast.success).toHaveBeenCalledTimes(1));
  expect(
    fixture.save.mock.calls[0][0].connections[0].httpBookmarks[0].path,
  ).toBe("/fixed");
});

it.each([false, true])(
  "combines removal and pending rename (earlier removal saved=%s)",
  async (saveRemovalFirst) => {
    fixture.load.mockResolvedValue({
      connections: [
        {
          ...initial,
          httpBookmarks: [
            { name: "Remove", path: "/remove" },
            { name: "Keep", path: "/keep" },
          ],
        },
      ],
      settings: {},
      timestamp: 0,
      tabGroups: [],
    });
    mountEditor();
    await screen.findByDisplayValue(initial.name);
    fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
    fireEvent.click(
      screen.getByTestId("connection-editor-protocol-subtab-favorites"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove bookmark Remove" }),
    );
    if (saveRemovalFirst) {
      fireEvent.click(screen.getByTestId("editor-save"));
      await waitFor(() =>
        expect(fixture.toast.success).toHaveBeenCalledTimes(1),
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Edit bookmark Keep" }));
    fireEvent.change(screen.getByLabelText("Bookmark name"), {
      target: { value: "Renamed survivor" },
    });
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() =>
      expect(fixture.toast.success).toHaveBeenCalledTimes(
        saveRemovalFirst ? 2 : 1,
      ),
    );
    expect(fixture.save).toHaveBeenCalledTimes(saveRemovalFirst ? 2 : 1);
    expect(
      fixture.save.mock.calls[saveRemovalFirst ? 1 : 0][0].connections[0]
        .httpBookmarks,
    ).toEqual([{ name: "Renamed survivor", path: "/keep" }]);
  },
);
