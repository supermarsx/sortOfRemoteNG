import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHttpRedirectReview } from "../../src/hooks/protocol/useHttpRedirectReview";
import {
  clearRuntimeConnectionsForTests,
  getRuntimeWebNavigation,
  registerRuntimeConnection,
  resolveRuntimeConnection,
  releaseRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";
import { OPEN_RUNTIME_CONNECTION_EVENT } from "../../src/hooks/session/useRuntimeConnectionLaunch";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  locked: false,
  route: undefined as string | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => h.invoke(...args),
}));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: () => {
    const check = () => {
      if (h.locked) throw new Error("locked");
    };
    check();
    return check;
  },
}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => h.route,
}));
const source: Connection = {
  id: "source",
  name: "Source",
  protocol: "https",
  hostname: "source.invalid",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
  basicAuthUsername: "private-user",
  basicAuthPassword: "private-password",
};
const session: ConnectionSession = {
  id: "s",
  connectionId: "source",
  name: "Source",
  protocol: "https",
  hostname: "source.invalid",
  status: "connected",
  startTime: new Date(),
  ownerDatabaseId: "db-a",
};
const receipt = {
  receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sessionId: "proxy",
  sourceOrigin: "https://source.invalid",
  destinationUrl: "https://target.invalid/admin/",
  navigationToken: "a".repeat(32),
  documentSequence: 1,
  removedQuery: true,
};
function fixture(enabled = true, synology = false) {
  let generation = 1,
    proxy = "proxy",
    navigationToken = "a".repeat(32);
  const stopSource = vi.fn(async () => {
    proxy = "";
  });
  const continueInTab = vi.fn();
  const options = {
    connection: source,
    session,
    sourceOrigin: receipt.sourceOrigin,
    accessKey: "db-a:1",
    route: undefined,
    enabled,
    redirectBudget: synology
      ? {
          profile: "synology" as const,
          assertCurrent: () => {
            if (h.locked) throw new Error("locked");
          },
        }
      : undefined,
    generation: () => generation,
    proxySessionId: () => proxy,
    navigationToken: () => navigationToken,
    stopSource,
    continueInTab,
  };
  const hook = renderHook((next = options) => useHttpRedirectReview(next), {
    initialProps: options,
  });
  return {
    ...hook,
    options,
    stopSource,
    continueInTab,
    navigate: () => {
      generation++;
    },
    changeToken: () => {
      navigationToken = "b".repeat(32);
    },
    changeProxy: () => {
      proxy = "replacement";
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.locked = false;
  h.route = undefined;
  clearRuntimeConnectionsForTests();
  h.invoke.mockResolvedValue(receipt);
});
describe("reviewed anonymous redirect handoff", () => {
  it("hands off the native one-use ticket only in volatile navigation and explicitly preserves it during stop", async () => {
    const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    registerRuntimeConnection(source, {
      initialUrl: receipt.sourceOrigin,
      redirectHops: 0,
      assertCurrent: () => {},
      synologyRedirectSource: {
        originalOrigin: receipt.sourceOrigin,
        enabled: true,
        databaseId: "db-a",
        assertOwner: () => {},
        assertIdentity: () => {},
      },
    });
    h.invoke.mockImplementation(async (command, input) =>
      command === "review_proxy_redirect"
        ? input.receiptId
          ? { ...receipt, continuationId: id }
          : receipt
        : undefined,
    );
    const view = fixture(true, true);
    await act(() => view.result.current.offer());
    await act(() => view.result.current.accept("current"));
    const target = view.continueInTab.mock.calls[0][0] as Connection;
    expect(view.stopSource).toHaveBeenCalledExactlyOnceWith("proxy", id);
    expect(JSON.stringify(target)).not.toContain(id);
    expect(getRuntimeWebNavigation(target.id)?.nativeContinuation?.id).toBe(id);
    expect(getRuntimeWebNavigation(target.id)?.initialUrl).toBe(
      receipt.destinationUrl,
    );
    releaseRuntimeConnection(target.id);
    expect(h.invoke).toHaveBeenLastCalledWith("cancel_proxy_continuation", {
      continuationId: id,
    });
  });
  it("opens an anonymous tab without continuity and cancels the unused native ticket", async () => {
    const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    registerRuntimeConnection(source, {
      initialUrl: receipt.sourceOrigin,
      redirectHops: 0,
      assertCurrent: () => {},
      synologyRedirectSource: {
        originalOrigin: receipt.sourceOrigin,
        enabled: true,
        databaseId: "db-a",
        assertOwner: () => {},
        assertIdentity: () => {},
      },
    });
    h.invoke.mockImplementation(async (command, input) =>
      command === "review_proxy_redirect"
        ? input.receiptId
          ? { ...receipt, continuationId: id }
          : receipt
        : undefined,
    );
    const view = fixture(true, true);
    const launched = vi.fn();
    window.addEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launched);
    try {
      await act(() => view.result.current.offer());
      await act(() => view.result.current.accept("anonymous"));
      expect(view.stopSource).toHaveBeenCalledExactlyOnceWith("proxy");
      expect(view.continueInTab).not.toHaveBeenCalled();
      expect(launched).toHaveBeenCalledOnce();
      const target = (
        launched.mock.calls[0][0] as CustomEvent<{ connection: Connection }>
      ).detail.connection;
      expect(
        getRuntimeWebNavigation(target.id)?.nativeContinuation,
      ).toBeUndefined();
      expect(JSON.stringify(target)).not.toContain(id);
      expect(target.basicAuthUsername).toBeUndefined();
      expect(target.basicAuthPassword).toBeUndefined();
      expect(
        h.invoke.mock.calls.filter(
          ([command]) => command === "cancel_proxy_continuation",
        ),
      ).toEqual([["cancel_proxy_continuation", { continuationId: id }]]);
    } finally {
      window.removeEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launched);
      view.unmount();
    }
  });
  it.each(["owner", "stop"])(
    "cancels a consumed ticket when %s fails without a destination",
    async (failure) => {
      const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      registerRuntimeConnection(source, {
        initialUrl: receipt.sourceOrigin,
        redirectHops: 0,
        assertCurrent: () => {},
        synologyRedirectSource: {
          originalOrigin: receipt.sourceOrigin,
          enabled: true,
          databaseId: "db-a",
          assertOwner: () => {},
          assertIdentity: () => {},
        },
      });
      h.invoke.mockImplementation(async (command, input) => {
        if (command !== "review_proxy_redirect") return;
        if (!input.receiptId) return receipt;
        if (failure === "owner") h.locked = true;
        return { ...receipt, continuationId: id };
      });
      const view = fixture(true, true);
      if (failure === "stop")
        view.stopSource.mockRejectedValue(new Error("stop failed"));
      await act(() => view.result.current.offer());
      await act(() => view.result.current.accept("current"));
      expect(view.continueInTab).not.toHaveBeenCalled();
      expect(h.invoke).toHaveBeenLastCalledWith("cancel_proxy_continuation", {
        continuationId: id,
      });
    },
  );
  it("cancels a late consumed ticket after unmount rather than retaining private state until expiry", async () => {
    const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    let resolveConsume!: (value: unknown) => void;
    h.invoke.mockImplementation(async (command, input) =>
      command === "review_proxy_redirect"
        ? input.receiptId
          ? new Promise((resolve) => {
              resolveConsume = resolve;
            })
          : receipt
        : undefined,
    );
    const view = fixture();
    await act(() => view.result.current.offer());
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.accept("current");
    });
    view.unmount();
    await act(async () => {
      resolveConsume({ ...receipt, continuationId: id });
      await pending;
    });
    expect(view.stopSource).not.toHaveBeenCalled();
    expect(view.continueInTab).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenLastCalledWith("cancel_proxy_continuation", {
      continuationId: id,
    });
  });
  it.each(["current", "anonymous"] as const)(
    "retains the twentieth Synology handoff through source cleanup for %s launch",
    async (destination) => {
      const provenance = {
        originalOrigin: "https://example.quickconnect.to",
        enabled: false,
        databaseId: "db-a",
        assertOwner: () => {},
        assertIdentity: () => {},
      };
      registerRuntimeConnection(source, {
        initialUrl: receipt.sourceOrigin,
        redirectHops: 19,
        assertCurrent: () => {},
        synologyRedirectSource: provenance,
      });
      const view = fixture(true, true);
      view.stopSource.mockImplementation(async () => {
        releaseRuntimeConnection(source.id);
      });
      const launched = vi.fn();
      window.addEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launched);
      try {
        expect(view.result.current.maxRedirectHops).toBe(20);
        expect(view.result.current.redirectStep).toBe(20);
        await act(() => view.result.current.offer());
        await act(() => view.result.current.accept(destination));
        const target =
          destination === "current"
            ? (view.continueInTab.mock.calls[0][0] as Connection)
            : (
                launched.mock.calls[0][0] as CustomEvent<{
                  connection: Connection;
                }>
              ).detail.connection;
        expect(getRuntimeWebNavigation(target.id)).toMatchObject({
          redirectHops: 20,
          synologyRedirectSource: provenance,
        });
        expect(target.basicAuthPassword).toBeUndefined();
        expect(view.stopSource).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launched);
      }
    },
  );
  it.each([20, 21, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses Synology exhausted or malformed depth %s without consumption",
    async (depth) => {
      registerRuntimeConnection(source, {
        initialUrl: receipt.sourceOrigin,
        redirectHops: depth,
        assertCurrent: () => {},
      });
      const view = fixture(true, true);
      await act(() => view.result.current.offer());
      expect(view.result.current.review).toBeNull();
      expect(view.result.current.error).toContain("Twenty redirect");
      await act(() => view.result.current.accept("current"));
      expect(h.invoke).toHaveBeenCalledTimes(1);
      expect(view.stopSource).not.toHaveBeenCalled();
    },
  );
  it("rejects a changed counter between review and consumption", async () => {
    registerRuntimeConnection(source, {
      initialUrl: receipt.sourceOrigin,
      redirectHops: 19,
      assertCurrent: () => {},
    });
    const view = fixture(true, true);
    await act(() => view.result.current.offer());
    registerRuntimeConnection(source, {
      initialUrl: receipt.sourceOrigin,
      redirectHops: 20,
      assertCurrent: () => {},
    });
    await act(() => view.result.current.accept("current"));
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("rejects registry replacement while native receipt consumption is pending", async () => {
    registerRuntimeConnection(source, {
      initialUrl: receipt.sourceOrigin,
      redirectHops: 19,
      assertCurrent: () => {},
    });
    const view = fixture(true, true);
    await act(() => view.result.current.offer());
    let resolve!: (value: typeof receipt) => void;
    h.invoke.mockImplementationOnce(
      () =>
        new Promise<typeof receipt>((done) => {
          resolve = done;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.accept("current");
    });
    registerRuntimeConnection(source, {
      initialUrl: receipt.sourceOrigin,
      redirectHops: 20,
      assertCurrent: () => {},
    });
    await act(async () => {
      resolve(receipt);
      await pending;
    });
    expect(view.stopSource).not.toHaveBeenCalled();
    expect(view.continueInTab).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain("expired or access changed");
  });
  it("carries only an explicitly enabled login in the current tab and refuses it for anonymous mode", async () => {
    const view = fixture();
    view.rerender({
      ...view.options,
      connection: {
        ...source,
        httpRedirectAuthentication: {
          version: 1,
          mode: "saved-login",
          allowInsecureHttp: false,
        },
      },
    });
    await act(() => view.result.current.offer());
    await act(() => view.result.current.accept("anonymous", true));
    expect(view.stopSource).not.toHaveBeenCalled();
    await act(() => view.result.current.accept("current", true));
    expect(view.continueInTab).toHaveBeenCalledOnce();
    const target = view.continueInTab.mock.calls[0][0] as Connection;
    expect(target.basicAuthPassword).toBe("private-password");
    expect(target.httpAutoLogin).toBe(false);
    expect(target.httpsTrustPolicy).toBe("inherit");
  });
  it("replaces the current tab with a registered credential-free target after verified stop", async () => {
    const launch = vi.fn();
    window.addEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
    const view = fixture();
    await act(() => view.result.current.offer());
    await act(() => view.result.current.accept("current"));
    expect(view.stopSource).toHaveBeenCalledWith("proxy");
    expect(view.continueInTab).toHaveBeenCalledOnce();
    expect(view.stopSource.mock.invocationCallOrder[0]).toBeLessThan(
      view.continueInTab.mock.invocationCallOrder[0],
    );
    const target = view.continueInTab.mock.calls[0][0] as Connection;
    expect(target.id).not.toBe(source.id);
    expect(resolveRuntimeConnection([], target.id)).toBe(target);
    expect(getRuntimeWebNavigation(target.id)?.initialUrl).toBe(
      receipt.destinationUrl,
    );
    expect(target).toMatchObject({
      httpAutoLogin: false,
      httpVerifySsl: true,
      httpsTrustPolicy: "inherit",
    });
    expect(JSON.stringify(target)).not.toContain("private-");
    expect(source.basicAuthPassword).toBe("private-password");
    expect(launch).not.toHaveBeenCalled();
    window.removeEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
  });
  it("does not replace a tab after its database locks", async () => {
    const view = fixture();
    await act(() => view.result.current.offer());
    h.locked = true;
    await act(() => view.result.current.accept("current"));
    expect(view.stopSource).not.toHaveBeenCalled();
    expect(view.continueInTab).not.toHaveBeenCalled();
  });
  it("does not stop or launch after downgrade consent changes during receipt consumption", async () => {
    const launch = vi.fn();
    window.addEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
    const downgraded = {
      ...receipt,
      destinationUrl: "http://target.invalid/admin/",
    };
    h.invoke.mockResolvedValue(downgraded);
    const view = fixture();
    const policy = {
      ...DEFAULT_HTTP_PROXY_POLICY,
      allowCrossOriginRedirects: true,
      allowHttpDowngradeRedirects: true,
    };
    view.rerender({
      ...view.options,
      connection: { ...source, httpProxyPolicy: policy },
    });
    await act(() => view.result.current.offer());
    let finish!: (value: unknown) => void;
    h.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.accept();
    });
    view.rerender({
      ...view.options,
      connection: {
        ...source,
        httpProxyPolicy: { ...policy, allowHttpDowngradeRedirects: false },
      },
    });
    await act(async () => {
      finish(downgraded);
      await pending;
    });
    expect(view.stopSource).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    window.removeEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
  });
  it("only offers a downgrade under captured explicit policy and opens it anonymously after review", async () => {
    const launch = vi.fn();
    window.addEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
    h.invoke.mockResolvedValue({
      ...receipt,
      destinationUrl: "http://target.invalid/admin/",
    });
    const view = fixture();
    await act(() => view.result.current.offer());
    expect(view.result.current.review).toBeNull();
    const policy = {
      ...DEFAULT_HTTP_PROXY_POLICY,
      allowCrossOriginRedirects: true,
      allowHttpDowngradeRedirects: true,
    };
    view.rerender({
      ...view.options,
      connection: {
        ...source,
        httpProxyPolicy: { ...policy, httpsOnly: true },
      },
    });
    await act(() => view.result.current.offer());
    expect(view.result.current.review).toBeNull();
    view.rerender({
      ...view.options,
      connection: { ...source, httpProxyPolicy: policy },
    });
    await act(() => view.result.current.offer());
    expect(view.result.current.review?.destinationUrl).toBe(
      "http://target.invalid/admin/",
    );
    expect(launch).not.toHaveBeenCalled();
    await act(() => view.result.current.accept());
    const connection = (launch.mock.calls[0][0] as CustomEvent).detail
      .connection;
    expect(connection).toMatchObject({
      protocol: "http",
      httpAutoLogin: false,
      httpProxyPolicy: {
        httpsOnly: false,
        allowCrossOriginRedirects: true,
        allowHttpDowngradeRedirects: true,
      },
    });
    expect(JSON.stringify(connection)).not.toContain("private-");
    window.removeEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
  });
  it("does nothing by default and ignores forged/mismatched native receipts", async () => {
    const disabled = fixture(false);
    await act(() => disabled.result.current.offer());
    expect(h.invoke).not.toHaveBeenCalled();
    disabled.unmount();
    const view = fixture();
    h.invoke.mockResolvedValue({ ...receipt, sessionId: "foreign" });
    await act(() => view.result.current.offer());
    expect(view.result.current.review).toBeNull();
    h.invoke.mockResolvedValue({ ...receipt, navigationToken: "c".repeat(32) });
    await act(() => view.result.current.offer());
    expect(view.result.current.review).toBeNull();
  });
  it("cancel neither consumes nor stops the source, and the same receipt cannot re-prompt", async () => {
    const view = fixture();
    await act(() => view.result.current.offer());
    expect(view.result.current.review).toEqual(receipt);
    act(() => view.result.current.cancel());
    await act(() => view.result.current.offer());
    expect(view.result.current.review).toBeNull();
    expect(view.stopSource).not.toHaveBeenCalled();
    expect(
      h.invoke.mock.calls.every((call) => call[1].receiptId === null),
    ).toBe(true);
    await act(() => view.result.current.offer(true));
    expect(view.result.current.review).toEqual(receipt);
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("preserves an in-flight receipt across connection bookkeeping but still cancels authentication changes", async () => {
    const view = fixture();
    let finish!: (value: unknown) => void;
    h.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.offer();
    });
    view.rerender({
      ...view.options,
      connection: {
        ...source,
        lastConnected: "2026-09-10T23:00:00Z",
        connectionCount: 2,
      },
    });
    await act(async () => {
      finish(receipt);
      await pending;
    });
    expect(view.result.current.review).toEqual(receipt);
    expect(view.result.current.redirectStep).toBe(1);
    expect(view.result.current.maxRedirectHops).toBe(5);
    view.rerender({
      ...view.options,
      connection: { ...source, basicAuthPassword: "changed" },
    });
    expect(view.result.current.review).toBeNull();
    await act(() => view.result.current.accept("current"));
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("keeps ordinary load discovery failures silent but explains explicit unavailable review", async () => {
    const view = fixture();
    h.invoke.mockRejectedValue(new Error("unavailable"));
    await act(() => view.result.current.offer(false, true));
    expect(view.result.current.error).toBe("");
    expect(view.result.current.review).toBeNull();
    await act(() => view.result.current.offer(true));
    expect(view.result.current.error).toContain(
      "Redirect review is unavailable",
    );
  });
  it("deduplicates discovery with a simultaneous confirmed redirect and preserves its error feedback", async () => {
    const view = fixture();
    let reject!: (error: Error) => void;
    h.invoke.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.offer(false, true);
    });
    await act(() => view.result.current.offer());
    expect(h.invoke).toHaveBeenCalledOnce();
    await act(async () => {
      reject(new Error("unavailable"));
      await pending;
    });
    expect(view.result.current.error).toContain(
      "Redirect review is unavailable",
    );
  });
  it("requires explicit acceptance, consumes once, closes source, then launches anonymous destination with an independent owner guard", async () => {
    const launch = vi.fn();
    window.addEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
    const view = fixture();
    await act(() => view.result.current.offer());
    expect(launch).not.toHaveBeenCalled();
    await act(async () => {
      const first = view.result.current.accept();
      const duplicate = view.result.current.accept();
      await Promise.all([first, duplicate]);
    });
    expect(
      h.invoke.mock.calls.filter((call) => call[1].receiptId !== null),
    ).toHaveLength(1);
    expect(view.stopSource).toHaveBeenCalledWith("proxy");
    expect(launch).toHaveBeenCalledOnce();
    const connection = (launch.mock.calls[0][0] as CustomEvent).detail
      .connection as Connection;
    expect(JSON.stringify(connection)).not.toContain("private-");
    expect(resolveRuntimeConnection([], connection.id)).toBe(connection);
    const navigation = getRuntimeWebNavigation(connection.id)!;
    expect(navigation.initialUrl).toBe(receipt.destinationUrl);
    expect(navigation.redirectHops).toBe(1);
    view.unmount();
    expect(() => navigation.assertCurrent()).not.toThrow();
    h.locked = true;
    expect(() => navigation.assertCurrent()).toThrow();
    window.removeEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
  });
  it.each(["lock", "navigation", "token", "proxy", "route"])(
    "rejects stale %s changes while native receipt consumption is pending",
    async (change) => {
      const launch = vi.fn();
      window.addEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
      const view = fixture();
      await act(() => view.result.current.offer());
      let resolve!: (value: unknown) => void;
      h.invoke.mockImplementationOnce(
        () =>
          new Promise((finish) => {
            resolve = finish;
          }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = view.result.current.accept();
      });
      if (change === "lock") h.locked = true;
      else if (change === "navigation") view.navigate();
      else if (change === "token") view.changeToken();
      else if (change === "proxy") view.changeProxy();
      else h.route = "http://changed.invalid:8080";
      await act(async () => {
        resolve(receipt);
        await pending;
      });
      expect(launch).not.toHaveBeenCalled();
      expect(view.stopSource).not.toHaveBeenCalled();
      window.removeEventListener(OPEN_RUNTIME_CONNECTION_EVENT, launch);
    },
  );
  it("fails closed when settings change, source stop fails, or five handoffs were used", async () => {
    const view = fixture();
    await act(() => view.result.current.offer());
    view.rerender({ ...view.options, enabled: false });
    expect(view.result.current.review).toBeNull();
    view.unmount();
    const stopped = fixture();
    await act(() => stopped.result.current.offer());
    stopped.stopSource.mockRejectedValueOnce(new Error("unavailable"));
    await act(() => stopped.result.current.accept());
    expect(stopped.result.current.error).toContain("No destination");
    stopped.unmount();
    registerRuntimeConnection(source, {
      initialUrl: "https://source.invalid/",
      redirectHops: 5,
      assertCurrent: () => {},
    });
    const limited = fixture();
    await act(() => limited.result.current.offer());
    expect(limited.result.current.review).toBeNull();
    expect(limited.result.current.error).toContain("Five redirect");
  });
});
