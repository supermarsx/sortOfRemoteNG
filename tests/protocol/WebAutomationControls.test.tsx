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
  listeners: new Set<(event: { status: string }) => void>(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (listener: (event: { status: string }) => void) => {
    boundary.listeners.add(listener);
    return () => {
      boundary.listeners.delete(listener);
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
import WebAutomationNotice from "../../src/components/protocol/webBrowser/WebAutomationNotice";

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
      <WebAutomationNotice automation={current} />
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
  boundary.listeners.clear();
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
  expect(boundary.listeners.size).toBe(0);
  vi.restoreAllMocks();
});
describe("mounted website automation controls and ownership", () => {
  it("keeps loading on the disabled recording tooltip, not a permanent status line", async () => {
    let finish!: (value: { value: WebAutomationLibrary }) => void;
    boundary.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Fixture />);
    expect(screen.queryByText("Loading website macro library…")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Record macro" }),
    ).toHaveAttribute("title", "Loading website macro library…");
    expect(screen.getByRole("button", { name: "Record macro" })).toBeDisabled();
    expect(screen.queryByText(/Unlock its storage/)).toBeNull();
    expect(current.libraryReady).toBe(false);
    await act(async () => finish({ value: library }));
    expect(current.libraryReady).toBe(true);
    expect(current.recordingUnavailableReason).toBeNull();
    expect(screen.queryByText("Loading website macro library…")).toBeNull();
  });
  it("preserves a safe specific storage failure and offers explicit reload without replay", async () => {
    boundary.load.mockRejectedValue(
      "conflicting storage variants at C:\\private\\secret-library.json token=private-value",
    );
    render(<Fixture />);
    await waitFor(() =>
      expect(current.error).toMatch(
        /conflicting storage variants or recovery data/,
      ),
    );
    expect(current.recordingUnavailableReason).toBe(current.error);
    expect(
      screen.getByText("Website automation needs attention"),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /conflicting storage variants/,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /private-value|secret-library/,
    );
    const calls = boundary.load.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Reload library" }));
    await waitFor(() => expect(boundary.load).toHaveBeenCalledTimes(calls + 1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reload library" }),
      ).toBeEnabled(),
    );
    expect(current.libraryReady).toBe(false);
    expect(boundary.save).not.toHaveBeenCalled();
    expect(boundary.update).not.toHaveBeenCalled();
    boundary.load.mockResolvedValue({ value: library });
    fireEvent.click(screen.getByRole("button", { name: "Reload library" }));
    await waitFor(() => expect(current.libraryReady).toBe(true));
    expect(screen.queryByText("Website automation needs attention")).toBeNull();
  });
  it("keeps revoked owner access denied and exposes an explicit retry instead of hiding it behind loading", async () => {
    await mount();
    act(() => {
      boundary.accessible = false;
      for (const listener of boundary.listeners)
        listener({ status: "suspended" });
    });
    expect(current.libraryReady).toBe(false);
    expect(current.recordingUnavailableReason).toMatch(/locked|revoked/);
    fireEvent.click(screen.getByRole("button", { name: "Reload library" }));
    await waitFor(() => expect(current.error).toMatch(/locked/));
    expect(current.libraryReady).toBe(false);
    expect(sent("record-start")).toHaveLength(0);
  });
  it("opens assignment filtered by kind without running, saving or changing permissions", async () => {
    const macro = {
      kind: "macro" as const,
      id: "macro",
      name: "Demo macro",
      description: "",
      steps: [{ kind: "click" as const, selector: "button" }],
      createdAt: script.createdAt,
      updatedAt: script.updatedAt,
    };
    boundary.load.mockResolvedValue({ value: { ...library, macros: [macro] } });
    await mount();
    act(() => current.openLibrary("macro"));
    expect(screen.getByLabelText("Item type")).toHaveValue("macro");
    expect(
      screen.getByRole("button", { name: /Macro · Demo macro/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /JS · Demo script/ }),
    ).not.toBeInTheDocument();
    expect(boundary.update).not.toHaveBeenCalled();
    expect(boundary.save).not.toHaveBeenCalled();
    expect(sent("script")).toHaveLength(0);
    expect(sent("step")).toHaveLength(0);
  });
  it("manages disabled favorite chips without bubbling and removes only the reference", async () => {
    connection.httpAutomation!.scriptInjectionEnabled = false;
    await mount();
    const chip = screen.getByRole("button", { name: "Demo script" });
    expect(chip).toBeDisabled();
    const bubble = vi.fn();
    document.body.addEventListener("contextmenu", bubble);
    fireEvent.contextMenu(chip.parentElement!, { clientX: 15, clientY: 20 });
    expect(bubble).not.toHaveBeenCalled();
    document.body.removeEventListener("contextmenu", bubble);
    expect(screen.getByRole("menuitem", { name: "Run script" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove favorite" }));
    await waitFor(() => expect(boundary.update).toHaveBeenCalledOnce());
    expect(boundary.update.mock.calls[0][0].httpAutomation.items).toEqual([]);
    expect(boundary.remove).not.toHaveBeenCalled();
    expect(boundary.save).not.toHaveBeenCalled();
    expect(sent("script")).toHaveLength(0);
  });
  it("closes favorite menus on revocation and rejects captured opening callbacks", async () => {
    await mount();
    // The real broadcaster owns independent subscriptions. The appearance
    // hook must not overwrite the automation hook's revocation callback.
    expect(boundary.listeners.size).toBeGreaterThanOrEqual(2);
    const oldOpen = current.openLibrary;
    fireEvent.contextMenu(screen.getByRole("button", { name: "Demo script" }), {
      clientX: 5,
      clientY: 5,
    });
    expect(
      screen.getByTestId("web-automation-favorite-menu"),
    ).toBeInTheDocument();
    boundary.accessible = false;
    act(() => {
      for (const listener of [...boundary.listeners])
        listener({ status: "suspended" });
    });
    expect(
      screen.queryByTestId("web-automation-favorite-menu"),
    ).not.toBeInTheDocument();
    act(() => oldOpen("script"));
    expect(current.open).toBe(false);
    expect(boundary.update).not.toHaveBeenCalled();
  });
  it("opens script assignment from the keyboard menu without executing it", async () => {
    await mount();
    fireEvent.keyDown(screen.getByRole("button", { name: "Demo script" }), {
      key: "F10",
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Assign script" }));
    expect(screen.getByLabelText("Item type")).toHaveValue("script");
    expect(
      screen.queryByTestId("web-automation-favorite-menu"),
    ).not.toBeInTheDocument();
    expect(current.pendingRun).toBeNull();
    expect(boundary.update).not.toHaveBeenCalled();
  });
  it("never re-adds a favorite removed by another update while its menu was open", async () => {
    const view = await mount();
    const removeOnly = current.favorite;
    connection = {
      ...connection,
      httpAutomation: { ...connection.httpAutomation!, items: [] },
    };
    view.rerender(<Fixture />);
    await act(async () => removeOnly(script, true));
    expect(boundary.update).not.toHaveBeenCalled();
    expect(current.favorites).toEqual([]);
  });
  it("uses the existing confirmation for context-menu run and blocks management while busy", async () => {
    await mount();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Demo script" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Run script" }));
    await screen.findByRole("dialog", { name: "Review website action" });
    expect(sent("script")).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Run on current page" }),
    );
    await waitFor(() => expect(current.busy).toBe(true));
    act(() => current.openLibrary("script"));
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Demo script" }).parentElement!,
    );
    expect(current.open).toBe(false);
    expect(
      screen.queryByTestId("web-automation-favorite-menu"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(sent("script")).toHaveLength(1));
    acknowledge(sent("script")[0]);
    await waitFor(() => expect(current.busy).toBe(false));
  });
  it("requires explicit confirmation for a favorite and guards rapid duplicate execution", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Demo script" }));
    expect(
      await screen.findByRole("dialog", { name: "Review website action" }),
    ).toBeInTheDocument();
    expect(sent("script")).toHaveLength(0);
    const run = screen.getByRole("button", { name: "Run on current page" });
    fireEvent.click(run);
    fireEvent.click(run);
    await waitFor(() => expect(sent("script")).toHaveLength(1));
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
    act(() => {
      for (const listener of [...boundary.listeners])
        listener({ status: "suspended" });
    });
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
  it("cancels pending page operations on navigation without flashing dark mode off", async () => {
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
    ).toBe(false);
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
