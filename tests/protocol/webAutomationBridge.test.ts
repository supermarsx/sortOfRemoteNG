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
  const observeFocus = async () => {
    const watching = bridge.watchCredentialFocus();
    response({
      status: "credentialFocusState",
      focusRevision: 1,
      focusToken: "f".repeat(32),
    });
    response();
    await watching;
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
  it("captures a value-free focused target and sends secrets only to that exact document origin", async () => {
    await observeFocus();
    const capture = bridge.captureCredentialTarget("tab");
    expect(post.mock.calls[1][0].action).toBe("credentialFocus");
    expect(post.mock.calls[1][0].payload).not.toHaveProperty("value");
    expect(post.mock.calls[1][0].payload).toMatchObject({
      focusRevision: 1,
      focusToken: "f".repeat(32),
    });
    response();
    const target = await capture;
    const check = vi.fn();
    const typing = target.type("päss!", check);
    expect(check).toHaveBeenCalledOnce();
    expect(post.mock.calls[2][0]).toMatchObject({
      action: "credentialType",
      payload: { value: "päss!" },
    });
    expect(post.mock.calls[2][1]).toBe("http://127.0.0.1:43001");
    response();
    await typing;
  });
  it("keeps the same focus observation and captured lease when readiness effects repeat", async () => {
    await observeFocus();
    const capturing = bridge.captureCredentialTarget("tab");
    response();
    const target = await capturing;
    await bridge.watchCredentialFocus();
    expect(
      post.mock.calls.filter(
        ([message]) => message.action === "credentialWatch",
      ),
    ).toHaveLength(1);
    expect(() => target.assertCurrent()).not.toThrow();
    const typing = target.type("secret", () => {});
    response();
    await typing;
  });
  it("shares an in-flight watch without replacing its correlation", async () => {
    const first = bridge.watchCredentialFocus();
    const second = bridge.watchCredentialFocus();
    expect(post.mock.calls).toHaveLength(1);
    response({
      status: "credentialFocusState",
      focusRevision: 1,
      focusToken: "f".repeat(32),
    });
    response();
    await Promise.all([first, second]);
    const capturing = bridge.captureCredentialTarget("tab");
    response();
    await expect(capturing).resolves.toBeDefined();
  });
  it("retries failed watches and fences replacement documents", async () => {
    const first = bridge.watchCredentialFocus();
    response({ status: "failed" });
    await expect(first).rejects.toThrow();
    await observeFocus();
    context!.document.generation++;
    const replacement = bridge.watchCredentialFocus();
    expect(
      post.mock.calls.filter(
        ([message]) => message.action === "credentialWatch",
      ),
    ).toHaveLength(3);
    response();
    await replacement;
    await expect(bridge.captureCredentialTarget("tab")).rejects.toThrow();
  });
  it.each([
    "frame",
    "session",
    "token",
    "sequence",
    "generation",
    "navigation",
    "url",
    "cancel",
    "dispose",
  ])("rejects credential dispatch after %s changes", async (change) => {
    await observeFocus();
    const capture = bridge.captureCredentialTarget("tab");
    response();
    const target = await capture;
    if (change === "frame") context = { ...context!, frame: window };
    if (change === "session") context!.document.sessionId = "other";
    if (change === "token") context!.document.token = "other";
    if (change === "sequence") context!.document.sequence++;
    if (change === "generation") context!.document.generation++;
    if (change === "navigation") context!.document.navigationToken = "other";
    if (change === "url") context!.document.url += "/next";
    if (change === "cancel") bridge.cancel();
    if (change === "dispose") target.dispose();
    await expect(target.type("secret", () => {})).rejects.toThrow();
    expect(
      post.mock.calls.some(([message]) => message.action === "credentialType"),
    ).toBe(false);
  });
  it("refuses capture without a previously authenticated focus report", async () => {
    await expect(bridge.captureCredentialTarget("tab")).rejects.toThrow();
    const watching = bridge.watchCredentialFocus();
    response(
      {
        status: "credentialFocusState",
        focusRevision: 1,
        focusToken: "f".repeat(32),
      },
      { source: window },
    );
    response(
      {
        status: "credentialFocusState",
        focusRevision: 1,
        focusToken: "f".repeat(32),
      },
      { origin: "https://other.test" },
    );
    response();
    await watching;
    await expect(bridge.captureCredentialTarget("tab")).rejects.toThrow();
  });
  it("revokes a captured target when a later authenticated focus revision arrives", async () => {
    await observeFocus();
    const watchRequest = post.mock.calls[0][0];
    const capturing = bridge.captureCredentialTarget("tab");
    response();
    const target = await capturing;
    bridge.handleMessage({
      source: context!.frame,
      origin: new URL(context!.document.url).origin,
      data: {
        ...watchRequest,
        type: "proxy_web_automation",
        status: "credentialFocusState",
        focusRevision: 2,
        focusToken: "e".repeat(32),
      },
    } as MessageEvent);
    await expect(target.type("secret", () => {})).rejects.toThrow();
    expect(
      post.mock.calls.some(([message]) => message.action === "credentialType"),
    ).toBe(false);
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
  it("drains matching steps queued before Stop acknowledgement and rejects steps after its end marker", async () => {
    const onStep = vi.fn(),
      onStop = vi.fn();
    const start = bridge.request("recordStart", undefined, { onStep, onStop });
    const recordingRequest = post.mock.calls[0][0];
    response();
    await start;
    const stop = bridge.request("recordStop");
    response({
      ...recordingRequest,
      type: "proxy_web_automation",
      status: "step",
      stepNumber: 1,
      step: { kind: "fill", selector },
    });
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "fill", selector });
    expect(onStop).not.toHaveBeenCalled();
    response();
    await stop;
    expect(onStop).toHaveBeenCalledOnce();
    response({
      ...recordingRequest,
      type: "proxy_web_automation",
      status: "step",
      stepNumber: 2,
      step: { kind: "click", selector },
    });
    expect(onStep).toHaveBeenCalledOnce();
  });
  it.each(["failed", "send exception", "timeout", "cancel", "limit"])(
    "closes the draining recorder on Stop %s without accepting later steps",
    async (failure) => {
      const onStep = vi.fn(),
        onStop = vi.fn();
      const start = bridge.request("recordStart", undefined, {
        onStep,
        onStop,
      });
      const recordingRequest = post.mock.calls[0][0];
      response();
      await start;
      if (failure === "send exception")
        post.mockImplementationOnce(() => {
          throw new Error("closed");
        });
      const stop = bridge.request("recordStop");
      const outcome =
        failure === "limit" ? stop : expect(stop).rejects.toThrow();
      if (failure === "failed") response({ status: "failed" });
      if (failure === "timeout") await vi.advanceTimersByTimeAsync(15000);
      if (failure === "cancel") bridge.cancel();
      if (failure === "limit") {
        response({
          ...recordingRequest,
          type: "proxy_web_automation",
          status: "limit",
        });
        response();
      }
      await outcome;
      response({
        ...recordingRequest,
        type: "proxy_web_automation",
        status: "step",
        stepNumber: 1,
        step: { kind: "click", selector },
      });
      expect(onStop).toHaveBeenCalledOnce();
      expect(onStep).not.toHaveBeenCalled();
    },
  );
  it("does not let an old Stop acknowledgement disarm a replacement recorder", async () => {
    const oldStop = vi.fn(),
      nextStep = vi.fn(),
      nextStop = vi.fn();
    const start = bridge.request("recordStart", undefined, {
      onStep: vi.fn(),
      onStop: oldStop,
    });
    const oldRequest = post.mock.calls[0][0];
    response();
    await start;
    const stop = bridge.request("recordStop");
    const stopRequest = post.mock.calls[1][0];
    response({ ...oldRequest, type: "proxy_web_automation", status: "limit" });
    const next = bridge.request("recordStart", undefined, {
      onStep: nextStep,
      onStop: nextStop,
    });
    const nextRequest = post.mock.calls[2][0];
    response();
    await next;
    response({ ...stopRequest, type: "proxy_web_automation", status: "ok" });
    await stop;
    response({
      ...nextRequest,
      type: "proxy_web_automation",
      status: "step",
      stepNumber: 1,
      step: { kind: "click", selector },
    });
    expect(oldStop).toHaveBeenCalledOnce();
    expect(nextStop).not.toHaveBeenCalled();
    expect(nextStep).toHaveBeenCalledOnce();
  });
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
  it.each(["engine", "cssOnly"])(
    "passes the closed dark outcome %s back to the caller",
    async (outcome) => {
      const pending = bridge.request("dark", { enabled: true });
      response({ darkOutcome: outcome });
      expect(await pending).toBe(outcome);
    },
  );
  it.each([
    { darkOutcome: "engine ran" },
    { darkOutcome: "<b>themed</b>" },
    { darkOutcome: 7 },
    { darkOutcome: { kind: "engine" } },
    {},
  ])(
    "drops anything outside that set, so no page wording reaches the app: %j",
    async (overrides) => {
      const pending = bridge.request("dark", { enabled: true });
      response(overrides);
      expect(await pending).toBeUndefined();
    },
  );
  it("never returns an outcome for an action that is not dark", async () => {
    const pending = bridge.request("script", { code: "1" });
    response({ darkOutcome: "engine" });
    expect(await pending).toBeUndefined();
  });
  it("delivers print to the accepted child document instead of reading its cross-origin Window", async () => {
    const pending = bridge.request("print");
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "print",
        documentToken: context!.document.token,
      }),
      "http://127.0.0.1:43001",
    );
    response();
    await expect(pending).resolves.toBeUndefined();
  });
});
