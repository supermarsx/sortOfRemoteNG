import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WebAutomationBridge,
  type WebAutomationContext,
} from "../../src/utils/recording/webAutomationBridge";

const selector = "html > body > button:nth-of-type(1)";
describe("website automation parent-owned bridge", () => {
  let context: WebAutomationContext | null;
  let bridge: WebAutomationBridge;
  let post: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    post = vi.fn();
    context = {
      frame: { postMessage: post } as unknown as Window,
      document: {
        generation: 1,
        sessionId: "proxy-session",
        token: "d".repeat(32),
        sequence: 2,
        navigationToken: "n".repeat(32),
        url: "http://127.0.0.1:43001/public",
      },
    };
    bridge = new WebAutomationBridge(() => context);
  });
  afterEach(() => {
    bridge.cancel();
    vi.useRealTimers();
  });
  const response = (
    overrides: Record<string, unknown> = {},
    event: Partial<MessageEvent> = {},
  ) => {
    const request = post.mock.calls
      .slice()
      .reverse()
      .find((call) => call[0].action !== "cancel")![0];
    bridge.handleMessage({
      data: {
        ...request,
        type: "proxy_web_automation",
        status: "ok",
        ...overrides,
      },
      source: context!.frame,
      origin: new URL(context!.document.url).origin,
      ...event,
    } as MessageEvent);
  };
  it("requires the actual frame, origin, session and complete current document identity", async () => {
    let settled = false;
    const pending = bridge
      .request("script", { code: "document.title='demo'" })
      .then(() => {
        settled = true;
      });
    response({}, { source: window });
    response({}, { origin: "https://example.test" });
    for (const override of [
      { sessionId: "other" },
      { documentToken: "old" },
      { documentSequence: 1 },
      { navigationToken: null },
      { url: "http://127.0.0.1:43001/other" },
      { requestId: "unsolicited" },
    ])
      response(override);
    await Promise.resolve();
    expect(settled).toBe(false);
    response();
    await pending;
    expect(settled).toBe(true);
    expect(post.mock.calls[0][1]).toBe("http://127.0.0.1:43001");
  });
  it("rejects an old same-URL result after renderer generation changes", async () => {
    const pending = bridge.request("step", {
      step: { kind: "click", selector },
    });
    const outcome = expect(pending).rejects.toThrow(/cancelled/);
    context = {
      ...context!,
      document: { ...context!.document, generation: 2 },
    };
    response();
    bridge.cancel();
    await outcome;
  });
  it("stores only bounded, ordered, value-free steps while explicitly armed", async () => {
    const onStep = vi.fn(),
      onStop = vi.fn();
    const start = bridge.request("recordStart", undefined, { onStep, onStop });
    response();
    await start;
    response({
      status: "step",
      stepNumber: 1,
      step: { kind: "fill", selector, value: "never-store" },
    });
    response({
      status: "step",
      stepNumber: 2,
      step: { kind: "fill", selector },
    });
    expect(onStep).not.toHaveBeenCalled();
    response({
      status: "step",
      stepNumber: 1,
      step: { kind: "fill", selector },
    });
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "fill", selector });
    response({
      status: "step",
      stepNumber: 1,
      step: { kind: "fill", selector },
    });
    expect(onStep).toHaveBeenCalledOnce();
    bridge.cancel();
    response({
      status: "step",
      stepNumber: 2,
      step: { kind: "fill", selector },
    });
    expect(onStep).toHaveBeenCalledOnce();
  });
  it.each(["failed", "send exception", "timeout"])(
    "disarms a recording after %s",
    async (failure) => {
      const onStep = vi.fn(),
        onStop = vi.fn();
      if (failure === "send exception")
        post.mockImplementationOnce(() => {
          throw new Error("closed");
        });
      const start = bridge.request("recordStart", undefined, {
        onStep,
        onStop,
      });
      const outcome = expect(start).rejects.toThrow();
      if (failure === "failed") response({ status: "failed" });
      if (failure === "timeout") await vi.advanceTimersByTimeAsync(15000);
      await outcome;
      response({
        status: "step",
        stepNumber: 1,
        step: { kind: "click", selector },
      });
      expect(onStop).toHaveBeenCalledOnce();
      expect(onStep).not.toHaveBeenCalled();
    },
  );
  it("can revoke recording and dark mode on its last addressed document after access is masked", async () => {
    const start = bridge.request("dark", { enabled: true });
    response();
    await start;
    const original = context;
    context = null;
    bridge.cancel(true);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "dark",
        payload: { enabled: false },
        documentToken: original!.document.token,
      }),
      "http://127.0.0.1:43001",
    );
    await expect(bridge.request("script", { code: "1" })).rejects.toThrow(
      /ready/,
    );
  });
});
