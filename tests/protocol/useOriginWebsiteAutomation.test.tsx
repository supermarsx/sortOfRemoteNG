import React from "react";
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
  BrowserScript,
  WebInteractionMacro,
} from "../../src/types/recording/webAutomation";
import type {
  OriginAutomationDocument,
  OriginAutomationRequest,
  OriginAutomationTransport,
} from "../../src/utils/recording/originWebsiteAutomationBridge";
const boundary = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  lease: 1,
  accessible: true,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: () => () => {},
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "db" }),
      captureCurrentDatabaseDataTarget: () => {
        const lease = boundary.lease;
        return {
          databaseId: "db",
          assertAccessible: () => {
            if (!boundary.accessible || lease !== boundary.lease)
              throw new Error("access changed");
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
}));
import { useOriginWebsiteAutomation } from "../../src/hooks/protocol/useOriginWebsiteAutomation";
import OriginAutomationControls from "../../src/components/protocol/webBrowser/OriginAutomationControls";
import {
  clearSessionActivityLog,
  getSessionActivityLog,
} from "../../src/utils/monitoring/sessionActivityLog";
const script: BrowserScript = {
  kind: "script",
  id: "script",
  name: "Native script fixture",
  description: "",
  code: "document.title",
  createdAt: "2026-10-06T00:00:00Z",
  updatedAt: "2026-10-06T00:00:00Z",
};
const macro: WebInteractionMacro = {
  ...script,
  kind: "macro",
  id: "macro",
  name: "Native macro fixture",
  steps: [{ kind: "fill", selector: "html > body > input:nth-of-type(1)" }],
} as WebInteractionMacro;
// Construct the same strict value-free schema accepted by the existing library.
delete (macro as unknown as Record<string, unknown>).code;
let connection: Connection;
let settings: GlobalSettings;
let current: ReturnType<typeof useOriginWebsiteAutomation>;
let request: ReturnType<typeof vi.fn<OriginAutomationTransport["request"]>>;
let transport: OriginAutomationTransport;
let document: OriginAutomationDocument;
const assertOwner = () => {
  if (!boundary.accessible || boundary.lease !== 1)
    throw new Error("owner revoked");
};
function Fixture({
  doc = document,
  fetchNative = false,
  navigation = "ready",
  identity,
  blocked = false,
  settingsReady = true,
  scopeKey = "db:unlock-1",
}: {
  doc?: OriginAutomationDocument | null;
  fetchNative?: boolean;
  navigation?: string;
  identity?: OriginAutomationDocument["identity"] | null;
  blocked?: boolean;
  settingsReady?: boolean;
  scopeKey?: string;
}) {
  current = useOriginWebsiteAutomation({
    connection,
    ownerDatabaseId: "db",
    settings,
    settingsReady,
    scopeKey,
    blocked,
    document: fetchNative ? undefined : doc,
    identity:
      identity === undefined && fetchNative ? document.identity : identity,
    navigationKey: navigation,
    assertOwner,
    transport,
    updateConnection: boundary.update,
  });
  return <OriginAutomationControls automation={current} />;
}
const documentReads = () =>
  request.mock.calls.filter(([value]) => value.operation.action === "document");
