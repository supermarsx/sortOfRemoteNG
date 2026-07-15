import { describe, expect, it } from "vitest";
import type { ConnectionSession } from "../../../src/types/connection/connection";
import {
  BehaviorWindowLifecycleCoordinator,
  type BehaviorWindowLifecycleSignal,
} from "../../../src/utils/behavior/windowLifecycle";

const session = (
  id: string,
  windowId = "main",
  protocol = "ssh",
): ConnectionSession => ({
  id,
  connectionId: `connection-${id}`,
  name: id,
  status: "connected",
  startTime: new Date(0),
  protocol,
  hostname: "host.test",
  layout: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    zIndex: 1,
    isDetached: windowId !== "main",
    windowId: windowId === "main" ? undefined : windowId,
  },
});

const signal = (
  edge: BehaviorWindowLifecycleSignal["edge"],
  eventId: string,
  windowId = "main",
  activeSessionId = "main-session",
  closeAttemptId?: string,
): BehaviorWindowLifecycleSignal => ({
  version: 1,
  edge,
  eventId,
  timestamp: 100,
  closeAttemptId,
  window: {
    id: windowId,
    kind: windowId === "main" ? "main" : "detached",
    activeSessionId,
  },
});

describe("BehaviorWindowLifecycleCoordinator", () => {
  const sessions = [
    session("main-session"),
    session("detached-a", "detached-1"),
    session("detached-b", "detached-2"),
    session("tool", "main", "tool:settings"),
  ];

  it("accepts each focus, blur, minimize, and restore edge once", () => {
    const coordinator = new BehaviorWindowLifecycleCoordinator();
    expect(coordinator.accept(signal("focused", "1"), sessions)?.type).toBe(
      "window.focused",
    );
    expect(
      coordinator.accept(signal("focused", "2"), sessions),
    ).toBeUndefined();
    expect(coordinator.accept(signal("blurred", "3"), sessions)?.type).toBe(
      "window.blurred",
    );
    expect(
      coordinator.accept(signal("blurred", "4"), sessions),
    ).toBeUndefined();
    expect(coordinator.accept(signal("minimized", "5"), sessions)?.type).toBe(
      "window.minimized",
    );
    expect(
      coordinator.accept(signal("minimized", "6"), sessions),
    ).toBeUndefined();
    expect(coordinator.accept(signal("restored", "7"), sessions)?.type).toBe(
      "window.restored",
    );
    expect(
      coordinator.accept(signal("restored", "8"), sessions),
    ).toBeUndefined();
  });

  it("isolates state by window and enforces exact active ownership", () => {
    const coordinator = new BehaviorWindowLifecycleCoordinator();
    expect(
      coordinator.accept(
        signal("focused", "a", "detached-1", "detached-a"),
        sessions,
      )?.session.id,
    ).toBe("detached-a");
    expect(
      coordinator.accept(
        signal("focused", "b", "detached-2", "detached-b"),
        sessions,
      )?.session.id,
    ).toBe("detached-b");
    expect(
      coordinator.accept(
        signal("blurred", "c", "detached-1", "detached-b"),
        sessions,
      ),
    ).toBeUndefined();
    expect(
      coordinator.accept(
        signal("focused", "d", "main", "detached-a"),
        sessions,
      ),
    ).toBeUndefined();
    expect(
      coordinator.accept(signal("focused", "e", "main", "tool"), sessions),
    ).toBeUndefined();
  });

  it("distinguishes cancelled close attempts from confirmed closure", () => {
    const coordinator = new BehaviorWindowLifecycleCoordinator();
    const request = coordinator.accept(
      signal("closeRequested", "request-1", "main", "main-session", "try-1"),
      sessions,
    );
    expect(request?.type).toBe("window.closeRequested");
    expect(
      coordinator.accept(
        signal("closed", "wrong", "main", "main-session", "try-other"),
        sessions,
      ),
    ).toBeUndefined();
    expect(
      coordinator.accept(
        signal("closeCancelled", "cancel", "main", "main-session", "try-1"),
        sessions,
      ),
    ).toBeUndefined();
    expect(
      coordinator.accept(
        signal("closed", "late", "main", "main-session", "try-1"),
        sessions,
      ),
    ).toBeUndefined();

    const secondRequest = coordinator.accept(
      signal("closeRequested", "request-2", "main", "main-session", "try-2"),
      sessions,
    );
    const closed = coordinator.accept(
      signal("closed", "closed", "main", "main-session", "try-2"),
      sessions,
    );
    expect(secondRequest?.type).toBe("window.closeRequested");
    expect(closed).toMatchObject({
      type: "window.closed",
      parentEventId: "request-2",
    });
    expect(
      coordinator.accept(
        signal("closed", "duplicate", "main", "main-session", "try-2"),
        sessions,
      ),
    ).toBeUndefined();
  });

  it("de-duplicates event IDs even when they cross windows", () => {
    const coordinator = new BehaviorWindowLifecycleCoordinator();
    expect(
      coordinator.accept(signal("focused", "same"), sessions),
    ).toBeDefined();
    expect(
      coordinator.accept(
        signal("focused", "same", "detached-1", "detached-a"),
        sessions,
      ),
    ).toBeUndefined();
  });
});
