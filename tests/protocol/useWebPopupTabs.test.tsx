import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { WebAutomationDocument } from "../../src/types/recording/webAutomation";
import type { ConnectionAction } from "../../src/contexts/ConnectionContextTypes";
import { webPopupTabs } from "../../src/utils/protocol/webPopupTabs";
const owner = vi.hoisted(() => ({ valid: true }));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: () => () => {
    if (!owner.valid) throw new Error("owner locked");
  },
}));
import { useWebPopupTabs } from "../../src/hooks/protocol/useWebPopupTabs";

const proxy = `http://p${"a".repeat(32)}.localhost:9000`;
const source: ConnectionSession = {
  id: "source",
  connectionId: "rmm",
  ownerDatabaseId: "owner",
  name: "RMM",
  protocol: "https",
  hostname: "rmm.example",
  status: "connected",
  startTime: new Date(),
};
let doc: WebAutomationDocument | null;
let frame: HTMLIFrameElement;
let dispatch: ReturnType<typeof vi.fn<(action: ConnectionAction) => void>>;
let activate: ReturnType<typeof vi.fn<(id: string) => void>>;
let applyAction: (action: ConnectionAction) => void;
const childId = "c".repeat(32);
const initialDocument: WebAutomationDocument = {
  sessionId: "native",
  generation: 2,
  sequence: 3,
  token: "b".repeat(32),
  navigationToken: null,
  url: `${proxy}/dashboard`,
};
beforeEach(() => {
  owner.valid = true;
  doc = { ...initialDocument };
  frame = document.createElement("iframe");
  document.body.append(frame);
  dispatch = vi.fn();
  activate = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 1;
  });
});
afterEach(() => {
  cleanup();
  webPopupTabs.revokeSource(source.id);
  frame.remove();
  vi.unstubAllGlobals();
});
function mount() {
  return renderHook(
    ({ enabled }) => {
      const [sessions, setSessions] = useState<ConnectionSession[]>([source]);
      applyAction = (action) => {
        dispatch(action);
        if (action.type === "ADD_SESSION")
          setSessions((items) => [...items, action.payload]);
        if (action.type === "REMOVE_SESSION")
          setSessions((items) =>
            items.filter((session) => session.id !== action.payload),
          );
      };
      return useWebPopupTabs({
        session: source,
        sessions,
        enabled,
        iframe: { current: frame },
        getDocument: () => doc,
        getProxyUrl: () => `${proxy}/`,
        dispatch: applyAction,
        onActivateSession: activate,
      });
    },
    { initialProps: { enabled: true } },
  );
}
function send(
  extra = {},
  origin = proxy,
  eventSource: Window | null = frame.contentWindow,
) {
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: eventSource,
        origin,
        data: {
          type: "proxy_web_popup",
          version: 1,
          id: childId,
          action: "open",
          sessionId: "native",
          documentSequence: 3,
          documentToken: "b".repeat(32),
          navigationToken: null,
          url: `${proxy}/dashboard`,
          destination: `${proxy}/takecontrol/agent?token=synthetic&__sorng_popup_parent_v1=3`,
          ...extra,
        },
      }),
    ),
  );
}
const opened = () => {
  const action = dispatch.mock.calls.find(
    ([action]) => action.type === "ADD_SESSION",
  )?.[0];
  return action?.type === "ADD_SESSION" ? action.payload : undefined;
};

describe("source popup bridge", () => {
  it("releases capacity when closed before the lazy viewer mounts and cancels pending activation", () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    mount();
    send();
    const popup = opened()!;
    act(() => applyAction({ type: "REMOVE_SESSION", payload: popup.id }));
    expect(webPopupTabs.getSnapshot(popup.id)).toBeNull();
    act(() => callbacks.forEach((callback) => callback()));
    expect(activate).not.toHaveBeenCalled();
    send();
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === "ADD_SESSION"),
    ).toHaveLength(2);
  });
  it("opens and activates an opaque app tab without replacing the dashboard", () => {
    mount();
    send();
    const popup = opened()!;
    expect(popup.protocol).toBe("tool:webPopup");
    expect(JSON.stringify(popup)).not.toMatch(
      /synthetic|localhost|takecontrol/,
    );
    expect(activate).toHaveBeenCalledWith(popup.id);
    expect(frame.getAttribute("src")).toBeNull();
    send({ action: "focus" });
    expect(activate).toHaveBeenCalledTimes(2);
    send({
      action: "navigate",
      destination: `${proxy}/webterm?__sorng_popup_parent_v1=3`,
    });
    expect(webPopupTabs.getSnapshot(popup.id)?.url).toContain("/webterm?");
    send({ action: "close" });
    expect(webPopupTabs.getSnapshot(popup.id)).toBeNull();
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "REMOVE_SESSION",
      payload: popup.id,
    });
  });

  it.each([
    { documentSequence: 2 },
    { documentToken: "d".repeat(32) },
    { sessionId: "other" },
    { navigationToken: "other" },
    { id: "invalid" },
    {
      destination:
        "https://rmm.example/takecontrol/agent?__sorng_popup_parent_v1=3",
    },
    { destination: `${proxy}/takecontrol/agent?__sorng_popup_parent_v1=2` },
    {
      destination: `${proxy}/takecontrol/agent?__sorng_popup_parent_v1=3&__sorng_popup_parent_v1=3`,
    },
    {
      destination: `${proxy}/__sortofremoteng_credentials_v1?__sorng_popup_parent_v1=3`,
    },
  ])("refuses stale or unsupported popup proof %j", (extra) => {
    mount();
    send(extra);
    expect(opened()).toBeUndefined();
  });
  it("ignores other origins and child frames", () => {
    mount();
    send({}, "https://other.example");
    send({}, proxy, window);
    expect(opened()).toBeUndefined();
  });
  it.each(["document", "owner", "disabled"])(
    "revokes children on %s loss",
    (reason) => {
      const hook = mount();
      send();
      const id = opened()!.id;
      if (reason === "document") doc = { ...initialDocument, generation: 4 };
      if (reason === "owner") owner.valid = false;
      hook.rerender({ enabled: reason !== "disabled" });
      expect(webPopupTabs.getSnapshot(id)).toBeNull();
    },
  );
  it("does not open a tab with an inaccessible owner", () => {
    mount();
    owner.valid = false;
    send();
    expect(opened()).toBeUndefined();
  });
  it("keeps a child across harmless rerenders and closes it when the source unmounts", () => {
    const hook = mount();
    send();
    const id = opened()!.id;
    hook.rerender({ enabled: true });
    expect(webPopupTabs.getSnapshot(id)).not.toBeNull();
    hook.unmount();
    expect(webPopupTabs.getSnapshot(id)).toBeNull();
  });
});
