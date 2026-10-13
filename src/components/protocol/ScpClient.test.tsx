import { readFileSync } from "node:fs";
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
import type { ConnectionSession } from "../../types/connection/connection";
import type {
  PromptDecision,
  PromptOptions,
  PromptRequest,
} from "../../utils/prompts/promptQueue";

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

// The real queue, observed: every request is recorded, and a test may answer
// in the host's place to reach an order of events the dialog cannot produce.
const prompts = vi.hoisted(() => ({
  requests: [] as unknown[],
  answer: null as
    null | ((request: unknown, options: unknown) => Promise<unknown>),
}));

vi.mock("../../hooks/protocol/useScpClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useScpClient: (...args: unknown[]) => mocks.hook(...args),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mocks.open(...args),
  save: (...args: unknown[]) => mocks.save(...args),
}));

// The real builder, observed: what the client hands it is recorded.
const builders = vi.hoisted(() => ({ remoteDelete: [] as unknown[] }));

vi.mock("../../utils/prompts/runPromptRequests", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../utils/prompts/runPromptRequests")
    >();
  return {
    ...actual,
    remoteDeletePrompt: (
      input: Parameters<typeof actual.remoteDeletePrompt>[0],
    ) => {
      builders.remoteDelete.push(input);
      return actual.remoteDeletePrompt(input);
    },
  };
});

vi.mock("../../utils/prompts/promptQueue", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/prompts/promptQueue")>();
  return {
    ...actual,
    requestPrompt: (request: PromptRequest, options?: PromptOptions) => {
      prompts.requests.push(request);
      return prompts.answer
        ? prompts.answer(request, options)
        : actual.requestPrompt(request, options);
    },
  };
});

import { PromptHost } from "../ui/dialogs/PromptHost";
import {
  PromptHostUnavailableError,
  resetPromptQueueForTests,
} from "../../utils/prompts/promptQueue";
import { ScpClient } from "./ScpClient";

const session: ConnectionSession = {
  id: "frontend-scp-1",
  connectionId: "connection-scp-1",
  name: "SCP host",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "scp",
  hostname: "scp.example.test",
  backendSessionId: "backend-scp-1",
};

const remoteEntries = [
  {
    name: "logs",
    path: "/srv/files/logs",
    size: 0,
    isDir: true,
    isFile: false,
    isSymlink: false,
    mode: "drwxr-xr-x",
    mtime: "2026-01-01 10:00",
    owner: "operator",
    group: "staff",
  },
  {
    name: "report.txt",
    path: "/srv/files/report.txt",
    size: 1024,
    isDir: false,
    isFile: true,
    isSymlink: false,
    mode: "-rw-r--r--",
    mtime: "2026-01-01 11:00",
    owner: "operator",
    group: "staff",
  },
];

const createModel = () => ({
  status: "connected" as "connecting" | "connected" | "disconnected" | "error",
  error: null,
  backendSessionId: "backend-scp-1" as string | null,
  homePath: "/home/operator",
  currentPath: "/srv/files",
  entries: remoteEntries,
  isBusy: false,
  lastTransfer: null,
  loadDirectory: vi.fn().mockResolvedValue(remoteEntries),
  refreshDirectory: vi.fn().mockResolvedValue(remoteEntries),
  navigateUp: vi.fn().mockResolvedValue(remoteEntries),
  stat: vi.fn(),
  checksum: vi.fn().mockResolvedValue("real-sha256"),
  mkdir: vi.fn().mockResolvedValue(remoteEntries),
  deleteEntry: vi.fn().mockResolvedValue(remoteEntries),
  uploadFile: vi.fn().mockResolvedValue({
    transferId: "upload-file",
    direction: "upload",
    localPath: "C:\\tmp\\upload.txt",
    remotePath: "/srv/files/upload.txt",
    bytesTransferred: 128,
    durationMs: 1,
    averageSpeed: 128000,
    success: true,
  }),
  downloadFile: vi.fn().mockResolvedValue({
    transferId: "download-file",
    direction: "download",
    localPath: "C:\\Downloads\\report.txt",
    remotePath: "/srv/files/report.txt",
    bytesTransferred: 1024,
    durationMs: 1,
    averageSpeed: 1024000,
    success: true,
  }),
  uploadDirectory: vi.fn().mockResolvedValue({
    transferId: "upload-folder",
    direction: "upload",
    localPath: "C:\\tmp\\assets",
    remotePath: "/srv/files/assets",
    filesTransferred: 2,
    filesFailed: 0,
    filesSkipped: 0,
    totalBytes: 256,
    durationMs: 1,
    averageSpeed: 256000,
    errors: [],
  }),
  downloadDirectory: vi.fn().mockResolvedValue({
    transferId: "download-folder",
    direction: "download",
    localPath: "C:\\Downloads\\logs",
    remotePath: "/srv/files/logs",
    filesTransferred: 2,
    filesFailed: 0,
    filesSkipped: 0,
    totalBytes: 256,
    durationMs: 1,
    averageSpeed: 256000,
    errors: [],
  }),
  disconnect: vi.fn().mockResolvedValue(undefined),
});