function deferredDocument() {
  let resolve!: (
    value: Awaited<ReturnType<OriginAutomationTransport["request"]>>,
  ) => void;
  const promise = new Promise<
    Awaited<ReturnType<OriginAutomationTransport["request"]>>
  >((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (documentToken: string) =>
      resolve({
        status: "document",
        documentToken,
        origin: document.origin,
      }),
  };
}
async function mount() {
  const view = render(<Fixture />);
  await waitFor(() =>
    expect(current.libraryReady && current.pageReady).toBe(true),
  );
  return view;
}
beforeEach(() => {
  vi.clearAllMocks();
  clearSessionActivityLog();
  boundary.lease = 1;
  boundary.accessible = true;
  boundary.load.mockResolvedValue({
    value: { version: 1, scripts: [script], macros: [macro] },
  });
  boundary.save.mockImplementation(async (item, _expected, check) => {
    check();
    return {
      version: 1,
      scripts: [script],
      macros: item.kind === "macro" ? [item] : [macro],
    };
  });
  boundary.update.mockResolvedValue(undefined);
  document = {
    identity: {
      ownerDatabaseId: "db",
      connectionId: "connection",
      sessionId: "tab",
      attemptId: "attempt",
    },
    documentToken: "doc-1",
    origin: "https://example.test",
  };
  request = vi.fn(async ({ operation }: OriginAutomationRequest) =>
    operation.action === "document"
      ? {
          status: "document" as const,
          documentToken: document.documentToken,
          origin: document.origin,
        }
      : operation.action === "recordStop"
        ? {
            status: "recordingStopped" as const,
            requestId: operation.requestId,
            steps: macro.steps,
            truncated: false,
          }
        : { status: "completed" as const, requestId: operation.requestId },
  );
  transport = { request };
  connection = {
    id: "connection",
    name: "Fixture",
    protocol: "https",
    hostname: "example.test",
    port: 443,
    isGroup: false,
    createdAt: "2026-10-06",
    updatedAt: "2026-10-06",
    httpAutomation: {
      version: 1,
      scriptInjectionEnabled: true,
      interactionMacrosEnabled: true,
      forceDark: true,
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
afterEach(cleanup);
describe("native automation hook and reused controls", () => {
  it.each(["connection", "global"])(
    "does not read native receipts for appearance-only or disabled %s automation",
    async (level) => {
      if (level === "connection") {
        connection.httpAutomation!.scriptInjectionEnabled = false;
        connection.httpAutomation!.interactionMacrosEnabled = false;
      } else {
        settings.sessionQuickActions.allowWebScriptInjection = false;
        settings.sessionQuickActions.allowWebMacros = false;
      }
      const view = render(<Fixture fetchNative />);
      await waitFor(() => expect(current.libraryReady).toBe(true));
      view.rerender(<Fixture fetchNative blocked />);
      view.rerender(<Fixture fetchNative />);
      await act(async () => current.refreshDocument());
      expect(current.pageReady).toBe(false);
      expect(current.documentUnavailable).toBe(false);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each(["scriptInjectionEnabled", "interactionMacrosEnabled"] as const)(
    "reads once when %s becomes enabled",
    async (capability) => {
      connection.httpAutomation!.scriptInjectionEnabled = false;
      connection.httpAutomation!.interactionMacrosEnabled = false;
      const view = render(<Fixture fetchNative />);
      await waitFor(() => expect(current.libraryReady).toBe(true));
      expect(documentReads()).toHaveLength(0);
      connection.httpAutomation![capability] = true;
      view.rerender(<Fixture fetchNative />);
      await waitFor(() => expect(current.pageReady).toBe(true));
      expect(documentReads()).toHaveLength(1);
    },
  );
  it("fails closed without a receipt read for malformed consent", async () => {
    connection.httpAutomation!.version = 99 as 1;
    render(<Fixture fetchNative />);
    await waitFor(() => expect(current.libraryReady).toBe(true));
    expect(current.pageReady).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("retains a settled receipt across menu blocking without allowing blocked mutations", async () => {
    const view = render(<Fixture fetchNative />);
    await waitFor(() => expect(current.pageReady).toBe(true));
    view.rerender(<Fixture fetchNative blocked />);
    expect(current.pageReady).toBe(false);
    await act(async () => current.execute(script));
    expect(
      request.mock.calls.some(([value]) => value.operation.action === "script"),
    ).toBe(false);
    view.rerender(<Fixture fetchNative />);
    await waitFor(() => expect(current.pageReady).toBe(true));
    await act(async () => current.execute(script));
    expect(documentReads()).toHaveLength(1);
    expect(
      request.mock.calls.find(
        ([value]) => value.operation.action === "script",
      )?.[0].operation,
    ).toMatchObject({ documentToken: "doc-1" });
  });
  it("reuses an in-flight receipt through menu blocking", async () => {
    const pending = deferredDocument();
    request.mockImplementationOnce(() => pending.promise);
    const view = render(<Fixture fetchNative />);
    view.rerender(<Fixture fetchNative blocked />);
    await act(async () => pending.resolve("pending-menu-document"));
    expect(current.pageReady).toBe(false);
    view.rerender(<Fixture fetchNative />);
    await waitFor(() => expect(current.pageReady).toBe(true));
    expect(documentReads()).toHaveLength(1);
  });
  it("does not retry a failed receipt just because a menu closes", async () => {
    request.mockResolvedValueOnce({ status: "failed", reason: "unavailable" });
    const view = render(<Fixture fetchNative />);
    await waitFor(() => expect(current.documentUnavailable).toBe(true));
    view.rerender(<Fixture fetchNative blocked />);
    view.rerender(<Fixture fetchNative />);
    expect(documentReads()).toHaveLength(1);
    expect(current.documentUnavailable).toBe(true);
    await act(async () => current.refreshDocument());
    await waitFor(() => expect(current.pageReady).toBe(true));
    expect(documentReads()).toHaveLength(2);
  });
  it.each(["navigation", "identity", "scope", "settings", "consent"])(
    "never revives a cached A receipt after a %s A-B-A transition",
    async (change) => {
      const view = render(<Fixture fetchNative />);
      await waitFor(() => expect(current.pageReady).toBe(true));
      const b = deferredDocument();
      const nextA = deferredDocument();
      const bReads = change === "navigation" || change === "scope";
      if (bReads) request.mockImplementationOnce(() => b.promise);
      request.mockImplementationOnce(() => nextA.promise);
      if (change === "consent") {
        connection.httpAutomation!.scriptInjectionEnabled = false;
        connection.httpAutomation!.interactionMacrosEnabled = false;
      }
      view.rerender(
        <Fixture
          fetchNative
          navigation={change === "navigation" ? "loading" : "ready"}
          identity={change === "identity" ? null : document.identity}
          scopeKey={change === "scope" ? "db:unlock-2" : "db:unlock-1"}
          settingsReady={change !== "settings"}
        />,
      );
      expect(current.pageReady).toBe(false);
      connection.httpAutomation!.scriptInjectionEnabled = true;
      connection.httpAutomation!.interactionMacrosEnabled = true;
      view.rerender(<Fixture fetchNative />);
      expect(current.pageReady).toBe(false);
      await act(async () => {
        if (bReads) b.resolve("obsolete-b");
      });
      expect(current.pageReady).toBe(false);
      await act(async () => nextA.resolve("fresh-a"));
      await waitFor(() => expect(current.pageReady).toBe(true));
      await act(async () => current.execute(script));
      expect(
        request.mock.calls.find(
          ([value]) => value.operation.action === "script",
        )?.[0].operation,
      ).toMatchObject({ documentToken: "fresh-a" });
    },
  );
  it("rejects an original pending A reply after navigation A-B-A", async () => {
    const oldA = deferredDocument(),
      b = deferredDocument(),
      nextA = deferredDocument();
    request
      .mockImplementationOnce(() => oldA.promise)
      .mockImplementationOnce(() => b.promise)
      .mockImplementationOnce(() => nextA.promise);
    const view = render(<Fixture fetchNative />);
    view.rerender(<Fixture fetchNative navigation="loading" />);
    view.rerender(<Fixture fetchNative />);
    await act(async () => {
      oldA.resolve("obsolete-a");
      b.resolve("obsolete-b");
    });
    expect(current.pageReady).toBe(false);
    await act(async () => nextA.resolve("fresh-a"));
    await waitFor(() => expect(current.pageReady).toBe(true));
    expect(documentReads()).toHaveLength(3);
  });
  it("still checks current owner and permissions before using a cached receipt", async () => {
    const view = render(<Fixture fetchNative />);
    await waitFor(() => expect(current.pageReady).toBe(true));
    view.rerender(<Fixture fetchNative blocked />);
    view.rerender(<Fixture fetchNative />);
    await waitFor(() => expect(current.pageReady).toBe(true));
    connection.httpAutomation!.scriptInjectionEnabled = false;
    await act(async () => current.execute(script));
    connection.httpAutomation!.scriptInjectionEnabled = true;
    boundary.accessible = false;
    await act(async () => current.execute(script));
    expect(documentReads()).toHaveLength(1);
    expect(
      request.mock.calls.some(([value]) => value.operation.action === "script"),
    ).toBe(false);
  });
  it.each([
    "sessionId",
    "attemptId",
    "ownerDatabaseId",
    "connectionId",
  ] as const)(
    "does not enable a supplied receipt for a different %s",
    async (field) => {
      render(
        <Fixture identity={{ ...document.identity, [field]: "successor" }} />,
      );
      await waitFor(() => expect(current.libraryReady).toBe(true));
      expect(current.pageReady).toBe(false);
      expect(screen.getByRole("button", { name: script.name })).toBeDisabled();
      await act(async () => current.execute(script));
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("disables a supplied receipt after detachment and enables the successor only with its own receipt", async () => {
    const view = render(<Fixture identity={document.identity} />);
    await waitFor(() => expect(current.pageReady).toBe(true));
    view.rerender(<Fixture identity={null} />);
    expect(current.pageReady).toBe(false);
    const successor = { ...document.identity, attemptId: "successor" };
    view.rerender(<Fixture identity={successor} />);
    expect(current.pageReady).toBe(false);
    view.rerender(
      <Fixture
        identity={successor}
        doc={{
          ...document,
          identity: successor,
          documentToken: "successor-document",
        }}
      />,
    );
    await waitFor(() => expect(current.pageReady).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: script.name }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Run on current page" }),
    );
    await waitFor(() => expect(current.executionOutcome).toBe("dispatched"));
    expect(
      request.mock.calls.find(
        ([value]) => value.operation.action === "script",
      )?.[0],
    ).toMatchObject({
      identity: successor,
      operation: { documentToken: "successor-document" },
    });
  });
  it("fetches the actual native document receipt before enabling execution", async () => {
    render(<Fixture fetchNative />);
    await waitFor(() => expect(current.pageReady).toBe(true));
    expect(request.mock.calls[0][0]).toEqual({
      identity: document.identity,
      operation: { action: "document" },
    });
    await act(async () => {
      await current.execute(script);
    });
    expect(
      request.mock.calls.find(
        ([value]) => value.operation.action === "script",
      )?.[0].operation,
    ).toMatchObject({
      action: "script",
      documentToken: "doc-1",
      origin: "https://example.test",
    });
  });
  it("discards a delayed document getter after navigation instead of accepting an old receipt", async () => {
    let resolve!: (value: {
      status: "document";
      documentToken: string;
      origin: string;
    }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<Fixture fetchNative navigation="old" />);
    expect(current.pageReady).toBe(false);
    document = { ...document, documentToken: "doc-2" };
    view.rerender(<Fixture fetchNative navigation="new" />);
    await waitFor(() => expect(current.pageReady).toBe(true));
    await act(async () => {
      resolve({
        status: "document",
        documentToken: "old-token",
        origin: "https://example.test",
      });
    });
    await act(async () => {
      await current.execute(script);
    });
    expect(
      request.mock.calls.find(
        ([value]) => value.operation.action === "script",
      )?.[0].operation,
    ).toMatchObject({ documentToken: "doc-2" });
  });
  it("shows fixed unavailable wording for a malformed native document and supports explicit refresh", async () => {
    request.mockResolvedValueOnce({
      status: "document",
      documentToken: "token",
      origin: "https://secret:private@example.test",
    });
    render(<Fixture fetchNative />);
    await waitFor(() => expect(current.documentUnavailable).toBe(true));
    expect(current.pageReady).toBe(false);
    expect(screen.getByRole("alert")).not.toHaveTextContent("private");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh automation document" }),
    );
    await waitFor(() => expect(current.pageReady).toBe(true));
  });
  it("uses the protected script library and confirmation without iframe or native dark actions", async () => {
    await mount();
    expect(globalThis.document.querySelector("iframe")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: script.name }));
    await screen.findByRole("button", { name: "Run on current page" });
    expect(
      screen.getByRole("button", { name: "Run on current page" }),
    ).toBeEnabled();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Run on current page" }),
    );
    await waitFor(() => expect(current.executionOutcome).toBe("dispatched"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "completion is unverified",
    );
    expect(
      request.mock.calls.filter(
        ([value]) => value.operation.action === "script",
      ),
    ).toHaveLength(1);
    expect(boundary.load.mock.calls.length).toBeGreaterThan(2);
    expect(
      getSessionActivityLog().some((entry) => entry.code === "completed"),
    ).toBe(false);
  });
  it("rechecks the library source before injecting reviewed JavaScript", async () => {
    await mount();
    await act(async () => {
      await current.requestRun(script);
    });
    boundary.load.mockResolvedValue({
      value: {
        version: 1,
        scripts: [{ ...script, code: "document.body" }],
        macros: [],
      },
    });
    await act(async () => {
      await current.execute(script);
    });
    expect(request).not.toHaveBeenCalled();
    expect(current.error).toMatch(/changed or was deleted/);
  });
  it("honors script/macro opt-outs independently", async () => {
    connection.httpAutomation!.scriptInjectionEnabled = false;
    connection.httpAutomation!.interactionMacrosEnabled = false;
    await mount();
    await act(async () => {
      await current.execute(script);
    });
    expect(current.error).toMatch(/disabled/);
    await act(async () => {
      expect(await current.startRecording()).toBe(false);
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("prompts for each fill once and never saves its value with the macro", async () => {
    connection.httpAutomation!.items!.push({ kind: "macro", id: macro.id });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: macro.name }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Run on current page" }),
    );
    await waitFor(() => expect(current.valuePrompt?.index).toBe(1));
    expect(screen.getByLabelText("Field value")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.change(screen.getByLabelText("Field value"), {
      target: { value: "one-use-fixture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill once" }));
    await waitFor(() => expect(current.executionOutcome).toBe("completed"));
    expect(
      request.mock.calls.find(
        ([value]) => value.operation.action === "step",
      )?.[0].operation,
    ).toMatchObject({
      action: "step",
      step: macro.steps[0],
      value: "one-use-fixture",
      documentToken: document.documentToken,
      origin: document.origin,
    });
    expect(current.valuePrompt).toBeNull();
    expect(boundary.save).not.toHaveBeenCalled();
    expect(JSON.stringify(current.steps)).not.toContain("one-use-fixture");
  });
  it("cancels pending replay input when the native document changes", async () => {
    const view = await mount();
    let execution!: Promise<void>;
    act(() => {
      execution = current.execute(macro);
    });
    await waitFor(() => expect(current.valuePrompt).not.toBeNull());
    view.rerender(<Fixture doc={{ ...document, documentToken: "doc-2" }} />);
    await act(async () => {
      await execution;
    });
    expect(current.valuePrompt).toBeNull();
    expect(
      request.mock.calls.filter(([value]) => value.operation.action === "step"),
    ).toHaveLength(0);
  });
  it("retains the original unlock lease instead of accepting same-ID reopen", async () => {
    await mount();
    boundary.lease++;
    await act(async () => {
      await current.execute(script);
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("records and saves only native value-free structural steps through the existing library", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record macro" }));
    await screen.findByRole("button", {
      name: "Stop recording and review macro",
    });
    expect(current.steps).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop recording and review macro" }),
    );
    await screen.findByRole("dialog", { name: "Website automation library" });
    expect(current.steps).toEqual(macro.steps);
    expect(current.recording).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Recorded fixture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save macro" }));
    await waitFor(() => expect(boundary.save).toHaveBeenCalledOnce());
    expect(boundary.save.mock.calls[0][0].steps).toEqual(macro.steps);
    expect(boundary.save.mock.calls[0][0].steps[0]).not.toHaveProperty("value");
  });
  it("records, explicitly saves and replays a complete native click/fill/check macro in order", async () => {
    const steps: WebInteractionMacro["steps"] = [
      { kind: "click", selector: "html > body > button:nth-of-type(1)" },
      { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
      {
        kind: "check",
        selector: "html > body > input:nth-of-type(2)",
        checked: true,
      },
    ];
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (value) =>
      value.operation.action === "recordStop"
        ? {
            status: "recordingStopped",
            requestId: value.operation.requestId,
            steps,
            truncated: false,
          }
        : original(value),
    );
    await mount();
    await act(async () => {
      expect(await current.startRecording()).toBe(true);
      await current.stopRecording();
    });
    expect(current.steps).toEqual(steps);
    expect(boundary.save).not.toHaveBeenCalled();
    const recorded = current.recordedMacro("Recorded native sequence");
    await act(async () => {
      expect(await current.save(recorded)).toBe(true);
    });
    expect(boundary.save.mock.calls[0][0].steps).toEqual(steps);
    // Replay re-reads the protected store, not its in-memory saved-item cache.
    boundary.load.mockResolvedValue({
      value: { version: 1, scripts: [script], macros: [recorded] },
    });
    let replay!: Promise<void>;
    act(() => {
      replay = current.execute(recorded);
    });
    await waitFor(() => expect(current.valuePrompt?.index).toBe(2));
    act(() => current.answerValue("transient replay text"));
    await act(async () => {
      await replay;
    });
    const sent = request.mock.calls
      .map(([row]) => row.operation)
      .filter((row) => row.action === "step");
    expect(sent).toHaveLength(3);
    expect(sent.map((row) => row.step)).toEqual(steps);
    expect(sent[1]).toMatchObject({
      value: "transient replay text",
      documentToken: "doc-1",
    });
    expect(sent[0]).not.toHaveProperty("value");
    expect(sent[2]).not.toHaveProperty("value");
    expect(current.executionOutcome).toBe("completed");
    expect(JSON.stringify(boundary.save.mock.calls)).not.toContain(
      "transient replay text",
    );
  });
  it("stops replay at a failed native step without retrying or running later steps", async () => {
    const sequence: WebInteractionMacro = {
      ...macro,
      steps: [
        { kind: "click", selector: "html > body > button:nth-of-type(1)" },
        {
          kind: "check",
          selector: "html > body > input:nth-of-type(1)",
          checked: true,
        },
      ],
    };
    boundary.load.mockResolvedValue({
      value: { version: 1, scripts: [script], macros: [sequence] },
    });
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (value) =>
      value.operation.action === "step"
        ? { status: "failed", reason: "executionFailed" }
        : original(value),
    );
    await mount();
    await act(async () => {
      await current.execute(sequence);
    });
    expect(
      request.mock.calls.filter(([row]) => row.operation.action === "step"),
    ).toHaveLength(1);
    expect(current.executionOutcome).not.toBe("completed");
    expect(current.error).toMatch(/not confirmed/);
    expect(boundary.save).not.toHaveBeenCalled();
  });
});
