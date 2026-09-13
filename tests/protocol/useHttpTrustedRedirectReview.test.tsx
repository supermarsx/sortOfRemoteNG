import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HTTP_REDIRECT_ATTEMPT_TIMEOUT_MS,
  useHttpRedirectReview,
} from "../../src/hooks/protocol/useHttpRedirectReview";
import {
  OPEN_RUNTIME_CONNECTION_EVENT,
  useRuntimeConnectionLaunch,
} from "../../src/hooks/session/useRuntimeConnectionLaunch";
import type { HttpRedirectTrustInspection } from "../../src/hooks/protocol/useHttpRedirectTrust";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import {
  clearRuntimeConnectionsForTests,
  getRuntimeWebNavigation,
  registerRuntimeConnection,
  resolveRuntimeConnection,
  type TrustedRedirectSource,
} from "../../src/utils/session/runtimeConnectionRegistry";

const h = vi.hoisted(() => ({ invoke: vi.fn(), locked: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => h.invoke(...args),
}));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: () => () => {
    if (h.locked) throw new Error("locked");
  },
}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => undefined,
}));
const source: Connection = {
  id: "saved-source",
  name: "NAS",
  protocol: "https",
  hostname: "source.invalid",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
  basicAuthUsername: "user",
  basicAuthPassword: "never-forward-this",
  httpProxyPolicy: {
    ...DEFAULT_HTTP_PROXY_POLICY,
    allowCrossOriginRedirects: true,
    allowHttpDowngradeRedirects: true,
  },
};
const session: ConnectionSession = {
  id: "tab",
  connectionId: source.id,
  ownerDatabaseId: "db-a",
  name: "NAS",
  protocol: "https",
  hostname: source.hostname,
  status: "connected",
  startTime: new Date(),
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
type Options = Parameters<typeof useHttpRedirectReview>[0];
function fixture(
  config: {
    trusted?: boolean;
    connection?: Connection;
  } = {},
) {
  let proxy = "proxy";
  let revoked = false;
  const provenance: TrustedRedirectSource = {
    databaseId: "db-a",
    savedConnectionId: source.id,
    originalOrigin: receipt.sourceOrigin,
    assertOwner: () => {
      if (h.locked) throw new Error("locked");
    },
    assertIdentity: vi.fn(),
  };
  const inspect = vi.fn(
    async (
      _review: unknown,
      guard: () => void,
    ): Promise<HttpRedirectTrustInspection> => ({
      trusted: config.trusted ?? true,
      provenance,
      assertCurrent: () => {
        guard();
        if (revoked) throw new Error("revoked");
      },
      assertLaunchCurrent: () => {
        if (h.locked || revoked) throw new Error("revoked");
      },
    }),
  );
  const remember = vi.fn(async (_review: unknown, guard: () => void) => {
    guard();
  });
  const stopSource = vi.fn(async () => {
    proxy = "";
  });
  const continueInTab = vi.fn();
  const options: Options = {
    connection: config.connection ?? source,
    session,
    sourceOrigin: receipt.sourceOrigin,
    accessKey: "db-a:1",
    route: undefined,
    enabled: true,
    generation: () => 1,
    proxySessionId: () => proxy,
    navigationToken: () => receipt.navigationToken,
    stopSource,
    continueInTab,
    trust: {
      defaults: undefined,
      defaultSource: undefined,
      canRemember: true,
      unavailableReason: "",
      revision: "1",
      inspect,
      remember,
    },
  };
  const hook = renderHook((next: Options) => useHttpRedirectReview(next), {
    initialProps: options,
  });
  return {
    ...hook,
    options,
    inspect,
    remember,
    stopSource,
    continueInTab,
    provenance,
    revoke: () => {
      revoked = true;
    },
  };
}
beforeEach(() => {
  h.locked = false;
  h.invoke.mockReset().mockResolvedValue(receipt);
  clearRuntimeConnectionsForTests();
});

describe("persisted trusted redirect continuation", () => {
  it("rejects an overdue stop completion even before the suspended timer can fire", async () => {
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const view = fixture();
      view.stopSource.mockImplementation(async () => {
        clock += HTTP_REDIRECT_ATTEMPT_TIMEOUT_MS + 1;
      });
      await act(() => view.result.current.offer());
      expect(view.stopSource).toHaveBeenCalledOnce();
      expect(view.continueInTab).not.toHaveBeenCalled();
      expect(view.result.current.continuingAutomatically).toBe(false);
      expect(view.result.current.error).toContain("No destination was opened");
      view.unmount();
    } finally {
      now.mockRestore();
    }
  });
  it.each(["inspect", "consume"] as const)(
    "expires a stalled automatic %s without accepting its late completion",
    async (stage) => {
      vi.useFakeTimers();
      try {
        const view = fixture();
        let finish: (() => void) | undefined;
        if (stage === "inspect") {
          const inspect = view.inspect.getMockImplementation()!;
          view.inspect
            .mockImplementationOnce(inspect)
            .mockImplementationOnce(async (...args) => {
              await new Promise<void>((resolve) => {
                finish = resolve;
              });
              return inspect(...args);
            });
        } else {
          h.invoke.mockImplementation(async (command, args) => {
            if (command === "cancel_proxy_continuation") return;
            if (args.receiptId)
              await new Promise<void>((resolve) => {
                finish = resolve;
              });
            return args.receiptId
              ? {
                  ...receipt,
                  continuationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                }
              : receipt;
          });
        }
        await act(() => view.result.current.offer());
        expect(view.result.current.continuingAutomatically).toBe(true);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(HTTP_REDIRECT_ATTEMPT_TIMEOUT_MS);
        });
        expect(view.result.current.continuingAutomatically).toBe(false);
        expect(view.result.current.busy).toBe(false);
        expect(view.result.current.error).toContain(
          "No destination was opened",
        );
        expect(view.result.current.review).toEqual(receipt);
        await act(async () => {
          finish!();
        });
        expect(view.stopSource).not.toHaveBeenCalled();
        expect(view.continueInTab).not.toHaveBeenCalled();
        if (stage === "consume")
          expect(h.invoke).toHaveBeenLastCalledWith(
            "cancel_proxy_continuation",
            { continuationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
          );
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("bounds the entire offer deadline and falls back to manual review on stalled consent inspection", async () => {
    vi.useFakeTimers();
    try {
      const view = fixture();
      h.invoke.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return receipt;
      });
      view.inspect.mockImplementation(() => new Promise(() => {}));
      let offering!: Promise<void>;
      await act(async () => {
        offering = view.result.current.offer();
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
        await offering;
      });
      expect(view.result.current.review).toEqual(receipt);
      expect(view.result.current.continuingAutomatically).toBe(false);
      expect(view.result.current.trustNotice).toContain(
        "could not be verified",
      );
      expect(view.continueInTab).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not reopen a stale review when navigation changes during a destination save", async () => {
    const view = fixture({ trusted: false });
    let generation = 1;
    view.options.generation = () => generation;
    await act(() => view.result.current.offer());
    view.remember.mockImplementation(async (_review, guard) => {
      generation = 2;
      guard();
    });
    await act(() => view.result.current.rememberDestination());
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(view.result.current.review).toBeNull();
    expect(view.result.current.error).toBe("");
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("keeps review visible when no same-tab continuation is available", async () => {
    const view = fixture();
    view.rerender({ ...view.options, continueInTab: undefined });
    await act(() => view.result.current.offer());
    expect(view.result.current.trustedDestination).toBe(true);
    expect(view.result.current.review).toEqual(receipt);
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("automatically consumes a fresh receipt and carries provenance, not secrets", async () => {
    const view = fixture();
    await act(() => view.result.current.offer());
    await waitFor(() => expect(view.continueInTab).toHaveBeenCalledOnce());
    expect(view.inspect).toHaveBeenCalledTimes(2);
    expect(h.invoke).toHaveBeenLastCalledWith("review_proxy_redirect", {
      sessionId: "proxy",
      receiptId: receipt.receiptId,
    });
    const target = view.continueInTab.mock.calls[0][0] as Connection;
    expect(JSON.stringify(target)).not.toContain("never-forward-this");
    expect(target).toMatchObject({
      httpVerifySsl: true,
      httpsTrustPolicy: "inherit",
      httpAutoLogin: false,
    });
    expect(getRuntimeWebNavigation(target.id)?.trustedRedirectSource).toBe(
      view.provenance,
    );
    expect(getRuntimeWebNavigation(target.id)?.redirectHops).toBe(1);
  });
  it("does not automatically continue to an untrusted origin", async () => {
    const view = fixture({ trusted: false });
    await act(() => view.result.current.offer());
    expect(view.result.current.trustedDestination).toBe(false);
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("still stops a trusted chain at the five-handoff limit", async () => {
    registerRuntimeConnection(source, {
      initialUrl: receipt.sourceOrigin,
      redirectHops: 5,
      assertCurrent: vi.fn(),
    });
    const view = fixture();
    await act(() => view.result.current.offer());
    expect(view.result.current.error).toContain("Five redirect handoffs");
    expect(view.stopSource).not.toHaveBeenCalled();
    expect(view.continueInTab).not.toHaveBeenCalled();
  });
  it.each(["https", "http"])(
    "skips trusted %s destination review without forwarding credentials",
    async (protocol) => {
      h.invoke.mockResolvedValue({
        ...receipt,
        destinationUrl: `${protocol}://target.invalid/`,
      });
      const view = fixture();
      await act(() => view.result.current.offer());
      await waitFor(() => expect(view.continueInTab).toHaveBeenCalledOnce());
      expect(view.result.current.review).toBeNull();
      const target = view.continueInTab.mock.calls[0][0] as Connection;
      expect(target.protocol).toBe(protocol);
      expect(JSON.stringify(target)).not.toContain("never-forward-this");
      expect(target).toMatchObject({
        httpVerifySsl: true,
        httpsTrustPolicy: "inherit",
        httpAutoLogin: false,
      });
    },
  );
  it.each(["https-only", "downgrade-disabled", "redirects-disabled"])(
    "never bypasses %s policy for trusted HTTP destinations",
    async (restriction) => {
      h.invoke.mockResolvedValue({
        ...receipt,
        destinationUrl: "http://target.invalid/",
      });
      const connection = {
        ...source,
        httpProxyPolicy: {
          ...source.httpProxyPolicy!,
          httpsOnly: restriction === "https-only",
          allowHttpDowngradeRedirects: restriction !== "downgrade-disabled",
          allowCrossOriginRedirects: restriction !== "redirects-disabled",
        },
      };
      const view = fixture({ connection });
      await act(() => view.result.current.offer());
      expect(view.result.current.review).toBeNull();
      expect(view.stopSource).not.toHaveBeenCalled();
      expect(view.continueInTab).not.toHaveBeenCalled();
    },
  );
  it("still requires separate login-forwarding consent for a trusted destination", async () => {
    const authView = fixture({
      connection: {
        ...source,
        httpRedirectAuthentication: {
          version: 1,
          mode: "saved-login",
          allowInsecureHttp: false,
        },
      },
    });
    await act(() => authView.result.current.offer());
    expect(authView.result.current.continuingAutomatically).toBe(false);
    expect(authView.result.current.review).toEqual(receipt);
    expect(authView.stopSource).not.toHaveBeenCalled();
  });
  it("allows manual review after a failed persisted-consent read, never auto-trust", async () => {
    const view = fixture();
    view.inspect.mockRejectedValue(new Error("storage read failed"));
    await act(() => view.result.current.offer());
    expect(view.result.current.trustNotice).toContain("could not be verified");
    expect(view.result.current.trustedDestination).toBe(false);
    expect(view.stopSource).not.toHaveBeenCalled();
    await act(() => view.result.current.accept("current"));
    expect(view.continueInTab).toHaveBeenCalledOnce();
  });
  it("drops trust if its returned guard is already revoked", async () => {
    const view = fixture();
    view.revoke();
    await act(() => view.result.current.offer());
    expect(view.result.current.trustedDestination).toBe(false);
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("rechecks revocation after native receipt consumption", async () => {
    const view = fixture();
    h.invoke.mockImplementation(
      async (_command: string, args: { receiptId: string | null }) => {
        if (args.receiptId) view.revoke();
        return receipt;
      },
    );
    await act(() => view.result.current.offer());
    await waitFor(() => expect(view.result.current.error).toContain("expired"));
    expect(view.stopSource).not.toHaveBeenCalled();
    expect(view.continueInTab).not.toHaveBeenCalled();
  });
  it("rechecks automatic consent after the deferred source stop completes", async () => {
    const view = fixture();
    let finishStop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    const stopSource = view.stopSource.getMockImplementation()!;
    view.stopSource.mockImplementation(async () => {
      await stopped;
      await stopSource();
    });
    await act(() => view.result.current.offer());
    await waitFor(() => expect(view.stopSource).toHaveBeenCalledOnce());
    expect(view.continueInTab).not.toHaveBeenCalled();

    view.revoke();
    await act(async () => {
      finishStop();
      await stopped;
    });

    await waitFor(() => expect(view.result.current.error).toContain("expired"));
    expect(view.options.proxySessionId()).toBe("");
    expect(view.continueInTab).not.toHaveBeenCalled();
  });
  it("carries automatic consent into deferred canonical launch checks after source unmount", async () => {
    const view = fixture();
    let finishCapabilities!: () => void;
    const capabilities = new Promise<void>((resolve) => {
      finishCapabilities = resolve;
    });
    const addSession = vi.fn();
    const handleConnect = vi.fn(
      async (connection: Connection, assertCurrent?: () => void) => {
        assertCurrent!();
        await capabilities;
        assertCurrent!();
        addSession(connection);
        return "destination-session";
      },
    );
    const launch = renderHook(() => useRuntimeConnectionLaunch(handleConnect));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      view.continueInTab.mockImplementation((connection: Connection) => {
        window.dispatchEvent(
          new CustomEvent(OPEN_RUNTIME_CONNECTION_EVENT, {
            detail: { connection, source: "httpRedirect" },
          }),
        );
      });
      await act(() => view.result.current.offer());
      await waitFor(() => expect(handleConnect).toHaveBeenCalledOnce());
      const target = view.continueInTab.mock.calls[0][0] as Connection;
      const navigation = getRuntimeWebNavigation(target.id)!;
      expect(handleConnect).toHaveBeenCalledWith(
        target,
        navigation.assertCurrent,
      );
      expect(view.options.proxySessionId()).toBe("");
      // The expected proxy stop does not invalidate the database grant by itself.
      expect(() => navigation.assertCurrent()).not.toThrow();
      view.unmount();

      view.revoke();
      await act(async () => {
        finishCapabilities();
        await capabilities;
      });

      await waitFor(() =>
        expect(resolveRuntimeConnection([], target.id)).toBeUndefined(),
      );
      expect(addSession).not.toHaveBeenCalled();
      expect(getRuntimeWebNavigation(target.id)).toBeUndefined();
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
      launch.unmount();
    }
  });
  it("reoffers the receipt after saving its own list delta without stopping the proxy", async () => {
    const view = fixture({ trusted: false });
    await act(() => view.result.current.offer());
    view.remember.mockImplementation(async (_review, guard) => {
      guard();
      view.inspect.mockImplementation(async (_next, check) => ({
        trusted: true,
        provenance: view.provenance,
        assertCurrent: check,
        assertLaunchCurrent: view.provenance.assertOwner,
      }));
      view.rerender({
        ...view.options,
        connection: {
          ...source,
          httpTrustedRedirectDestinations: {
            version: 1,
            origins: ["https://target.invalid"],
          },
        },
        trust: { ...view.options.trust!, revision: "2" },
      });
      guard();
    });
    await act(() => view.result.current.rememberDestination());
    await waitFor(() =>
      expect(view.result.current.trustedDestination).toBe(true),
    );
    expect(view.result.current.review).toEqual(receipt);
    expect(view.result.current.trustNotice).toContain("Destination saved");
    expect(view.stopSource).not.toHaveBeenCalled();
    expect(
      h.invoke.mock.calls.every(([, args]) => args.receiptId === null),
    ).toBe(true);
    // Saving this receipt is not acceptance; a later native receipt uses saved trust.
    act(() => view.result.current.cancel());
    h.invoke.mockResolvedValue({
      ...receipt,
      receiptId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    await act(() => view.result.current.offer());
    await waitFor(() => expect(view.continueInTab).toHaveBeenCalledOnce());
  });
  it("keeps failed saves untrusted and leaves one-time choices available", async () => {
    const view = fixture({ trusted: false });
    await act(() => view.result.current.offer());
    view.remember.mockRejectedValue(new Error("disk full"));
    await act(() => view.result.current.rememberDestination());
    await waitFor(() => expect(view.result.current.review).toEqual(receipt));
    expect(view.result.current.trustedDestination).toBe(false);
    expect(view.result.current.trustNotice).toContain("could not be saved");
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("rejects a replaced native receipt before writing consent", async () => {
    const view = fixture({ trusted: false });
    await act(() => view.result.current.offer());
    h.invoke.mockResolvedValue({
      ...receipt,
      destinationUrl: "https://other.invalid/",
    });
    await act(() => view.result.current.rememberDestination());
    expect(view.remember).not.toHaveBeenCalled();
    expect(view.stopSource).not.toHaveBeenCalled();
  });
  it("does not save from unsaved connections or after losing database access", async () => {
    const view = fixture({ trusted: false });
    view.rerender({
      ...view.options,
      trust: {
        ...view.options.trust!,
        canRemember: false,
        unavailableReason: "Save this connection first.",
      },
    });
    await act(() => view.result.current.offer());
    await act(() => view.result.current.rememberDestination());
    expect(view.remember).not.toHaveBeenCalled();
    view.rerender(view.options);
    h.locked = true;
    await act(() => view.result.current.rememberDestination());
    expect(view.remember).not.toHaveBeenCalled();
  });
});