type Model = ReturnType<typeof createModel>;

/** The client beside the window's prompt host, as both window roots mount them. */
const tree = (client = true, host = true, shown = session) => (
  <>
    {client ? <ScpClient session={shown} /> : null}
    {host ? <PromptHost /> : null}
  </>
);

const DELETE_REPORT = 'Permanently delete "report.txt"?';
const DELETE_LOGS = 'Permanently delete "logs"?';

const dialogs = () => screen.queryAllByTestId("app-prompt");
const confirmButton = () => screen.getByTestId("app-prompt-confirm");
const cancelButton = () => screen.getByTestId("app-prompt-cancel");
// The client's own Delete: the open prompt has a button of the same name.
const deleteButton = () =>
  within(screen.getByTestId("scp-client")).getByRole("button", {
    name: "Delete",
  });

/** Lets every pending promise continuation and zero-delay timer run. */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  mocks.hook.mockReset();
  mocks.open.mockReset();
  mocks.save.mockReset();
  mocks.hook.mockReturnValue(createModel());
  vi.restoreAllMocks();
  resetPromptQueueForTests();
  prompts.requests = [];
  builders.remoteDelete = [];
  prompts.answer = null;
  // A native box that would say yes: no flow here may reach it.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  // Unmount first: a failed expectation here must not leak this test's DOM.
  cleanup();
  expect(window.confirm).not.toHaveBeenCalled();
});

describe("ScpClient", () => {
  it("renders real remote entries and navigation without advertising rename", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<ScpClient session={session} />);

    expect(
      screen.getByRole("region", { name: "SCP files on scp.example.test" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Remote SCP files" }),
    ).toHaveTextContent("report.txt");
    expect(screen.queryByRole("button", { name: /rename/i })).toBeNull();

    fireEvent.doubleClick(screen.getByText("logs"));
    await waitFor(() =>
      expect(model.loadDirectory).toHaveBeenCalledWith("/srv/files/logs"),
    );

    fireEvent.change(screen.getByLabelText("Remote path"), {
      target: { value: "/var/backups" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() =>
      expect(model.loadDirectory).toHaveBeenCalledWith("/var/backups"),
    );
  });

  it("uploads files and folders only after native path selection", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    mocks.open
      .mockResolvedValueOnce("C:\\tmp\\upload.txt")
      .mockResolvedValueOnce("C:\\tmp\\assets");
    render(<ScpClient session={session} />);

    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    await waitFor(() =>
      expect(model.uploadFile).toHaveBeenCalledWith(
        "C:\\tmp\\upload.txt",
        "/srv/files/upload.txt",
      ),
    );
    expect(
      screen.getByText("Uploaded 128 B to /srv/files/upload.txt."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload folder" }));
    await waitFor(() =>
      expect(model.uploadDirectory).toHaveBeenCalledWith(
        "C:\\tmp\\assets",
        "/srv/files/assets",
      ),
    );
    expect(mocks.open).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ directory: true, multiple: false }),
    );
  });

  it("downloads, verifies, and confirms deletion using backend operations", async () => {
    const model = createModel();
    let resolveChecksum: ((digest: string) => void) | undefined;
    model.checksum.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveChecksum = resolve;
      }),
    );
    mocks.hook.mockReturnValue(model);
    mocks.save.mockResolvedValue("C:\\Downloads\\report.txt");
    render(tree());

    fireEvent.click(screen.getByText("report.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(model.downloadFile).toHaveBeenCalledWith(
        "/srv/files/report.txt",
        "C:\\Downloads\\report.txt",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Checksum" }));
    await waitFor(() =>
      expect(model.checksum).toHaveBeenCalledWith("/srv/files/report.txt"),
    );
    expect(screen.queryByText("SHA-256: real-sha256")).not.toBeInTheDocument();
    resolveChecksum?.("real-sha256");
    expect(await screen.findByText("SHA-256: real-sha256")).toBeInTheDocument();

    fireEvent.click(deleteButton());
    expect(
      await screen.findByRole("dialog", { name: DELETE_REPORT }),
    ).toBeInTheDocument();
    expect(model.deleteEntry).not.toHaveBeenCalled();
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(model.deleteEntry).toHaveBeenCalledWith(remoteEntries[1]),
    );
    expect(model.deleteEntry).toHaveBeenCalledTimes(1);
  });

  it("uses recursive directory download and exposes a validated mkdir control", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    mocks.open.mockResolvedValue("C:\\Downloads");
    render(<ScpClient session={session} />);

    fireEvent.click(screen.getByText("logs"));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(model.downloadDirectory).toHaveBeenCalledWith(
        "/srv/files/logs",
        "C:\\Downloads\\logs",
      ),
    );

    fireEvent.change(screen.getByLabelText("New folder"), {
      target: { value: "archive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(model.mkdir).toHaveBeenCalledWith("/srv/files/archive"),
    );
  });
});

