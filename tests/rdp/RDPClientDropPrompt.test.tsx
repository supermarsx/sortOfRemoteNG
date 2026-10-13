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
import type { ConnectionSession } from "../../src/types/connection/connection";
import type {
  PromptDecision,
  PromptOptions,
  PromptRequest,
} from "../../src/utils/prompts/promptQueue";

// Dropping files onto an RDP session used to raise the webview's own confirm
// box. These tests render the real RDPClient around a stubbed session manager
// and drive it with synthetic drop events and fake file objects: no real file,
// no real clipboard, no backend.

const rdp = vi.hoisted(() => ({ mgr: null as unknown }));

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
  appDataDir: vi.fn(),
}));

// The real queue, observed: every request is recorded, and a test may answer
// in the host's place to reach an order of events the dialog cannot produce.
const prompts = vi.hoisted(() => ({
  requests: [] as unknown[],
  answer: null as
    null | ((request: unknown, options: unknown) => Promise<unknown>),
}));

vi.mock("../../src/hooks/rdp/useRDPClient", () => ({
  useRDPClient: () => rdp.mgr,
}));
vi.mock("../../src/hooks/rdp/useRDPInternalsBridge", () => ({
  useRDPInternalsBridge: () => () => undefined,
}));
vi.mock("../../src/hooks/window/useNonPassiveWheel", () => ({
  useNonPassiveWheel: () => undefined,
}));
vi.mock("../../src/components/rdp/RDPClientHeader", () => ({
  default: () => null,
}));
vi.mock("../../src/components/rdp/WindowsToolsBar", () => ({
  default: () => null,
}));
vi.mock("../../src/components/rdp/RDPStatusBar", () => ({
  RDPStatusBar: () => null,
}));
vi.mock("../../src/components/rdp/RDPErrorScreen", () => ({
  default: () => null,
}));
vi.mock("../../src/components/security/TrustWarningDialog", () => ({
  TrustWarningDialog: () => null,
}));
vi.mock("../../src/components/session/SessionFullscreenExitControl", () => ({
  SessionFullscreenExitControl: () => null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => tauri.invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: (...args: unknown[]) => tauri.writeFile(...args),
  mkdir: (...args: unknown[]) => tauri.mkdir(...args),
  exists: (...args: unknown[]) => tauri.exists(...args),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => tauri.appDataDir(),
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("../../src/utils/prompts/promptQueue", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/utils/prompts/promptQueue")
    >();
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

import RDPClient from "../../src/components/rdp/RDPClient";
import { PromptHost } from "../../src/components/ui/dialogs/PromptHost";
import {
  PromptHostUnavailableError,
  resetPromptQueueForTests,
} from "../../src/utils/prompts/promptQueue";

const session: ConnectionSession = {
  id: "rdp-frontend-1",
  connectionId: "rdp-connection-1",
  name: "Build server",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "rdp",
  hostname: "rdp.example.test",
  backendSessionId: "rdp-backend-1",
};

const TRANSFER_DIR = "/scratch/app-data/rdp-transfers";

const createMgr = (overrides: Record<string, unknown> = {}) => ({
  canvasRef: { current: null },
  magnifierCanvasRef: { current: null },
  containerRef: { current: null },
  isConnected: true,
  connectionStatus: "connected",
  statusMessage: "",
  isFullscreen: false,
  rdpSessionId: "rdp-backend-1" as string | null,
  desktopSize: { width: 800, height: 600 },
  rdpSettings: undefined as unknown,
  settings: { enableFileDragDropToRdp: true },
  pointerStyle: "default",
  magnifierActive: false,
  mouseEnabled: true,
  keyboardEnabled: true,
  connection: undefined,
  trustPrompt: null,
  certIdentity: null,
  ...overrides,
});

/** The client beside the window's prompt host, as both window roots mount them. */
const tree = (client = true, host = true, shown = session) => (
  <>
    {client ? <RDPClient session={shown} /> : null}
    {host ? <PromptHost /> : null}
  </>
);

const mount = (mgr = createMgr(), host = true, shown = session) => {
  rdp.mgr = mgr;
  const view = render(tree(true, host, shown));
  return {
    ...view,
    /** The session manager now reports `next`; the client renders with it. */
    update: (next: ReturnType<typeof createMgr>) => {
      rdp.mgr = next;
      view.rerender(tree(true, host, shown));
    },
  };
};

// ─── Fake dropped items ─────────────────────────────────────────

type FakeFile = File & { arrayBuffer: ReturnType<typeof vi.fn> };

const fakeFile = (name: string, size: number): FakeFile =>
  ({
    name,
    size,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(size)),
  }) as unknown as FakeFile;

interface FakeEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

const fileEntry = (file: FakeFile) => ({
  isFile: true,
  isDirectory: false,
  name: file.name,
  file: vi.fn((resolve: (file: File) => void) => resolve(file)),
});

/** A folder whose listing is read once, as `children` is at that moment. */
const folderEntry = (name: string, children: FakeEntry[]) => {
  const entry = {
    isFile: false,
    isDirectory: true,
    name,
    children,
    createReader: vi.fn(() => {
      let served = false;
      return {
        readEntries: (resolve: (batch: FakeEntry[]) => void) => {
          const batch = served ? [] : [...entry.children];
          served = true;
          resolve(batch);
        },
      };
    }),
  };
  return entry;
};

/** A folder whose listing arrives only when the test calls `deliver`. */
const slowFolderEntry = (name: string, children: FakeEntry[]) => {
  const pending: (() => void)[] = [];
  const entry = {
    isFile: false,
    isDirectory: true,
    name,
    createReader: vi.fn(() => {
      let served = false;
      return {
        readEntries: (resolve: (batch: FakeEntry[]) => void) => {
          const batch = served ? [] : children;
          served = true;
          pending.push(() => resolve(batch));
        },
      };
    }),
    deliver: async () => {
      await act(async () => {
        while (pending.length > 0) {
          pending.shift()?.();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });
    },
  };
  return entry;
};

const unreadableFolderEntry = (name: string, message: string) => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => ({
    readEntries: (_resolve: unknown, reject: (cause: Error) => void) =>
      reject(new Error(message)),
  }),
});

/**
 * Drops onto the session and then expires the event, as a browser does when
 * the handler returns: the lists are empty from then on and every later read
 * of them is recorded.
 */
const drop = (payload: { entries?: (FakeEntry | null)[]; files?: File[] }) => {
  let live = true;
  const lateReads: string[] = [];
  const expiring = <T,>(label: string, values: T[]): T[] =>
    new Proxy(values, {
      get(target, property, receiver) {
        if (live) return Reflect.get(target, property, receiver);
        lateReads.push(`${label}.${String(property)}`);
        return Reflect.get([], property);
      },
    });
  const items = expiring(
    "items",
    (payload.entries ?? []).map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
    })),
  );
  const files = expiring("files", payload.files ?? []);
  const dataTransfer = {
    get items() {
      if (!live) lateReads.push("items");
      return items;
    },
    get files() {
      if (!live) lateReads.push("files");
      return files;
    },
    dropEffect: "none",
  };
  const notPrevented = fireEvent.drop(
    screen.getByTestId("rdp-canvas-viewport"),
    { dataTransfer },
  );
  live = false;
  return { preventedDuringTheEvent: !notPrevented, lateReads };
};

