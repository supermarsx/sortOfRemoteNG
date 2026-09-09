import React, { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type {
  WebAutomationDocument,
  WebAutomationLibrary,
  BrowserScript,
} from "../../src/types/recording/webAutomation";
const boundary = vi.hoisted(() => ({
  owner: "database-a",
  lease: 1,
  accessible: true,
  load: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listener: null as null | ((event: { status: string }) => void),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (listener: typeof boundary.listener) => {
    boundary.listener = listener;
    return () => {
      boundary.listener = null;
    };
  },
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: boundary.owner }),
      captureCurrentDatabaseDataTarget: () => {
        const lease = boundary.lease,
          owner = boundary.owner;
        return {
          databaseId: owner,
          assertAccessible: () => {
            if (
              !boundary.accessible ||
              boundary.lease !== lease ||
              boundary.owner !== owner
            )
              throw new Error("Owning database is locked or its lease changed");
          },
        };
      },
    }),
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("../../src/utils/recording/webAutomationLibrary", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/webAutomationLibrary")
  >()),
  webAutomationStore: { load: boundary.load },
  saveWebAutomationItem: boundary.save,
  deleteWebAutomationItem: boundary.remove,
}));
import { useWebAutomation } from "../../src/hooks/protocol/useWebAutomation";
import { WebAutomationControls } from "../../src/components/protocol/webBrowser/WebAutomationControls";