describe("ScpClient remote delete prompt", () => {
  /** Renders the client with `model`, selects a row and presses Delete. */
  const askToDelete = async (model: Model, row = "report.txt") => {
    mocks.hook.mockReturnValue(model);
    const view = render(tree());
    fireEvent.click(screen.getByText(row));
    fireEvent.click(deleteButton());
    await settle();
    return {
      ...view,
      /** The hook now returns `next`; the client renders with it. */
      update: (next: Model) => {
        mocks.hook.mockReturnValue(next);
        view.rerender(tree());
      },
    };
  };

  /** A request the test answers itself, whatever the client aborts meanwhile. */
  const answerByHand = () => {
    let resolve!: (decision: PromptDecision) => void;
    prompts.answer = () =>
      new Promise((done) => {
        resolve = done as (decision: PromptDecision) => void;
      });
    return (decision: PromptDecision) => resolve(decision);
  };

  const expectNothingDeleted = async (model: Model) => {
    await settle();
    expect(model.deleteEntry).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Deleted /)).not.toBeInTheDocument();
  };

  it("asks in the app's own dialog, with the focus on Cancel", async () => {
    const model = createModel();
    await askToDelete(model);

    const dialog = screen.getByRole("dialog", { name: DELETE_REPORT });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/This cannot be undone\./);
    await waitFor(() => expect(cancelButton()).toHaveFocus());
    expect(confirmButton()).toHaveTextContent("Delete");
    expect(confirmButton()).toHaveAttribute("data-tone", "danger");
    // Where: the session's own name and host, as the client was given them.
    const where = screen.getByRole("region", { name: "Session" });
    expect(within(where).getAllByRole("listitem")).toHaveLength(1);
    expect(where).toHaveTextContent("SCP host");
    expect(where).toHaveTextContent("scp.example.test");
    expect(builders.remoteDelete).toEqual([
      expect.objectContaining({
        session: { name: "SCP host", hostname: "scp.example.test" },
      }),
    ]);
    // The absolute path under review is on screen, as it was passed.
    expect(screen.getByRole("region", { name: "Path" })).toHaveTextContent(
      "/srv/files/report.txt",
    );
    expect(prompts.requests[0]).toMatchObject({
      preview: { text: "/srv/files/report.txt" },
    });
    // Permanent delete has no "don't ask again".
    expect(screen.queryByTestId("app-prompt-remember")).toBeNull();
    expect(prompts.requests).toHaveLength(1);
    expect(prompts.requests[0]).toMatchObject({
      title: DELETE_REPORT,
      confirmLabel: "Delete",
      tone: "danger",
      defaultAction: "cancel",
    });
    expect(prompts.requests[0]).not.toHaveProperty("remember");
  });

  it("hands on a session known only by its host as it is, and invents no name", async () => {
    mocks.hook.mockReturnValue(createModel());
    render(tree(true, true, { ...session, name: session.hostname }));
    fireEvent.click(screen.getByText("report.txt"));
    fireEvent.click(deleteButton());
    await settle();

    const dialog = screen.getByRole("dialog", { name: DELETE_REPORT });
    expect(builders.remoteDelete).toEqual([
      expect.objectContaining({
        session: { name: "scp.example.test", hostname: "scp.example.test" },
      }),
    ]);
    // Nothing but the configured host stands for the session, and only once.
    expect(dialog).not.toHaveTextContent("SCP host");
    expect(dialog).not.toHaveTextContent("scp.example.test scp.example.test");
  });

  it("deletes nothing before the answer", async () => {
    const model = createModel();
    await askToDelete(model);

    expect(dialogs()).toHaveLength(1);
    await expectNothingDeleted(model);
    expect(dialogs()).toHaveLength(1);
  });

  it("deletes the reviewed entry once on confirm", async () => {
    const model = createModel();
    await askToDelete(model);

    fireEvent.click(confirmButton());

    expect(await screen.findByText("Deleted report.txt.")).toBeInTheDocument();
    expect(model.deleteEntry).toHaveBeenCalledTimes(1);
    expect(model.deleteEntry).toHaveBeenCalledWith(remoteEntries[1]);
    expect(dialogs()).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says that a folder goes with everything inside it", async () => {
    const model = createModel();
    await askToDelete(model, "logs");

    expect(
      screen.getByRole("dialog", { name: DELETE_LOGS }),
    ).toHaveAccessibleDescription(/Everything inside it is deleted too\./);
    await waitFor(() => expect(cancelButton()).toHaveFocus());
    expect(model.deleteEntry).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());

    expect(await screen.findByText("Deleted logs.")).toBeInTheDocument();
    expect(model.deleteEntry).toHaveBeenCalledTimes(1);
    expect(model.deleteEntry).toHaveBeenCalledWith(remoteEntries[0]);
  });

  it.each([
    ["Cancel", () => fireEvent.click(cancelButton())],
    ["Escape", () => fireEvent.keyDown(document.body, { key: "Escape" })],
    [
      "a click on the backdrop",
      () => {
        fireEvent.mouseDown(screen.getByTestId("app-prompt"));
        fireEvent.click(screen.getByTestId("app-prompt"));
      },
    ],
    [
      "the dialog's close button",
      () =>
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", {
            name: "Close",
          }),
        ),
    ],
  ])("deletes nothing on %s, and asks again next time", async (_, dismiss) => {
    const model = createModel();
    await askToDelete(model);

    dismiss();

    await expectNothingDeleted(model);
    expect(dialogs()).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
    // The row is still selected and a new Delete is a new question.
    expect(screen.getByText("report.txt").closest("tr")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(deleteButton());
    await settle();
    expect(dialogs()).toHaveLength(1);
    expect(prompts.requests).toHaveLength(2);
    expect(model.deleteEntry).not.toHaveBeenCalled();
  });

  it("does not stack a second Delete on the first answer", async () => {
    const model = createModel();
    await askToDelete(model);

    fireEvent.click(deleteButton());
    fireEvent.click(deleteButton());
    await settle();

    expect(dialogs()).toHaveLength(1);
    expect(screen.queryByTestId("app-prompt-queue")).toBeNull();
    expect(prompts.requests).toHaveLength(1);

    fireEvent.click(confirmButton());

    expect(await screen.findByText("Deleted report.txt.")).toBeInTheDocument();
    await settle();
    expect(model.deleteEntry).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
  });

  it("keeps the prompt through a refresh of the same listing and deletes the reviewed path", async () => {
    const model = createModel();
    const view = await askToDelete(model);

    const refreshed = {
      ...model,
      entries: remoteEntries.map((entry) => ({ ...entry })),
    };
    view.update(refreshed);
    await settle();
    expect(screen.getByRole("dialog", { name: DELETE_REPORT })).toBeVisible();

    fireEvent.click(confirmButton());

    expect(await screen.findByText("Deleted report.txt.")).toBeInTheDocument();
    expect(model.deleteEntry).toHaveBeenCalledTimes(1);
    expect(model.deleteEntry.mock.calls[0][0]).toMatchObject({
      name: "report.txt",
      path: "/srv/files/report.txt",
      isDir: false,
    });
  });

  it("deletes the path it showed when another folder has an entry of the same name", async () => {
    // Two entries called report.txt, told apart only by their paths.
    const twin = { ...remoteEntries[1], path: "/srv/files/archive/report.txt" };
    const model = { ...createModel(), entries: [remoteEntries[1], twin] };
    mocks.hook.mockReturnValue(model);
    render(tree());
    fireEvent.click(screen.getAllByText("report.txt")[1]);
    fireEvent.click(deleteButton());
    await settle();

    const shown = screen.getByRole("region", { name: "Path" }).textContent;
    expect(shown).toBe("/srv/files/archive/report.txt");
    expect(model.deleteEntry).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());

    expect(await screen.findByText("Deleted report.txt.")).toBeInTheDocument();
    expect(model.deleteEntry).toHaveBeenCalledTimes(1);
    expect(model.deleteEntry.mock.calls[0][0].path).toBe(shown);
  });

  // A second file, so that the selection can move to an entry of the same kind.
  const withNotes = (model: Model): Model => ({
    ...model,
    entries: [
      ...remoteEntries,
      { ...remoteEntries[1], name: "notes.txt", path: "/srv/files/notes.txt" },
    ],
  });

  it("closes the prompt and deletes nothing when another entry is selected", async () => {
    const model = withNotes(createModel());
    await askToDelete(model);
    expect(dialogs()).toHaveLength(1);

    fireEvent.click(screen.getByText("notes.txt"));

    await expectNothingDeleted(model);
    expect(dialogs()).toHaveLength(0);
  });

  it("deletes neither entry when a confirm arrives after another entry is selected", async () => {
    const model = withNotes(createModel());
    const confirm = answerByHand();
    await askToDelete(model);
    expect(prompts.requests).toHaveLength(1);

    fireEvent.click(screen.getByText("notes.txt"));
    await settle();
    await act(async () => {
      confirm({ confirmed: true, remember: false });
    });

    await expectNothingDeleted(model);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // What can change under an open prompt. In every case the entry that was
  // reviewed is no longer the selected entry of the same connected session.
  const changes: [string, (model: Model) => Model][] = [
    [
      "the session disconnects",
      (model) => ({ ...model, status: "disconnected", entries: [] }),
    ],
    [
      "the session stops being connected with the listing still on screen",
      (model) => ({ ...model, status: "error" }),
    ],
    [
      "the backend session is replaced",
      (model) => ({ ...model, backendSessionId: "backend-scp-2" }),
    ],
    [
      "the entry leaves the listing",
      (model) => ({ ...model, entries: [remoteEntries[0]] }),
    ],
    [
      "the listing moves to another folder",
      (model) => ({
        ...model,
        currentPath: "/srv/other",
        entries: [
          { ...remoteEntries[1], path: "/srv/other/report.txt" },
          remoteEntries[0],
        ],
      }),
    ],
    [
      "the path becomes a folder",
      (model) => ({
        ...model,
        entries: [
          remoteEntries[0],
          { ...remoteEntries[1], isDir: true, isFile: false },
        ],
      }),
    ],
  ];

  it.each(changes)(
    "closes the prompt and deletes nothing when %s",
    async (_, change) => {
      const model = createModel();
      const view = await askToDelete(model);
      expect(dialogs()).toHaveLength(1);

      view.update(change(model));

      await expectNothingDeleted(model);
      expect(dialogs()).toHaveLength(0);
      expect(prompts.requests).toHaveLength(1);
    },
  );

  it.each(changes)(
    "deletes nothing when a confirm arrives after %s",
    async (_, change) => {
      const model = createModel();
      const confirm = answerByHand();
      const view = await askToDelete(model);
      expect(prompts.requests).toHaveLength(1);

      view.update(change(model));
      await settle();
      await act(async () => {
        confirm({ confirmed: true, remember: false });
      });

      await expectNothingDeleted(model);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("closes the prompt and deletes nothing when the view unmounts", async () => {
    const model = createModel();
    const view = await askToDelete(model);
    expect(dialogs()).toHaveLength(1);

    view.rerender(tree(false));

    await expectNothingDeleted(model);
    expect(dialogs()).toHaveLength(0);
  });

  it("deletes nothing when the prompt host goes away", async () => {
    const model = createModel();
    const view = await askToDelete(model);
    expect(dialogs()).toHaveLength(1);

    view.rerender(tree(true, false));

    await expectNothingDeleted(model);
    expect(dialogs()).toHaveLength(0);
  });

  it("says so and deletes nothing in a window without a prompt host", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    const view = render(tree(true, false));
    fireEvent.click(screen.getByText("report.txt"));
    fireEvent.click(deleteButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      new PromptHostUnavailableError().message,
    );
    await expectNothingDeleted(model);

    // The refusal is not sticky: with a host, the next Delete asks.
    view.rerender(tree());
    fireEvent.click(deleteButton());
    await settle();
    expect(screen.getByRole("dialog", { name: DELETE_REPORT })).toBeVisible();
    expect(model.deleteEntry).not.toHaveBeenCalled();
  });

  it("shows an untrusted file name as text, on one line", async () => {
    const model = createModel();
    const hostile = {
      ...remoteEntries[1],
      name: '<img src=x onerror="alert(1)">\nrm -rf /',
      path: "/srv/files/hostile",
    };
    await askToDelete(
      { ...model, entries: [hostile] },
      // The row shows the name as text too.
      '<img src=x onerror="alert(1)"> rm -rf /',
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog).toHaveAccessibleName(
      'Permanently delete "<img src=x onerror="alert(1)"> rm -rf /"?',
    );
  });

  it("has no native dialog left in the client", () => {
    const source = readFileSync(
      "src/components/protocol/ScpClient.tsx",
      "utf8",
    );
    expect(source).not.toMatch(/\b(?:confirm|alert|prompt)\s*\(/);
    expect(source).toContain("remoteDeletePrompt(");
  });
});
