import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealSessionInLayout } from "../../src/utils/session/revealSession";
import { useSessionRevealFeedback } from "../../src/hooks/session/useSessionRevealFeedback";
import type { TabLayout } from "../../src/types/connection/connection";

const layout: TabLayout = {
  mode: "grid2",
  sessions: [
    { sessionId: "left", position: { x: 0, y: 0, width: 50, height: 100 } },
    { sessionId: "right", position: { x: 50, y: 0, width: 50, height: 100 } },
  ],
};
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
describe("session reveal", () => {
  it("keeps a target on the opposite side of a split without moving either pane", () => {
    expect(revealSessionInLayout(layout, "right", "left")).toBe(layout);
  });
  it("brings an overflow tab into the active slot and preserves the other pane", () => {
    const next = revealSessionInLayout(layout, "overflow", "left");
    expect(next.sessions[0]).toEqual({
      ...layout.sessions[0],
      sessionId: "overflow",
    });
    expect(next.sessions[1]).toBe(layout.sessions[1]);
    expect(next.mode).toBe("grid2");
  });
  it("opens an interactive viewer from thumbnail mode", () => {
    expect(
      revealSessionInLayout({ ...layout, mode: "miniMosaic" }, "right").mode,
    ).toBe("tabs");
  });
  it("focuses the tab and flashes its existing pane, including repeated reveals", async () => {
    document.body.innerHTML =
      '<div data-testid="session-tabs-scroll"><button id="session-tab-right">Right</button></div><div data-session-viewer-state="mounted" data-session-id="right"></div><div data-session-viewer-state="mounted" data-session-id="left"></div>';
    const hook = renderHook(() => useSessionRevealFeedback("right"));
    act(() => hook.result.current("right"));
    const tab = document.getElementById("session-tab-right")!;
    await waitFor(() => expect(tab).toHaveFocus());
    expect(document.querySelector('[data-session-id="right"]')).toHaveAttribute(
      "data-session-revealed",
      "1",
    );
    expect(
      document.querySelector('[data-session-id="left"]'),
    ).not.toHaveAttribute("data-session-revealed");
    act(() => hook.result.current("right"));
    await waitFor(() =>
      expect(tab).toHaveAttribute("data-session-revealed", "2"),
    );
    hook.unmount();
    expect(tab).not.toHaveAttribute("data-session-revealed");
  });
  it("uses a static highlight with reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.body.innerHTML = '<button id="session-tab-right">Right</button>';
    const tab = document.getElementById("session-tab-right")!;
    const animate = vi.fn();
    Object.defineProperty(tab, "animate", { value: animate });
    const hook = renderHook(() => useSessionRevealFeedback("right"));
    act(() => hook.result.current("right"));
    await waitFor(() => expect(tab).toHaveAttribute("data-session-revealed"));
    expect(animate).not.toHaveBeenCalled();
  });
});