/** Two plain files, 1.5 KB together, as a browser reports them. */
const twoFiles = () => {
  const files = [fakeFile("a.txt", 1024), fakeFile("b.bin", 512)];
  return { files, entries: files.map(fileEntry) };
};

// ─── Reading the screen and the backend ─────────────────────────

const SEND_TWO = "Send 2 files to Build server?";

const dialogs = () => screen.queryAllByTestId("app-prompt");
const confirmButton = () => screen.getByTestId("app-prompt-confirm");
const cancelButton = () => screen.getByTestId("app-prompt-cancel");

/** Lets every pending promise continuation and zero-delay timer run. */
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const sends = () =>
  tauri.invoke.mock.calls.filter(
    ([command]) => command === "rdp_clipboard_copy_files",
  );

/** Nothing reached the disk, the backend or a file's contents. */
const expectNothingStagedOrSent = async (files: FakeFile[] = []) => {
  await settle();
  expect(tauri.writeFile).not.toHaveBeenCalled();
  expect(tauri.mkdir).not.toHaveBeenCalled();
  expect(tauri.appDataDir).not.toHaveBeenCalled();
  expect(sends()).toHaveLength(0);
  for (const file of files) expect(file.arrayBuffer).not.toHaveBeenCalled();
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

beforeEach(() => {
  vi.restoreAllMocks();
  resetPromptQueueForTests();
  prompts.requests = [];
  prompts.answer = null;
  tauri.invoke.mockReset().mockResolvedValue(undefined);
  tauri.writeFile.mockReset().mockResolvedValue(undefined);
  tauri.mkdir.mockReset().mockResolvedValue(undefined);
  tauri.exists.mockReset().mockResolvedValue(false);
  tauri.appDataDir.mockReset().mockResolvedValue("/scratch/app-data");
  // A native box that would say yes: no flow here may reach it.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  // Unmount first: a failed expectation here must not leak this test's DOM.
  cleanup();
  expect(window.confirm).not.toHaveBeenCalled();
});

describe("RDP file drop prompt", () => {
  it("asks in the app's own dialog, naming the session, the count and the size", async () => {
    mount();
    const { files, entries } = twoFiles();

    const dropped = drop({ entries, files });
    await settle();

    expect(dropped.preventedDuringTheEvent).toBe(true);
    const dialog = screen.getByRole("dialog", { name: SEND_TWO });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(
      /1\.5 KB will be copied to the remote session\./,
    );
    expect(confirmButton()).toHaveTextContent("Send files");
    await waitFor(() => expect(confirmButton()).toHaveFocus());
    // Where: the name is in the title, and the host stands beside it below.
    const where = screen.getByRole("region", { name: "Session" });
    expect(within(where).getAllByRole("listitem")).toHaveLength(1);
    expect(where).toHaveTextContent("Build server");
    expect(where).toHaveTextContent("rdp.example.test");
    // A transfer has no "don't ask again".
    expect(screen.queryByTestId("app-prompt-remember")).toBeNull();
    expect(prompts.requests).toHaveLength(1);
    expect(prompts.requests[0]).not.toHaveProperty("remember");
    // The drop is not announced as failed or in progress behind the question.
    expect(screen.queryByText(/Scanning|Sending|failed/)).toBeNull();
  });

  it.each([
    ["has its host as its name", "rdp.example.test"],
    ["has no name", ""],
  ])(
    "adds no session row when the session %s: the title already names the host",
    async (_, name) => {
      mount(createMgr(), true, { ...session, name });
      const { files, entries } = twoFiles();
      drop({ entries, files });
      await settle();

      expect(
        screen.getByRole("dialog", {
          name: "Send 2 files to rdp.example.test?",
        }),
      ).toBeVisible();
      expect(screen.queryByRole("region", { name: "Session" })).toBeNull();
    },
  );

  it("stages, reads and sends nothing before the answer", async () => {
    mount();
    const { files, entries } = twoFiles();

    drop({ entries, files });
    await settle();

    expect(dialogs()).toHaveLength(1);
    await expectNothingStagedOrSent(files);
    expect(dialogs()).toHaveLength(1);
  });

  it("sends exactly the reviewed files, once, on confirm", async () => {
    mount();
    const { files, entries } = twoFiles();
    const dropped = drop({ entries, files });
    await settle();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0][1]).toEqual({
      sessionId: "rdp-backend-1",
      files: [
        {
          name: "a.txt",
          size: 1024,
          path: `${TRANSFER_DIR}/a.txt`,
          isDirectory: false,
        },
        {
          name: "b.bin",
          size: 512,
          path: `${TRANSFER_DIR}/b.bin`,
          isDirectory: false,
        },
      ],
    });
    expect(tauri.writeFile).toHaveBeenCalledTimes(2);
    expect(tauri.writeFile.mock.calls.map(([path]) => path)).toEqual([
      `${TRANSFER_DIR}/a.txt`,
      `${TRANSFER_DIR}/b.bin`,
    ]);
    expect(
      tauri.writeFile.mock.calls.map(([, bytes]) => bytes.byteLength),
    ).toEqual([1024, 512]);
    for (const file of files) expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
    expect(
      await screen.findByText(/2 files \(1\.5 KB\) sent to remote clipboard/),
    ).toBeInTheDocument();
    await settle();
    expect(sends()).toHaveLength(1);
    // Nothing was read from the event once its handler had returned.
    expect(dropped.lateReads).toEqual([]);
  });

  it("counts a dropped folder by the files and folders inside it and sends exactly those", async () => {
    mount();
    const inner = fakeFile("a.log", 2048);
    const deeper = fakeFile("b.log", 1024);
    const beside = fakeFile("c.txt", 1024);
    const old = folderEntry("old", [fileEntry(deeper)]);
    const logs = folderEntry("logs", [fileEntry(inner), old]);
    // The browser lists a dropped folder as one item of no size.
    const dropped = drop({
      entries: [logs, fileEntry(beside)],
      files: [fakeFile("logs", 0), beside],
    });
    await settle();

    // 3 files in 2 folders, 4 KB: the contents, not the two dropped items.
    // "old" sits inside "logs" and is counted too.
    const dialog = screen.getByRole("dialog", {
      name: /\b3 files in 2 folders\b/,
    });
    expect(dialog).toHaveAccessibleName(/Build server/);
    expect(dialog).toHaveAccessibleDescription(/\b4 KB\b/);
    await expectNothingStagedOrSent([inner, deeper, beside]);

    // A file that appears in the folder while the question is open was not
    // reviewed, so it is not sent.
    const late = fakeFile("late.log", 4096);
    logs.children.push(fileEntry(late));

    fireEvent.click(confirmButton());

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0][1]).toEqual({
      sessionId: "rdp-backend-1",
      files: [
        { name: "logs", size: 0, path: "", isDirectory: true },
        {
          name: "logs\\a.log",
          size: 2048,
          path: `${TRANSFER_DIR}/logs/a.log`,
          isDirectory: false,
        },
        { name: "logs\\old", size: 0, path: "", isDirectory: true },
        {
          name: "logs\\old\\b.log",
          size: 1024,
          path: `${TRANSFER_DIR}/logs/old/b.log`,
          isDirectory: false,
        },
        {
          name: "c.txt",
          size: 1024,
          path: `${TRANSFER_DIR}/c.txt`,
          isDirectory: false,
        },
      ],
    });
    // What was sent is what the question counted.
    const sent = (sends()[0][1] as { files: { isDirectory: boolean }[] }).files;
    expect(sent.filter((item) => !item.isDirectory)).toHaveLength(3);
    expect(sent.filter((item) => item.isDirectory)).toHaveLength(2);
    // One walk, before the question; none after the answer.
    expect(logs.createReader).toHaveBeenCalledTimes(1);
    expect(old.createReader).toHaveBeenCalledTimes(1);
    expect(late.arrayBuffer).not.toHaveBeenCalled();
    expect(tauri.writeFile).toHaveBeenCalledTimes(3);
    expect(tauri.mkdir.mock.calls.map(([path]) => path)).toEqual([
      TRANSFER_DIR,
      `${TRANSFER_DIR}/logs`,
      `${TRANSFER_DIR}/logs/old`,
    ]);
    expect(dropped.lateReads).toEqual([]);
  });

  /** Two empty folders, one inside the other, and no file anywhere. */
  const emptyFolders = () => ({
    entries: [folderEntry("outer", [folderEntry("inner", [])])],
    files: [fakeFile("outer", 0)],
  });

  it("asks about a drop of empty folders as folders, and creates them on confirm", async () => {
    mount();
    drop(emptyFolders());
    await settle();

    const dialog = screen.getByRole("dialog", {
      name: /\b2 empty folders\b/,
    });
    expect(dialog).toHaveAccessibleName(/Build server/);
    // No file is copied, so neither a file count nor a size is shown.
    expect(dialog).not.toHaveAccessibleName(/\b0 files\b/);
    expect(dialog).toHaveAccessibleDescription(/no files are copied/);
    expect(dialog).not.toHaveTextContent(/\b0 B\b/);
    expect(confirmButton()).toHaveTextContent("Send folders");
    await expectNothingStagedOrSent();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0][1]).toEqual({
      sessionId: "rdp-backend-1",
      files: [
        { name: "outer", size: 0, path: "", isDirectory: true },
        { name: "outer\\inner", size: 0, path: "", isDirectory: true },
      ],
    });
    expect(tauri.writeFile).not.toHaveBeenCalled();
  });

  it("creates no folder when a drop of empty folders is cancelled", async () => {
    mount();
    drop(emptyFolders());
    await settle();
    expect(dialogs()).toHaveLength(1);

    fireEvent.click(cancelButton());

    await expectNothingStagedOrSent();
    expect(dialogs()).toHaveLength(0);
    expect(screen.queryByText(/Scanning|Sending|failed|sent to/)).toBeNull();
  });

  it("uses the dropped file list when the browser gives no entries", async () => {
    mount();
    const files = [fakeFile("a.txt", 1024), fakeFile("b.bin", 512)];
    const dropped = drop({ entries: [null, null], files });
    await settle();

    expect(screen.getByRole("dialog", { name: SEND_TWO })).toBeVisible();
    await expectNothingStagedOrSent(files);

    fireEvent.click(confirmButton());

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0][1]).toEqual({
      sessionId: "rdp-backend-1",
      files: [
        {
          name: "a.txt",
          size: 1024,
          path: `${TRANSFER_DIR}/a.txt`,
          isDirectory: false,
        },
        {
          name: "b.bin",
          size: 512,
          path: `${TRANSFER_DIR}/b.bin`,
          isDirectory: false,
        },
      ],
    });
    expect(dropped.lateReads).toEqual([]);
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
  ])("sends nothing on %s, and asks again next time", async (_, dismiss) => {
    mount();
    const { files, entries } = twoFiles();
    drop({ entries, files });
    await settle();

    dismiss();

    await expectNothingStagedOrSent(files);
    expect(dialogs()).toHaveLength(0);
    expect(screen.queryByText(/Scanning|Sending|failed|sent to/)).toBeNull();

    drop({ entries, files });
    await settle();
    expect(dialogs()).toHaveLength(1);
    expect(prompts.requests).toHaveLength(2);
    await expectNothingStagedOrSent(files);
  });

  it("does not stack a second drop on the first answer", async () => {
    mount();
    const first = twoFiles();
    const second = [fakeFile("other.iso", 2048)];
    drop(first);
    await settle();

    drop({ entries: second.map(fileEntry), files: second });
    await settle();

    expect(dialogs()).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: SEND_TWO })).toBeVisible();
    expect(screen.queryByTestId("app-prompt-queue")).toBeNull();
    expect(prompts.requests).toHaveLength(1);

    fireEvent.click(confirmButton());

    await waitFor(() => expect(sends()).toHaveLength(1));
    await settle();
    expect(sends()).toHaveLength(1);
    expect(
      (sends()[0][1] as { files: { name: string }[] }).files.map(
        (file) => file.name,
      ),
    ).toEqual(["a.txt", "b.bin"]);
    expect(second[0].arrayBuffer).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(0);
  });

  it("drops a walk that a newer drop overtakes: one question, about the newer drop", async () => {
    mount();
    const buried = fakeFile("buried.log", 4096);
    const buriedEntry = fileEntry(buried);
    const slow = slowFolderEntry("slow", [buriedEntry]);
    drop({ entries: [slow], files: [fakeFile("slow", 0)] });
    await settle();
    expect(screen.getByText(/^Scanning/)).toBeInTheDocument();
    expect(dialogs()).toHaveLength(0);

    const newer = [fakeFile("newer.txt", 1024)];
    drop({ entries: newer.map(fileEntry), files: newer });
    await settle();

    expect(
      screen.getByRole("dialog", { name: "Send 1 file to Build server?" }),
    ).toBeVisible();
    // The first folder's listing arrives now: it is not read any further,
    // it raises no question and it does not disturb the one on screen.
    await slow.deliver();
    await settle();
    expect(dialogs()).toHaveLength(1);
    expect(screen.queryByTestId("app-prompt-queue")).toBeNull();
    expect(prompts.requests).toHaveLength(1);
    expect(screen.queryByText(/^Scanning/)).toBeNull();
    expect(buriedEntry.file).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(sends()).toHaveLength(1));
    await settle();
    expect(sends()).toHaveLength(1);
    expect(sends()[0][1]).toEqual({
      sessionId: "rdp-backend-1",
      files: [
        {
          name: "newer.txt",
          size: 1024,
          path: `${TRANSFER_DIR}/newer.txt`,
          isDirectory: false,
        },
      ],
    });
    expect(buried.arrayBuffer).not.toHaveBeenCalled();
  });

  // What can happen to the session under an open walk or an open prompt.
  const sessionChanges: [string, () => ReturnType<typeof createMgr>][] = [
    [
      "the session disconnects",
      () => createMgr({ isConnected: false, connectionStatus: "disconnected" }),
    ],
    [
      "another session takes its place",
      () => createMgr({ rdpSessionId: "rdp-backend-2" }),
    ],
  ];

  it.each(sessionChanges)(
    "stops the walk at once, asks nothing and sends nothing when %s",
    async (_, change) => {
      const view = mount();
      const buried = fakeFile("buried.log", 4096);
      const buriedEntry = fileEntry(buried);
      const slow = slowFolderEntry("slow", [buriedEntry]);
      drop({ entries: [slow], files: [fakeFile("slow", 0)] });
      await settle();
      expect(screen.getByText(/^Scanning/)).toBeInTheDocument();

      view.update(change());
      // The progress line goes with the session, not with the file system.
      expect(screen.queryByText(/^Scanning/)).toBeNull();

      await slow.deliver();
      await expectNothingStagedOrSent([buried]);
      // The listing that arrived after the stop is not read any further.
      expect(buriedEntry.file).not.toHaveBeenCalled();
      expect(dialogs()).toHaveLength(0);
      expect(prompts.requests).toHaveLength(0);
      expect(screen.queryByText(/Scanning|Sending|failed/)).toBeNull();
    },
  );

  it("stops the walk, asks nothing and sends nothing when the view unmounts", async () => {
    const view = mount();
    const buried = fakeFile("buried.log", 4096);
    const buriedEntry = fileEntry(buried);
    const slow = slowFolderEntry("slow", [buriedEntry]);
    drop({ entries: [slow], files: [fakeFile("slow", 0)] });
    await settle();

    view.rerender(tree(false));

    await slow.deliver();
    await expectNothingStagedOrSent([buried]);
    expect(buriedEntry.file).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(0);
    expect(prompts.requests).toHaveLength(0);
  });

  it.each(sessionChanges)(
    "closes the prompt and sends nothing when %s",
    async (_, change) => {
      const view = mount();
      const { files, entries } = twoFiles();
      drop({ entries, files });
      await settle();
      expect(dialogs()).toHaveLength(1);

      view.update(change());

      await expectNothingStagedOrSent(files);
      expect(dialogs()).toHaveLength(0);
      expect(screen.queryByText(/Scanning|Sending|failed/)).toBeNull();
    },
  );

  it.each(sessionChanges)(
    "sends nothing when a confirm arrives after %s",
    async (_, change) => {
      const confirm = answerByHand();
      const view = mount();
      const { files, entries } = twoFiles();
      drop({ entries, files });
      await settle();
      expect(prompts.requests).toHaveLength(1);

      view.update(change());
      await settle();
      await act(async () => {
        confirm({ confirmed: true, remember: false });
      });

      await expectNothingStagedOrSent(files);
      expect(screen.queryByText(/Sending|failed/)).toBeNull();
    },
  );

  it("closes the prompt and sends nothing when the view unmounts", async () => {
    const view = mount();
    const { files, entries } = twoFiles();
    drop({ entries, files });
    await settle();
    expect(dialogs()).toHaveLength(1);

    view.rerender(tree(false));

    await expectNothingStagedOrSent(files);
    expect(dialogs()).toHaveLength(0);
  });

  it("sends nothing when the prompt host goes away", async () => {
    const view = mount();
    const { files, entries } = twoFiles();
    drop({ entries, files });
    await settle();
    expect(dialogs()).toHaveLength(1);

    view.rerender(tree(true, false));

    await expectNothingStagedOrSent(files);
    expect(dialogs()).toHaveLength(0);
  });

  it("says so and sends nothing in a window without a prompt host", async () => {
    const view = mount(createMgr(), false);
    const { files, entries } = twoFiles();
    drop({ entries, files });

    expect(
      await screen.findByText(
        `File transfer failed: ${new PromptHostUnavailableError().message}`,
      ),
    ).toBeInTheDocument();
    await expectNothingStagedOrSent(files);

    // The refusal is not sticky: with a host, the next drop asks.
    view.rerender(tree());
    drop({ entries, files });
    await settle();
    expect(screen.getByRole("dialog", { name: SEND_TWO })).toBeVisible();
    await expectNothingStagedOrSent(files);
  });

  it("reports a folder that cannot be read, asks nothing and sends nothing", async () => {
    mount();
    const readable = fakeFile("readable.txt", 1024);
    drop({
      entries: [
        fileEntry(readable),
        unreadableFolderEntry("locked", "The folder could not be read."),
      ],
      files: [readable, fakeFile("locked", 0)],
    });

    expect(
      await screen.findByText(
        "File transfer failed: The folder could not be read.",
      ),
    ).toBeInTheDocument();
    // Never the readable part presented as the whole drop.
    expect(dialogs()).toHaveLength(0);
    expect(prompts.requests).toHaveLength(0);
    await expectNothingStagedOrSent([readable]);

    // The failure is not sticky either.
    const { files, entries } = twoFiles();
    drop({ entries, files });
    await settle();
    expect(screen.getByRole("dialog", { name: SEND_TWO })).toBeVisible();
  });

  it("reports a failure while staging and sends nothing", async () => {
    mount();
    tauri.writeFile.mockRejectedValueOnce(new Error("The disk is full."));
    const { files, entries } = twoFiles();
    drop({ entries, files });
    await settle();

    fireEvent.click(confirmButton());

    expect(
      await screen.findByText("File transfer failed: The disk is full."),
    ).toBeInTheDocument();
    await settle();
    expect(sends()).toHaveLength(0);
  });

  describe("asks under the same conditions as before", () => {
    it("does not ask when the session is not connected", async () => {
      mount(createMgr({ isConnected: false, connectionStatus: "connecting" }));
      const { files, entries } = twoFiles();

      const dropped = drop({ entries, files });

      expect(dropped.preventedDuringTheEvent).toBe(true);
      await expectNothingStagedOrSent(files);
      expect(prompts.requests).toHaveLength(0);
      expect(dialogs()).toHaveLength(0);
    });

    it("does not ask when file drag and drop is switched off", async () => {
      mount(createMgr({ settings: { enableFileDragDropToRdp: false } }));
      const { files, entries } = twoFiles();

      const dropped = drop({ entries, files });

      expect(dropped.preventedDuringTheEvent).toBe(true);
      expect(
        screen.getByText(/^File drag & drop is disabled/),
      ).toBeInTheDocument();
      await expectNothingStagedOrSent(files);
      expect(prompts.requests).toHaveLength(0);
      expect(dialogs()).toHaveLength(0);
    });

    it("does not ask for a drop that carries no files", async () => {
      mount();

      const dropped = drop({ entries: [null], files: [] });

      expect(dropped.preventedDuringTheEvent).toBe(true);
      await expectNothingStagedOrSent();
      expect(prompts.requests).toHaveLength(0);
      expect(dialogs()).toHaveLength(0);
    });

    it("refuses a drop over the size limit without asking", async () => {
      mount();
      const huge = [fakeFile("huge.iso", 101 * 1024 * 1024)];

      drop({ entries: huge.map(fileEntry), files: huge });

      expect(
        screen.getByText("Total file size (101 MB) exceeds the 100 MB limit"),
      ).toBeInTheDocument();
      await expectNothingStagedOrSent(huge);
      expect(prompts.requests).toHaveLength(0);
      expect(dialogs()).toHaveLength(0);
    });
  });

  describe("in the source", () => {
    const source = () =>
      readFileSync("src/components/rdp/RDPClient.tsx", "utf8");

    const between = (text: string, start: string, end: string) => {
      const from = text.indexOf(start);
      expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
      const to = text.indexOf(end, from + start.length);
      expect(to, `missing the end of ${start}`).toBeGreaterThan(from);
      return text.slice(from, to);
    };

    it("has no native dialog left in the client", () => {
      expect(source()).not.toMatch(/\b(?:confirm|alert|prompt)\s*\(/);
      expect(source()).toContain("fileTransferPrompt(");
    });

    it("reads the drop event in a handler that never waits, and hands the event to nothing that does", () => {
      const handler = between(
        source(),
        "const handleDrop = React.useCallback(",
        "\n  );\n",
      );
      expect(handler).toMatch(/^\s*\(e: React\.DragEvent\) => \{$/m);
      expect(handler).toContain("e.preventDefault();");
      expect(handler).toContain("e.dataTransfer");
      expect(handler).not.toMatch(/\basync\b|\bawait\b|\.then\(/);

      const review = between(
        source(),
        "const reviewAndSendDrop = React.useCallback(",
        "\n  );\n",
      );
      expect(review).toMatch(/\bawait requestPrompt\(/);
      expect(review).not.toMatch(/dataTransfer|\be\b/);
      // Called with what was captured, never with the event.
      expect(handler).toMatch(
        /reviewAndSendDrop\(\s*sessionId,\s*topEntries,\s*fallbackFiles,?\s*\)/,
      );
    });
  });
});
