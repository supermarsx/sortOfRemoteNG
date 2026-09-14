import { describe, expect, it } from "vitest";
import {
  createToolSession,
  findExistingToolSession,
  getToolKeyFromProtocol,
  getToolProtocol,
  sessionManagerNavigation,
  selectDetachedSessionManager,
} from "../../src/components/app/toolSession";
import type { WindowRegistry } from "../../src/types/windowManager";
import { mergeLocalSessionUpdate } from "../../src/utils/session/sessionLifecycle";
import TOOL_ENTRIES from "../../src/components/SettingsDialog/sections/behavior/TOOL_ENTRIES";

describe("Action Log is a Session Manager navigation alias", () => {
  it("does not select a tab when the window registry no longer owns that exact session", () => {
    const session = {
      ...createToolSession("actionLog"),
      layout: {
        isDetached: true,
        windowId: "detached-a",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zIndex: 0,
      },
    };
    const registry: WindowRegistry = {
      windows: new Map([
        [
          "detached-a",
          {
            windowId: "detached-a",
            sessionIds: [session.id],
            activeSessionId: "other",
            createdAt: 0,
          },
        ],
      ]),
      sessionOwnership: new Map([[session.id, "detached-b"]]),
    };
    expect(selectDetachedSessionManager(registry, session)).toBe(false);
    expect(registry.windows.get("detached-a")?.activeSessionId).toBe("other");
    registry.sessionOwnership.set(session.id, "detached-a");
    registry.windows.get("detached-a")!.sessionIds = [];
    expect(selectDetachedSessionManager(registry, session)).toBe(false);
  });
  it("creates a canonical manager while keeping the old persisted protocol readable", () => {
    expect(getToolKeyFromProtocol("tool:actionLog")).toBe("actionLog");
    expect(getToolProtocol("actionLog")).toBe("tool:internalProxy");
    const session = createToolSession("actionLog");
    expect(session).toMatchObject({
      protocol: "tool:internalProxy",
      name: "Session Manager",
      connectionId: "tool-internalProxy",
      sessionManagerView: { view: "action-log" },
    });
    expect(session.sessionManagerView?.requestId).toBeTruthy();
    expect(TOOL_ENTRIES.some(({ key }) => String(key) === "actionLog")).toBe(
      false,
    );
  });
  it.each(["tool:internalProxy", "tool:actionLog", "tool:rdpSessions"])(
    "focuses existing %s instead of opening a duplicate",
    (protocol) => {
      const existing = { ...createToolSession("internalProxy"), protocol };
      expect(findExistingToolSession([existing], "actionLog")).toBe(existing);
      expect(findExistingToolSession([existing], "internalProxy")).toBe(
        existing,
      );
      expect(findExistingToolSession([existing], "rdpSessions")).toBe(existing);
    },
  );
  it("prefers an already detached manager and preserves its owner/layout when requesting the log", () => {
    const main = createToolSession("internalProxy");
    const detached = {
      ...createToolSession("rdpSessions"),
      ownerDatabaseId: "owner-a",
      layout: {
        isDetached: true,
        windowId: "window-a",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zIndex: 0,
      },
    };
    expect(findExistingToolSession([main, detached], "actionLog")).toBe(
      detached,
    );
    const request = sessionManagerNavigation("actionLog");
    const updated = mergeLocalSessionUpdate(detached, {
      id: detached.id,
      sessionManagerView: request,
    });
    expect(updated.ownerDatabaseId).toBe("owner-a");
    expect(updated.layout).toEqual(detached.layout);
    expect(updated.sessionManagerView).toEqual(request);
    expect(JSON.stringify(request)).not.toMatch(
      /credential|password|token|cookie/,
    );
  });
  it("uses fresh requests for repeated navigation and does not change old RDP entry intent", () => {
    const first = sessionManagerNavigation("actionLog");
    const second = sessionManagerNavigation("actionLog");
    expect(first?.requestId).not.toBe(second?.requestId);
    expect(sessionManagerNavigation("internalProxy")?.view).toBe("sessions");
    expect(sessionManagerNavigation("rdpSessions")).toBeUndefined();
    expect(sessionManagerNavigation("wol")).toBeUndefined();
    expect(createToolSession("rdpSessions").protocol).toBe("tool:rdpSessions");
    expect(
      findExistingToolSession([createToolSession("internalProxy")], "wol"),
    ).toBeUndefined();
  });
});
