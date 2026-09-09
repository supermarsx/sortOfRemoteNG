import React, { useRef } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { WebAutomationDocument } from "../../src/types/recording/webAutomation";

const boundary = vi.hoisted(() => ({
  owner: "db-a",
  lease: 1,
  accessible: true,
  accessChanged: null as null | ((event: { status: "suspended" }) => void),
  load: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (
    callback: (event: { status: "suspended" }) => void,
  ) => {
    boundary.accessChanged = callback;
    return () => {
      boundary.accessChanged = null;
    };
  },
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: boundary.owner }),
      captureCurrentDatabaseDataTarget: () => {
        const owner = boundary.owner,
          lease = boundary.lease;
        return {
          databaseId: owner,
          assertAccessible: () => {
            if (
              !boundary.accessible ||
              owner !== boundary.owner ||
              lease !== boundary.lease
            )
              throw new Error("Owner lease changed or database locked");
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

let connection: Connection | undefined;
let settings: GlobalSettings;
let owner: string,
  scope: string,
  navigation: string,
  settingsReady: boolean,
  blocked: boolean;
let doc: WebAutomationDocument | null;
let api: ReturnType<typeof useWebAutomation>;
let post: ReturnType<typeof vi.fn>;
const getDocument = () => doc;
function Fixture() {
  const iframe = useRef<HTMLIFrameElement>(null);
  api = useWebAutomation({
    connection,
    ownerDatabaseId: owner,
    settings,
    settingsReady,
    scopeKey: scope,
    blocked,
    navigationKey: navigation,
    iframe,
    getDocument,
    updateConnection: boundary.update,
  });
  return <iframe ref={iframe} title="Recording fixture" />;
}
async function mount() {
  const view = render(<Fixture />);
  const iframe = view.getByTitle("Recording fixture") as HTMLIFrameElement;
  post = vi
    .spyOn(iframe.contentWindow!, "postMessage")
    .mockImplementation(() => undefined);
  await waitFor(() => expect(api.libraryReady).toBe(true));
  return view;
}
function requests(action: string) {
  return post.mock.calls
    .filter(([data]) => data.action === action)
    .map(([data]) => data);
}
function reply(request: Record<string, unknown>, values = {}) {
  const iframe = document.querySelector("iframe")!;
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: new URL(String(request.url)).origin,
        data: {
          ...request,
          type: "proxy_web_automation",
          status: "ok",
          ...values,
        },
      }),
    ),
  );
}
function enableConfig() {
  connection!.httpAutomation = {
    version: 1,
    items: [],
    interactionMacrosEnabled: true,
    scriptInjectionEnabled: false,
    forceDark: false,
  };
}
beforeEach(() => {
  boundary.owner = "db-a";
  boundary.lease = 1;
  boundary.accessible = true;
  boundary.accessChanged = null;
  boundary.load
    .mockReset()
    .mockResolvedValue({ value: { version: 1, scripts: [], macros: [] } });
  boundary.update.mockReset().mockResolvedValue(undefined);
  boundary.save.mockReset();
  boundary.remove.mockReset();
  owner = "db-a";
  scope = "db-a:1";
  navigation = "ready";
  settingsReady = true;
  blocked = false;
  doc = {
    generation: 1,
    sessionId: "proxy-a",
    token: "d".repeat(32),
    sequence: 1,
    navigationToken: null,
    url: "http://127.0.0.1:43001/public",
  };
  connection = {
    id: "connection-a",
    name: "Demo",
    protocol: "http",
    hostname: "demo.example.test",
    port: 81,
    isGroup: false,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
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

describe("durable, explicit HTTP/HTTPS macro recording consent", () => {
  it.each(["http", "https"] as const)(
    "offers consent on a ready %s page without treating default-off as unavailability or starting anything",
    async (protocol) => {
      connection!.protocol = protocol;
      const view = await mount();
      expect(api.recordingUnavailableReason).toBeNull();
      expect(api.canEnableMacroRecording).toBe(true);
      await act(async () => expect(await api.startRecording()).toBe(false));
      expect(requests("recordStart")).toHaveLength(0);
      boundary.update.mockImplementation(async (updated) => {
        connection = updated;
        view.rerender(<Fixture />);
      });
      await act(async () =>
        expect(await api.enableMacroRecording()).toBe(true),
      );
      expect(boundary.update).toHaveBeenCalledOnce();
      expect(connection!.httpAutomation).toEqual({
        version: 1,
        items: [],
        interactionMacrosEnabled: true,
        scriptInjectionEnabled: false,
        forceDark: false,
      });
      expect(requests("recordStart")).toHaveLength(0);
      expect(requests("script")).toHaveLength(0);
    },
  );
  it("preserves other explicit capabilities and ordered favorites while enabling only macros", async () => {
    connection!.httpAutomation = {
      version: 1,
      interactionMacrosEnabled: false,
      scriptInjectionEnabled: true,
      forceDark: true,
      items: [{ kind: "script", id: "favorite" }],
    };
    await mount();
    await act(async () => expect(await api.enableMacroRecording()).toBe(true));
    expect(boundary.update.mock.calls[0][0].httpAutomation).toEqual({
      ...connection!.httpAutomation,
      interactionMacrosEnabled: true,
    });
    expect(settings.sessionQuickActions.allowWebMacros).toBe(true);
    expect(requests("recordStart")).toHaveLength(0);
  });
  it("does not require page readiness merely to save consent, but recording remains unavailable", async () => {
    doc = null;
    blocked = true;
    await mount();
    expect(api.recordingUnavailableReason).toMatch(/page.*certificate/i);
    expect(api.canEnableMacroRecording).toBe(true);
    await act(async () => expect(await api.enableMacroRecording()).toBe(true));
    expect(requests("recordStart")).toHaveLength(0);
  });
  it("blocks a failed optimistic Enable until a verified retry, without rolling back unrelated connection changes", async () => {
    const view = await mount();
    let reject!: (error: Error) => void;
    boundary.update.mockImplementationOnce((updated) => {
      connection = { ...updated, name: "Concurrent name retained" };
      view.rerender(<Fixture />);
      return new Promise((_done, fail) => {
        reject = fail;
      });
    });
    let enabled!: Promise<boolean>;
    act(() => {
      enabled = api.enableMacroRecording();
    });
    expect(connection!.httpAutomation!.interactionMacrosEnabled).toBe(true);
    await act(async () => {
      reject(new Error("disk full"));
      expect(await enabled).toBe(false);
    });
    expect(api.permissions!.interactionMacrosEnabled).toBe(false);
    expect(api.recordingUnavailableReason).toBeNull();
    expect(api.error).toMatch(/could not be confirmed saved.*disk full/);
    expect(api.canEnableMacroRecording).toBe(true);
    await act(async () => expect(await api.startRecording()).toBe(false));
    expect(requests("recordStart")).toHaveLength(0);
    boundary.update.mockImplementationOnce(async (updated) => {
      connection = updated;
      view.rerender(<Fixture />);
    });
    await act(async () => expect(await api.enableMacroRecording()).toBe(true));
    expect(boundary.update).toHaveBeenCalledTimes(2);
    expect(connection!.name).toBe("Concurrent name retained");
    expect(api.permissions!.interactionMacrosEnabled).toBe(true);
    expect(api.recordingUnavailableReason).toBeNull();
  });
  it.each(["switch", "lease ABA", "lock"])(
    "does not claim consent after owner %s during persistence",
    async (change) => {
      const view = await mount();
      let resolve!: () => void;
      boundary.update.mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
      let enabled!: Promise<boolean>;
      act(() => {
        enabled = api.enableMacroRecording();
      });
      const oldScope = api.recordingScopeKey;
      if (change === "switch") {
        boundary.owner = "db-b";
        owner = "db-b";
        scope = "db-b:2";
        connection = { ...connection!, id: "connection-b" };
        view.rerender(<Fixture />);
        expect(api.recordingScopeKey).not.toBe(oldScope);
      }
      if (change === "lease ABA") boundary.lease++;
      if (change === "lock") boundary.accessible = false;
      await act(async () => {
        resolve();
        expect(await enabled).toBe(false);
      });
      expect(requests("recordStart")).toHaveLength(0);
      expect(boundary.update).toHaveBeenCalledOnce();
    },
  );
  it.each(["before suspension", "after suspension"])(
    "retains refused optimistic consent when the save rejects %s until a verified retry",
    async (timing) => {
      const view = await mount();
      let reject!: (error: Error) => void;
      boundary.update.mockImplementationOnce((updated) => {
        connection = updated;
        view.rerender(<Fixture />);
        return new Promise((_resolve, fail) => {
          reject = fail;
        });
      });
      let enabled!: Promise<boolean>;
      act(() => {
        enabled = api.enableMacroRecording();
      });
      const dirtyConnection = connection;
      const fail = async () => {
        await act(async () => {
          reject(new Error("disk full"));
          expect(await enabled).toBe(false);
        });
      };
      if (timing === "before suspension") await fail();
      act(() => {
        boundary.accessible = false;
        boundary.accessChanged?.({ status: "suspended" });
      });
      if (timing === "after suspension") await fail();
      boundary.accessible = true;
      boundary.lease++;
      await act(async () => api.reload());
      expect(connection).toBe(dirtyConnection);
      expect(connection!.httpAutomation!.interactionMacrosEnabled).toBe(true);
      expect(api.permissions!.interactionMacrosEnabled).toBe(false);
      expect(api.recordingUnavailableReason).toBeNull();
      expect(api.canEnableMacroRecording).toBe(true);
      await act(async () => expect(await api.startRecording()).toBe(false));
      expect(requests("recordStart")).toHaveLength(0);
      boundary.update.mockImplementationOnce(async (updated) => {
        connection = updated;
        view.rerender(<Fixture />);
      });
      await act(async () =>
        expect(await api.enableMacroRecording()).toBe(true),
      );
      expect(boundary.update).toHaveBeenCalledTimes(2);
      expect(api.permissions!.interactionMacrosEnabled).toBe(true);
      expect(api.error).toBeNull();
    },
  );
  it("keeps a late failed-save receipt with its database, not a cloned connection ID in another database", async () => {
    const view = await mount();
    let reject!: (error: Error) => void;
    boundary.update.mockImplementationOnce((updated) => {
      connection = updated;
      view.rerender(<Fixture />);
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    });
    let enabled!: Promise<boolean>;
    act(() => {
      enabled = api.enableMacroRecording();
    });
    const dirtyConnection = connection;
    boundary.owner = owner = "db-b";
    scope = "db-b:2";
    connection = {
      ...dirtyConnection!,
      name: "Other database saved connection",
    };
    view.rerender(<Fixture />);
    await act(async () => {
      reject(new Error("old database save refused"));
      expect(await enabled).toBe(false);
    });
    await act(async () => api.reload());
    expect(api.permissions!.interactionMacrosEnabled).toBe(true);
    expect(api.canEnableMacroRecording).toBe(false);
    expect(api.error).toBeNull();
    connection = {
      ...connection!,
      httpAutomation: {
        ...connection!.httpAutomation!,
        interactionMacrosEnabled: false,
      },
    };
    view.rerender(<Fixture />);
    boundary.update.mockImplementationOnce(async (updated) => {
      connection = updated;
      view.rerender(<Fixture />);
      throw new Error("second database save refused");
    });
    await act(async () => expect(await api.enableMacroRecording()).toBe(false));
    const otherDirtyConnection = connection;
    expect(api.permissions!.interactionMacrosEnabled).toBe(false);
    boundary.owner = owner = "db-a";
    scope = "db-a:3";
    connection = dirtyConnection;
    view.rerender(<Fixture />);
    await act(async () => api.reload());
    expect(api.permissions!.interactionMacrosEnabled).toBe(false);
    expect(api.canEnableMacroRecording).toBe(true);
    expect(api.error).toMatch(/old database save refused/);
    await act(async () => expect(await api.startRecording()).toBe(false));
    expect(requests("recordStart")).toHaveLength(0);
    boundary.owner = owner = "db-b";
    scope = "db-b:4";
    connection = otherDirtyConnection;
    view.rerender(<Fixture />);
    await act(async () => api.reload());
    expect(api.permissions!.interactionMacrosEnabled).toBe(false);
    expect(api.error).toMatch(/second database save refused/);
  });
  it("changes the confirmation scope key across lock/unlock even when owner and scope labels are unchanged", async () => {
    await mount();
    const oldScope = api.recordingScopeKey;
    act(() => {
      boundary.accessible = false;
      boundary.accessChanged?.({ status: "suspended" });
    });
    expect(api.recordingScopeKey).not.toBe(oldScope);
    expect(api.canEnableMacroRecording).toBe(false);
    boundary.accessible = true;
    boundary.lease++;
    await act(async () => api.reload());
    expect(api.libraryReady).toBe(true);
    expect(api.recordingScopeKey).not.toBe(oldScope);
    expect(api.canEnableMacroRecording).toBe(true);
    expect(boundary.update).not.toHaveBeenCalled();
    expect(requests("recordStart")).toHaveLength(0);
  });
  it.each([
    "missing connection",
    "SSH",
    "settings loading",
    "global macros disabled",
    "global HTTP actions disabled",
    "owner locked",
    "library unavailable",
  ])("explains %s without enabling or starting", async (caseName) => {
    const view = await mount();
    if (caseName === "missing connection") connection = undefined;
    if (caseName === "SSH") connection!.protocol = "ssh";
    if (caseName === "settings loading") settingsReady = false;
    if (caseName === "global macros disabled")
      settings.sessionQuickActions.allowWebMacros = false;
    if (caseName === "global HTTP actions disabled")
      settings.sessionQuickActions.httpEnabled = false;
    if (caseName === "owner locked") boundary.accessible = false;
    if (caseName === "library unavailable") {
      boundary.load.mockRejectedValueOnce(new Error("Macros storage locked"));
      await act(async () => api.reload());
    }
    view.rerender(<Fixture />);
    expect(api.recordingUnavailableReason).toBeTruthy();
    if (caseName !== "library unavailable")
      expect(api.canEnableMacroRecording).toBe(false);
    await act(async () => expect(await api.startRecording()).toBe(false));
    expect(requests("recordStart")).toHaveLength(0);
  });
});

describe("recording acknowledgement, draft and discard lifecycle", () => {
  it("serializes starting/stopping and preserves capture until review or explicit discard", async () => {
    enableConfig();
    await mount();
    let start!: Promise<boolean>;
    act(() => {
      start = api.startRecording();
    });
    expect(api.recordingPending).toBe(true);
    expect(api.recording).toBe(false);
    await act(async () => expect(await api.startRecording()).toBe(false));
    expect(requests("recordStart")).toHaveLength(1);
    reply(requests("recordStart")[0]);
    await act(async () => expect(await start).toBe(true));
    expect(api.recordingPending).toBe(false);
    expect(api.recording).toBe(true);
    reply(requests("recordStart")[0], {
      status: "step",
      stepNumber: 1,
      step: { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
    });
    let stop!: Promise<void>;
    act(() => {
      stop = api.stopRecording();
    });
    expect(api.recordingPending).toBe(true);
    await act(async () => expect(await api.startRecording()).toBe(false));
    const lastStep = {
      kind: "click",
      selector: "html > body > button:nth-of-type(1)",
    };
    reply(requests("recordStart")[0], {
      status: "step",
      stepNumber: 2,
      step: lastStep,
    });
    reply(requests("recordStop")[0]);
    await act(async () => stop);
    expect(api.open).toBe(true);
    expect(api.steps).toHaveLength(2);
    expect(api.steps[1]).toEqual(lastStep);
    reply(requests("recordStart")[0], {
      status: "step",
      stepNumber: 3,
      step: lastStep,
    });
    expect(api.steps).toHaveLength(2);
    await act(async () => expect(await api.startRecording()).toBe(false));
    expect(api.error).toMatch(/Review or discard/);
    act(() => api.discardRecording());
    expect(api.steps).toEqual([]);
    act(() => {
      start = api.startRecording();
    });
    reply(requests("recordStart")[1]);
    await act(async () => expect(await start).toBe(true));
    expect(boundary.save).not.toHaveBeenCalled();
    expect(boundary.remove).not.toHaveBeenCalled();
  });
  it("a stale start acknowledgement cannot complete a new recording after discard", async () => {
    enableConfig();
    await mount();
    let old!: Promise<boolean>, next!: Promise<boolean>;
    act(() => {
      old = api.startRecording();
    });
    const oldRequest = requests("recordStart")[0];
    act(() => api.discardRecording());
    await act(async () => expect(await old).toBe(false));
    act(() => {
      next = api.startRecording();
    });
    reply(oldRequest);
    expect(api.recordingPending).toBe(true);
    expect(api.recording).toBe(false);
    reply(requests("recordStart")[1]);
    await act(async () => expect(await next).toBe(true));
    expect(api.recording).toBe(true);
  });
  it.each(["start", "stop"])(
    "navigation cancels a pending %s without stale success or opening review",
    async (phase) => {
      enableConfig();
      const view = await mount();
      let start!: Promise<boolean>;
      act(() => {
        start = api.startRecording();
      });
      if (phase === "stop") {
        reply(requests("recordStart")[0]);
        await act(async () => start);
      }
      let stop: Promise<void> | undefined;
      if (phase === "stop")
        act(() => {
          stop = api.stopRecording();
        });
      const request = requests(
        phase === "start" ? "recordStart" : "recordStop",
      )[0];
      doc = null;
      navigation = "next-document";
      view.rerender(<Fixture />);
      reply(request);
      await act(async () => {
        if (phase === "start") expect(await start).toBe(false);
        else await stop;
      });
      expect(api.recording).toBe(false);
      expect(api.recordingPending).toBe(false);
      expect(api.open).toBe(false);
    },
  );
  it("keeps a failed start unarmed and never persists anything on discard", async () => {
    enableConfig();
    await mount();
    let start!: Promise<boolean>;
    act(() => {
      start = api.startRecording();
    });
    reply(requests("recordStart")[0], { status: "failed" });
    await act(async () => expect(await start).toBe(false));
    expect(api.recording).toBe(false);
    expect(api.recordingPending).toBe(false);
    act(() => api.discardRecording());
    expect(api.steps).toEqual([]);
    expect(boundary.save).not.toHaveBeenCalled();
    expect(boundary.remove).not.toHaveBeenCalled();
  });
});
