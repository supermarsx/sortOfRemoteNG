import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useOriginBrowserEventLog } from "../../src/hooks/protocol/useOriginBrowserEventLog";
import {
  browserHistoryStore,
  browserLogStore,
  proxyLogStore,
  resetBrowserEventLogsForTests,
} from "../../src/utils/browser/browserEventLog";
import type { OriginBrowserState } from "../../src/hooks/protocol/useOriginBrowser";

const snapshot = (over: Record<string, unknown> = {}) =>
  ({
    identity: {
      ownerDatabaseId: "d",
      connectionId: "c",
      sessionId: "s",
      attemptId: "a",
    },
    sequence: 1,
    phase: "attached",
    displayUrl: "https://r.test/home",
    currentUrl: "https://r.test/home?token=SECRET",
    title: "Home",
    loading: false,
    documentLoaded: true,
    canGoBack: false,
    canGoForward: false,
    ...over,
  }) as never;

const state = (snap: unknown): OriginBrowserState =>
  ({
    phase: "attached",
    snapshot: snap,
    unavailableReason: null,
    error: null,
  }) as OriginBrowserState;

beforeEach(() => resetBrowserEventLogsForTests());

describe("useOriginBrowserEventLog", () => {
  it("logs navigation and load, records redacted history", () => {
    renderHook(() =>
      useOriginBrowserEventLog(state(snapshot()), {
        connectionId: "c",
        sessionId: "s",
        connectionName: "Router",
      }),
    );
    const types = browserLogStore.getSnapshot().map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["navigation", "load"]));
    expect(JSON.stringify(browserLogStore.getSnapshot())).not.toContain(
      "SECRET",
    );
    const history = browserHistoryStore.getSnapshot();
    expect(history).toHaveLength(1);
    expect(history[0].url).toBe("https://r.test/home");
    expect(history[0].title).toBe("Home");
  });

  it("keeps no history for private tabs but still logs", () => {
    renderHook(() =>
      useOriginBrowserEventLog(state(snapshot()), {
        connectionId: "c",
        sessionId: "s",
        private: true,
      }),
    );
    expect(browserHistoryStore.getSnapshot()).toHaveLength(0);
    expect(browserLogStore.getSnapshot().length).toBeGreaterThan(0);
  });

  it("logs certificate failures to both logs", () => {
    renderHook(() =>
      useOriginBrowserEventLog(
        state(
          snapshot({ loadFailure: { code: -200, category: "certificate" } }),
        ),
        { connectionId: "c", sessionId: "s" },
      ),
    );
    expect(
      browserLogStore.getSnapshot().some((e) => e.type === "certificate"),
    ).toBe(true);
    expect(proxyLogStore.getSnapshot().some((e) => e.kind === "tls")).toBe(
      true,
    );
  });
});
