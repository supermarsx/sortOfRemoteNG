import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SynologySessionContent } from "../../src/components/synology/SynologyPanel";
import type { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import type { FileListResult } from "../../src/types/hardware/synology";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: ({ paused }: { paused?: boolean }) => (
    <span data-testid="configured-app-loader" data-paused={String(paused)} />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

type PendingRead = {
  args: Record<string, unknown>;
  resolve: (value: FileListResult) => void;
  reject: (error: Error) => void;
};
let reads: PendingRead[];
const connection = (id = "a") =>
  ({
    instanceId: `instance-${id}`,
    sessionId: `session-${id}`,
    host: `nas-${id}.test`,
    port: 5001,
    connectionStatus: "connected",
    assertSessionAccess: () => {},
    notifySessionExpired: vi.fn(),
    disconnect: vi.fn(),
  }) as unknown as ReturnType<typeof useSynologyFileConnection>;
const shares: FileListResult = {
  files: [{ name: "public", path: "/public", isdir: true }],
  total: 1,
  offset: 0,
};
const folder: FileListResult = {
  files: [
    { name: "notes.txt", path: "/public/notes.txt", isdir: false },
    { name: "docs", path: "/public/docs", isdir: true },
  ],
  total: 2,
  offset: 0,
};
const empty: FileListResult = { files: [], total: 0, offset: 0 };
const readAt = async (index: number) => {
  await waitFor(() => expect(reads.length).toBeGreaterThan(index));
  return reads[index];
};
const resolveRead = async (index: number, value: FileListResult) => {
  const read = await readAt(index);
  await act(async () => read.resolve(value));
};
const shell = () => ({
  explorer: screen.getByTestId("synology-file-station"),
  table: screen.getByRole("table", { name: "File Station files" }),
  breadcrumbs: screen.getByRole("navigation", { name: "File Station folders" }),
  footer: screen.getByRole("button", { name: "Previous" }).parentElement,
});
const expectSameShell = (original: ReturnType<typeof shell>) => {
  const current = shell();
  for (const key of Object.keys(original) as (keyof typeof original)[])
    expect(current[key]).toBe(original[key]);
};
const expectNoFalseEmpty = () => {
  expect(screen.queryByText("This folder is empty.")).not.toBeInTheDocument();
  expect(
    screen.queryByText("No shared folders are available to this account."),
  ).not.toBeInTheDocument();
};
const openFolder = async () => {
  await resolveRead(0, shares);
  fireEvent.click(screen.getByRole("button", { name: "public" }));
  await resolveRead(1, folder);
};

beforeEach(() => {
  reads = [];
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation((command, args) => {
      if (command !== "syn_fs_list") return Promise.resolve(null);
      return new Promise<FileListResult>((resolve, reject) => {
        reads.push({ args: args as Record<string, unknown>, resolve, reject });
      });
    });
});
afterEach(cleanup);

describe("File Station in-list loading", () => {
  it("mounts the complete explorer during the first shared-folder request and keeps its DOM on completion", async () => {
    render(<SynologySessionContent connection={connection()} />);
    const original = shell();
    expect(original.table).toHaveAttribute("aria-busy", "true");
    expect(within(original.explorer).getByRole("status")).toHaveTextContent(
      "Loading shared folders…",
    );
    expect(screen.getAllByTestId("file-list-skeleton")).toHaveLength(4);
    expectNoFalseEmpty();
    expect(
      screen.getByRole("button", { name: "Refresh files" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Shared folders" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Select this page")).toBeDisabled();
    await resolveRead(0, shares);
    expectSameShell(original);
    expect(original.table).toHaveAttribute("aria-busy", "false");
    expect(
      within(original.table).getByRole("button", { name: "public" }),
    ).toBeEnabled();
    expect(screen.queryByTestId("file-list-skeleton")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Loading shared folders…"),
    ).not.toBeInTheDocument();
  });

  it("retains table, breadcrumbs and footer while navigating, masks the old folder and publishes the new rows", async () => {
    render(<SynologySessionContent connection={connection()} />);
    await openFolder();
    const original = shell();
    fireEvent.click(screen.getByRole("button", { name: "docs" }));
    const next = await readAt(2);
    expect(next.args.folderPath).toBe("/public/docs");
    expectSameShell(original);
    expect(original.table).toHaveAttribute("aria-busy", "true");
    expect(
      within(original.breadcrumbs).getByRole("button", { name: "docs" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Folder path")).toHaveValue("/public/docs");
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByText("Loading folder contents…")).toBeInTheDocument();
    expectNoFalseEmpty();
    for (const name of [
      "New folder",
      "Upload",
      "Download",
      "Rename",
      "Copy",
      "Move",
      "Delete",
      "Search",
    ])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Parent folder" })).toBeEnabled();
    await resolveRead(2, {
      files: [{ name: "new.txt", path: "/public/docs/new.txt", isdir: false }],
      total: 1,
      offset: 0,
    });
    expectSameShell(original);
    expect(within(original.table).getByText("new.txt")).toBeInTheDocument();
    expect(original.table).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
  });

  it("keeps existing rows read-only during same-folder refresh without remounting them", async () => {
    render(<SynologySessionContent connection={connection()} />);
    await openFolder();
    const original = shell();
    const row = screen.getByText("notes.txt").closest("tr");
    fireEvent.click(screen.getByLabelText("Select notes.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh files" }));
    await readAt(2);
    expectSameShell(original);
    expect(screen.getByText("notes.txt").closest("tr")).toBe(row);
    expect(original.table).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Refreshing folder contents…")).toBeInTheDocument();
    expect(screen.getByLabelText("Select notes.txt")).toBeDisabled();
    expect(screen.getByRole("button", { name: "docs" })).toBeDisabled();
    for (const name of [
      "Download",
      "Delete",
      "Share selected item",
      "Details & permissions",
    ])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([command]) => command === "syn_fs_list"),
    ).toBe(true);
    await resolveRead(2, empty);
    expectSameShell(original);
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByText("This folder is empty.")).toBeInTheDocument();
  });

  it("keeps the explorer usable after a failed read and retries only when requested", async () => {
    render(<SynologySessionContent connection={connection()} />);
    await resolveRead(0, shares);
    const original = shell();
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    const pending = await readAt(1);
    await act(async () =>
      pending.reject(new Error("Permission denied for this folder.")),
    );
    expectSameShell(original);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Permission denied for this folder.",
    );
    expect(original.table).toHaveAttribute("aria-busy", "false");
    expectNoFalseEmpty();
    expect(screen.getByRole("button", { name: "Refresh files" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Parent folder" })).toBeEnabled();
    expect(reads).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Refresh files" }));
    await readAt(2);
    expectSameShell(original);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await resolveRead(2, folder);
    expectSameShell(original);
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("allows navigation away from a pending folder and ignores its late response", async () => {
    render(<SynologySessionContent connection={connection()} />);
    await openFolder();
    const original = shell();
    fireEvent.click(screen.getByRole("button", { name: "docs" }));
    await readAt(2);
    fireEvent.click(screen.getByRole("button", { name: "Shared folders" }));
    expect((await readAt(3)).args.folderPath).toBeNull();
    await resolveRead(3, shares);
    await resolveRead(2, {
      files: [
        {
          name: "late-private.txt",
          path: "/public/docs/late-private.txt",
          isdir: false,
        },
      ],
      total: 1,
      offset: 0,
    });
    expectSameShell(original);
    expect(screen.getByLabelText("Folder path")).toHaveValue("/");
    expect(screen.queryByText("late-private.txt")).not.toBeInTheDocument();
    expect(
      within(original.table).getByRole("button", { name: "public" }),
    ).toBeInTheDocument();
  });

  it("masks previous NAS rows and selections on scope replacement and ignores the previous session's late read", async () => {
    const view = render(<SynologySessionContent connection={connection()} />);
    await openFolder();
    fireEvent.click(screen.getByLabelText("Select notes.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh files" }));
    await readAt(2);
    view.rerender(<SynologySessionContent connection={connection("b")} />);
    const next = await readAt(3);
    expect(next.args).toMatchObject({
      instanceId: "instance-b",
      expectedSessionId: "session-b",
      folderPath: null,
    });
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Folder path")).toHaveValue("/");
    expect(
      screen.getByRole("table", { name: "File Station files" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expectNoFalseEmpty();
    await resolveRead(2, folder);
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    await resolveRead(3, {
      files: [{ name: "other-share", path: "/other-share", isdir: true }],
      total: 1,
      offset: 0,
    });
    expect(
      screen.getByRole("button", { name: "other-share" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(
      screen.queryByText("1 selected", { exact: false }),
    ).not.toBeInTheDocument();
  });
});
