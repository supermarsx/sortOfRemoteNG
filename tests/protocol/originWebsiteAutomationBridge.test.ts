import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OriginWebsiteAutomationBridge,
  nativeAutomationDocument,
  type OriginAutomationContext,
  type NativeAutomationReply,
  type OriginAutomationTransport,
} from "../../src/utils/recording/originWebsiteAutomationBridge";
const selector = "html > body > input:nth-of-type(1)";
describe("canonical native automation command bridge", () => {
  let context: OriginAutomationContext | null;
  let request: ReturnType<typeof vi.fn<OriginAutomationTransport["request"]>>;
  let bridge: OriginWebsiteAutomationBridge;
  beforeEach(() => {
    vi.useFakeTimers();
    context = {
      identity: {
        ownerDatabaseId: "db",
        connectionId: "connection",
        sessionId: "tab",
        attemptId: "attempt",
      },
      documentToken: "native-token",
      origin: "https://example.test",
      scriptInjectionEnabled: true,
      interactionMacrosEnabled: true,
    };
    request = vi.fn(async ({ operation }) =>
      operation.action === "document"
        ? {
            status: "document",
            documentToken: "native-token",
            origin: "https://example.test",
          }
        : operation.action === "recordStop"
          ? {
              status: "recordingStopped",
              requestId: operation.requestId,
              steps: [{ kind: "fill", selector }],
              truncated: false,
            }
          : { status: "completed", requestId: operation.requestId },
    );
    bridge = new OriginWebsiteAutomationBridge(() => context, { request });
  });
  afterEach(() => {
    bridge.dispose();
    vi.useRealTimers();
  });
  it("matches the actual host envelope and treats script ACK conservatively", async () => {
    expect(await bridge.request("script", { code: "document.title" })).toBe(
      "dispatched",
    );
    expect(request.mock.calls[0][0]).toEqual({
      identity: context!.identity,
      operation: {
        action: "script",
        documentToken: "native-token",
        origin: "https://example.test",
        requestId: expect.any(String),
        code: "document.title",
      },
    });
  });
  it.each([
    "http://example.test",
    "https://example.test/path",
    "https://user:pass@example.test",
    "not-an-origin",
  ])("rejects noncanonical or non-HTTPS origin %s", (origin) => {
    expect(() =>
      nativeAutomationDocument(context!.identity, {
        status: "document",
        documentToken: "token",
        origin,
      }),
    ).toThrow();
  });
  it("requires a native bounded token and complete identity", () => {
    for (const documentToken of ["", "x".repeat(81), "has space"])
      expect(() =>
        nativeAutomationDocument(context!.identity, {
          status: "document",
          documentToken,
          origin: context!.origin,
        }),
      ).toThrow();
  });
  it("does not reinterpret an obsolete documentId as a native documentToken", () => {
    expect(() =>
      nativeAutomationDocument(context!.identity, {
        status: "document",
        documentId: "legacy-token",
        origin: context!.origin,
      } as unknown as NativeAutomationReply),
    ).toThrow();
  });
  it("honors independent script/macro opt-outs without invoking native", async () => {
    context!.scriptInjectionEnabled = false;
    await expect(
      bridge.request("script", { code: "document.title" }),
    ).rejects.toThrow();
    context!.interactionMacrosEnabled = false;
    await expect(
      bridge.request("recordStart", undefined, {
        onStep: vi.fn(),
        onStop: vi.fn(),
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["documentToken", "origin", "attemptId", "ownerDatabaseId"])(
    "rejects stale %s at acknowledgement",
    async (field) => {
      let resolve!: (reply: NativeAutomationReply) => void;
      request.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const pending = bridge.request("script", { code: "document.title" });
      const rejection = expect(pending).rejects.toThrow();
      await Promise.resolve();
      const operation = request.mock.calls[0][0].operation;
      if (field === "documentToken" || field === "origin")
        context = { ...context!, [field]: "replacement" };
      else
        context = {
          ...context!,
          identity: { ...context!.identity, [field]: "replacement" },
        };
      resolve({
        status: "completed",
        requestId: "requestId" in operation ? operation.requestId : "",
      });
      await rejection;
    },
  );
  it("returns steps only after recordStop and accepts a value-free batch", async () => {
    const onStep = vi.fn(),
      onStop = vi.fn();
    await bridge.request("recordStart", undefined, { onStep, onStop });
    expect(onStep).not.toHaveBeenCalled();
    await bridge.request("recordStop");
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "fill", selector });
    expect(onStop).toHaveBeenCalledOnce();
  });
  it.each(["value", "selector", "oversized", "truncated"])(
    "rejects the entire %s recording before admitting any steps",
    async (problem) => {
      const onStep = vi.fn();
      await bridge.request("recordStart", undefined, {
        onStep,
        onStop: vi.fn(),
      });
      request.mockImplementationOnce(
        async ({ operation }) =>
          ({
            status: "recordingStopped",
            requestId: "requestId" in operation ? operation.requestId : "",
            steps:
              problem === "oversized"
                ? Array.from({ length: 201 }, () => ({
                    kind: "fill",
                    selector,
                  }))
                : [
                    { kind: "fill", selector },
                    {
                      kind: "fill",
                      selector: problem === "selector" ? "#secret" : selector,
                      ...(problem === "value" ? { value: "never-save" } : {}),
                    },
                  ],
            truncated: problem === "truncated",
          }) as NativeAutomationReply,
      );
      await expect(bridge.request("recordStop")).rejects.toThrow();
      expect(onStep).not.toHaveBeenCalled();
    },
  );
  it("sends transient fill values only with the fenced step, not cleanup", async () => {
    await bridge.request("step", {
      step: { kind: "fill", selector },
      value: "one-use",
    });
    expect(request.mock.calls[0][0].operation).toMatchObject({
      action: "step",
      value: "one-use",
    });
    bridge.cancel();
    await Promise.resolve();
    await Promise.resolve();
    expect(request.mock.calls[1][0].operation).toEqual({
      action: "cancel",
      documentToken: "native-token",
      origin: "https://example.test",
      requestId: expect.any(String),
    });
  });
  it("bounds UTF-8 fill bytes, not just JavaScript character count", async () => {
    await expect(
      bridge.request("step", {
        step: { kind: "fill", selector },
        value: "é".repeat(2049),
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("does not surface arbitrary native errors or retry execution", async () => {
    request.mockRejectedValueOnce(new Error("private-cookie-secret"));
    await expect(
      bridge.request("script", { code: "document.title" }),
    ).rejects.toThrow("not confirmed");
    expect(
      request.mock.calls.filter(
        ([value]) => value.operation.action === "script",
      ),
    ).toHaveLength(1);
  });
  it("times out an unacknowledged command and prevents unconfirmed cancellation races", async () => {
    request.mockImplementationOnce(() => new Promise(() => {}));
    const pending = bridge.request("script", { code: "document.title" });
    const rejected = expect(pending).rejects.toThrow("not confirmed");
    await vi.advanceTimersByTimeAsync(16001);
    await rejected;
  });
  it("rejects unsupported credential, MFA, appearance and print actions", async () => {
    for (const action of [
      "credentialType",
      "totpSubmit",
      "dark",
      "print",
    ] as const)
      await expect(bridge.request(action, {})).rejects.toThrow("not supported");
    expect(request).not.toHaveBeenCalled();
  });
});