const script: BrowserScript = {
  kind: "script",
  id: "demo-script",
  name: "Demo script",
  description: "Synthetic fixture only",
  code: "document.title = 'Fixture';",
  createdAt: "2026-09-09T12:00:00Z",
  updatedAt: "2026-09-09T12:00:00Z",
};
const library: WebAutomationLibrary = {
  version: 1,
  scripts: [script],
  macros: [],
};
let current: ReturnType<typeof useWebAutomation>;
let doc: WebAutomationDocument | null;
let post: ReturnType<typeof vi.fn>;
const getDocument = () => doc;
let connection: Connection;
let settings: GlobalSettings;
function Fixture({
  owner = "database-a",
  scope = "database-a:1",
  navigation = "ready",
}: {
  owner?: string;
  scope?: string;
  navigation?: string;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  current = useWebAutomation({
    connection,
    ownerDatabaseId: owner,
    settings,
    settingsReady: true,
    scopeKey: scope,
    blocked: false,
    navigationKey: navigation,
    iframe,
    getDocument,
    updateConnection: boundary.update,
  });
  return (
    <>
      <iframe ref={iframe} title="Synthetic website" />
      <WebAutomationControls automation={current} />
    </>
  );
}
function sent(action: string) {
  return post.mock.calls
    .filter(([request]) => request.action === action)
    .map(([request]) => request);
}
function acknowledge(
  request: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const iframe = screen.getByTitle("Synthetic website") as HTMLIFrameElement;
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: new URL(doc!.url).origin,
        data: {
          ...request,
          type: "proxy_web_automation",
          status: "ok",
          ...overrides,
        },
      }),
    ),
  );
}
async function mount(props = {}) {
  const view = render(<Fixture {...props} />);
  const iframe = screen.getByTitle("Synthetic website") as HTMLIFrameElement;
  post = vi
    .spyOn(iframe.contentWindow!, "postMessage")
    .mockImplementation(() => undefined);
  await waitFor(() => expect(current.libraryReady).toBe(true));
  return view;
}
beforeEach(() => {
  boundary.owner = "database-a";
  boundary.lease = 1;
  boundary.accessible = true;
  boundary.load.mockReset().mockResolvedValue({ value: library });
  boundary.save
    .mockReset()
    .mockImplementation(async (item, _expected, check) => {
      check();
      return {
        version: 1,
        scripts: item.kind === "script" ? [item] : [script],
        macros: item.kind === "macro" ? [item] : [],
      };
    });
  boundary.remove.mockReset();
  boundary.update.mockReset().mockResolvedValue(undefined);
  doc = {
    generation: 1,
    sessionId: "proxy-fixture",
    token: "d".repeat(32),
    sequence: 1,
    navigationToken: null,
    url: "http://127.0.0.1:43001/public",
  };
  connection = {
    id: "connection",
    protocol: "http",
    hostname: "demo.example.test",
    port: 81,
    name: "Demo",
    isGroup: false,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
    httpAutomation: {
      version: 1,
      interactionMacrosEnabled: true,
      scriptInjectionEnabled: true,
      forceDark: false,
      items: [{ kind: "script", id: script.id }],
    },
  };
  settings = {
    sessionQuickActions: {
      sshEnabled: true,
      httpEnabled: true,
      allowWebMacros: true,
      allowWebScriptInjection: true,
      allowWebForceDark: true,
      confirmBeforeScriptRun: true,
    },
    macros: { confirmBeforeReplay: true },
  } as GlobalSettings;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("mounted website automation controls and ownership", () => {
  it("requires explicit confirmation for a favorite and guards rapid duplicate execution", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Demo script" }));
    expect(
      screen.getByRole("dialog", { name: "Review website action" }),
    ).toBeInTheDocument();
    expect(sent("script")).toHaveLength(0);
    const run = screen.getByRole("button", { name: "Run on current page" });
    fireEvent.click(run);
    fireEvent.click(run);
    expect(sent("script")).toHaveLength(1);
    acknowledge(sent("script")[0]);
    await waitFor(() => expect(current.busy).toBe(false));
  });
  it("records only an armed typed step, reviews it, and saves a macro without values", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record macro" }));
    const start = sent("recordStart")[0];
    acknowledge(start);
    await waitFor(() => expect(current.recording).toBe(true));
    acknowledge(start, {
      status: "step",
      stepNumber: 1,
      step: { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Stop recording and review macro" }),
    );
    acknowledge(sent("recordStop")[0]);
    await screen.findByRole("dialog", { name: "Website automation library" });
    expect(screen.getByText(/Structural positions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save macro" }));
    await waitFor(() => expect(boundary.save).toHaveBeenCalledOnce());
    expect(boundary.save.mock.calls[0][0].steps).toEqual([
      { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
    ]);
    expect(JSON.stringify(boundary.save.mock.calls[0][0])).not.toMatch(
      /"value"|password|requestBody/,
    );
  });
  it("does not revive page actions on Reload when the owning database is locked, even if Macros storage remains readable", async () => {
    await mount();
    boundary.accessible = false;
    act(() => boundary.listener!({ status: "suspended" }));
    await act(async () => current.reload());
    expect(current.libraryReady).toBe(false);
    expect(current.allItems).toEqual([]);
    await act(async () => current.execute(script));
    expect(sent("script")).toHaveLength(0);
    expect(current.error).toMatch(/locked|access/);
  });
  it("rejects a library read whose captured lease expired during an owner lock/unlock ABA", async () => {
    await mount();
    let resolve!: (value: { value: WebAutomationLibrary }) => void;
    boundary.load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let reload!: Promise<void>;
    act(() => {
      reload = current.reload();
    });
    boundary.lease++;
    await act(async () => {
      resolve({ value: library });
      await reload;
    });
    expect(current.libraryReady).toBe(false);
    expect(current.error).toMatch(/lease changed/);
  });
  it("waits for durable favorite saving and surfaces a flush failure without a success claim", async () => {
    await mount();
    let reject!: (error: Error) => void;
    boundary.update.mockImplementationOnce(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = current.favorite(script);
      void current.favorite(script);
    });
    expect(boundary.update).toHaveBeenCalledOnce();
    expect(current.busy).toBe(true);
    expect(boundary.update.mock.calls[0][0].httpAutomation.items).toEqual([]);
    await act(async () => {
      reject(new Error("disk refused"));
      await pending;
    });
    expect(current.error).toMatch(/could not be confirmed saved.*disk refused/);
    expect(current.busy).toBe(false);
  });
  it("cancels pending page operations and review dialogs on full navigation", async () => {
    const view = await mount();
    let pending!: Promise<void>;
    act(() => {
      pending = current.execute(script);
    });
    doc = null;
    view.rerender(<Fixture navigation="loading-next" />);
    await act(async () => pending);
    expect(current.busy).toBe(false);
    expect(current.pendingRun).toBeNull();
    expect(sent("cancel").length).toBeGreaterThan(0);
    expect(
      sent("dark").some((request) => request.payload.enabled === false),
    ).toBe(true);
  });
  it("keeps all website capabilities off when connection consent is absent", async () => {
    delete connection.httpAutomation;
    await mount();
    expect(screen.getByRole("button", { name: "Record macro" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Record macro" }));
    expect(
      screen.getByRole("button", { name: "Enable website macros" }),
    ).toBeInTheDocument();
    expect(sent("recordStart")).toHaveLength(0);
    expect(boundary.update).not.toHaveBeenCalled();
    await act(async () => current.execute(script));
    expect(sent("script")).toHaveLength(0);
    expect(
      sent("dark").some((request) => request.payload.enabled === true),
    ).toBe(false);
  });
  it("does not infer the owning database for an older session with no owner receipt", async () => {
    render(<Fixture owner="" />);
    await waitFor(() => expect(current.error).toMatch(/owner is unknown/));
    expect(boundary.load).not.toHaveBeenCalled();
    expect(current.libraryReady).toBe(false);
  });
});
