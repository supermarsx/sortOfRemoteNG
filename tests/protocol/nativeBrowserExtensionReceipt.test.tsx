import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeBrowserExtensionReceipt } from "../../src/hooks/protocol/useNativeBrowserExtensionReceipt";
import type { NativeBrowserExtensionReceipt } from "../../src/types/protocols/nativeBrowserExtensions";
import type { OriginBrowserIdentity } from "../../src/types/protocols/originBrowser";

const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const identity: OriginBrowserIdentity = {
  ownerDatabaseId: "owner-database",
  connectionId: "website",
  sessionId: "website-tab",
  attemptId: "native-attempt",
};
function receipt(
  owner = identity,
  appEnabled = true,
): NativeBrowserExtensionReceipt {
  return {
    version: 1,
    identity: { ...owner },
    appControls: true,
    appEnabled,
    forcedDark: true,
    chromium: "unsupportedPrivateContext",
  };
}
type Props = {
  identity: OriginBrowserIdentity | null;
  enabled: boolean;
  assertOwner: () => void;
};
function start(overrides: Partial<Props> = {}) {
  const props: Props = {
    identity: { ...identity },
    enabled: true,
    assertOwner: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(
    (current: Props) =>
      useNativeBrowserExtensionReceipt(
        current.identity,
        current.enabled,
        current.assertOwner,
      ),
    { initialProps: props },
  );
  return { ...hook, props };
}
let replies: ReturnType<typeof deferred<NativeBrowserExtensionReceipt>>[];
beforeEach(() => {
  replies = [];
  transport.invoke.mockReset().mockImplementation(() => {
    const reply = deferred<NativeBrowserExtensionReceipt>();
    replies.push(reply);
    return reply.promise;
  });
});
afterEach(cleanup);

describe("native extension receipt request", () => {
  it.each([
    { identity: null, enabled: true },
    { identity, enabled: false },
    { identity: null, enabled: false },
  ])("does not acquire authority with inactive inputs %j", (inactive) => {
    const assertOwner = vi.fn();
    const hook = start({ ...inactive, assertOwner });
    expect(hook.result.current).toBeNull();
    expect(assertOwner).not.toHaveBeenCalled();
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it("asserts ownership before IPC and after completion and sends only the immutable identity", async () => {
    const assertOwner = vi.fn();
    const hook = start({ assertOwner });
    expect(hook.result.current).toBeNull();
    expect(transport.invoke).toHaveBeenCalledExactlyOnceWith(
      "origin_browser_extensions",
      { request: { identity } },
    );
    expect(assertOwner).toHaveBeenCalledTimes(1);
    expect(assertOwner.mock.invocationCallOrder[0]).toBeLessThan(
      transport.invoke.mock.invocationCallOrder[0],
    );
    const confirmed = receipt();
    await act(async () => replies[0].resolve(confirmed));
    expect(assertOwner).toHaveBeenCalledTimes(2);
    expect(hook.result.current).toEqual(confirmed);
    expect(transport.invoke).toHaveBeenCalledTimes(1);
  });

  it("fails closed before dispatch when the owner is already revoked", async () => {
    const assertOwner = vi.fn(() => {
      throw new Error("private owner proof");
    });
    const hook = start({ assertOwner });
    await act(async () => {});
    expect(hook.result.current).toBeNull();
    expect(assertOwner).toHaveBeenCalledTimes(1);
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it("uses the latest owner assertion after await without refetching a value-identical identity", async () => {
    const original = vi.fn();
    const current = vi.fn();
    const hook = start({ assertOwner: original });
    hook.rerender({
      ...hook.props,
      identity: { ...identity },
      assertOwner: current,
    });
    expect(transport.invoke).toHaveBeenCalledTimes(1);
    await act(async () => replies[0].resolve(receipt()));
    expect(original).toHaveBeenCalledTimes(1);
    expect(current).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toEqual(receipt());
  });

  it("rejects a response when the current owner lease revoked during the await", async () => {
    const original = vi.fn();
    const revoked = vi.fn(() => {
      throw new Error("database locked: private context");
    });
    const hook = start({ assertOwner: original });
    hook.rerender({ ...hook.props, assertOwner: revoked });
    await act(async () => replies[0].resolve(receipt()));
    expect(original).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toBeNull();
  });

  it("does not expose transport error details or fall back to saved permission", async () => {
    const assertOwner = vi.fn();
    const hook = start({ assertOwner });
    await act(async () =>
      replies[0].reject(new Error("https://private.test/?credential=secret")),
    );
    expect(hook.result.current).toBeNull();
    expect(assertOwner).toHaveBeenCalledTimes(1);
    expect(transport.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("native extension receipt cancellation and owner fences", () => {
  it.each([
    "ownerDatabaseId",
    "connectionId",
    "sessionId",
    "attemptId",
  ] as const)(
    "never adopts a late response after %s changes",
    async (field) => {
      const hook = start();
      const successor = { ...identity, [field]: `new-${field}` };
      const newOwner = vi.fn();
      hook.rerender({
        ...hook.props,
        identity: successor,
        assertOwner: newOwner,
      });
      expect(hook.result.current).toBeNull();
      expect(transport.invoke).toHaveBeenLastCalledWith(
        "origin_browser_extensions",
        { request: { identity: successor } },
      );
      await act(async () => replies[1].resolve(receipt(successor, false)));
      expect(hook.result.current).toEqual(receipt(successor, false));
      await act(async () => replies[0].resolve(receipt()));
      expect(hook.result.current).toEqual(receipt(successor, false));
      expect(newOwner).toHaveBeenCalledTimes(2);
      expect(hook.props.assertOwner).toHaveBeenCalledTimes(1);
    },
  );

  it("does not clear a successor receipt when the old request rejects late", async () => {
    const hook = start();
    const successor = { ...identity, attemptId: "reconnected" };
    hook.rerender({ ...hook.props, identity: successor });
    await act(async () => replies[1].resolve(receipt(successor)));
    await act(async () =>
      replies[0].reject(new Error("old owner unavailable")),
    );
    expect(hook.result.current).toEqual(receipt(successor));
  });

  it.each(["disable", "lose-identity"] as const)(
    "ignores pending replies after %s",
    async (mode) => {
      const assertOwner = vi.fn();
      const hook = start({ assertOwner });
      hook.rerender({
        ...hook.props,
        ...(mode === "disable" ? { enabled: false } : { identity: null }),
      });
      expect(hook.result.current).toBeNull();
      await act(async () => replies[0].resolve(receipt()));
      expect(hook.result.current).toBeNull();
      expect(assertOwner).toHaveBeenCalledTimes(1);
      expect(transport.invoke).toHaveBeenCalledTimes(1);
    },
  );

  it("does not revive a pending request after disable and re-enable with the same identity", async () => {
    const hook = start();
    hook.rerender({ ...hook.props, enabled: false });
    hook.rerender(hook.props);
    expect(transport.invoke).toHaveBeenCalledTimes(2);
    await act(async () => replies[0].resolve(receipt()));
    expect(hook.result.current).toBeNull();
    await act(async () => replies[1].resolve(receipt(identity, false)));
    expect(hook.result.current).toEqual(receipt(identity, false));
  });

  it("does not revive an old pending request through an owner A-B-A round trip", async () => {
    const hook = start();
    hook.rerender({
      ...hook.props,
      identity: { ...identity, ownerDatabaseId: "other-database" },
    });
    hook.rerender(hook.props);
    expect(transport.invoke).toHaveBeenCalledTimes(3);
    await act(async () => {
      replies[0].resolve(receipt());
      replies[1].reject(new Error("stale other database"));
    });
    expect(hook.result.current).toBeNull();
    await act(async () => replies[2].resolve(receipt(identity, false)));
    expect(hook.result.current).toEqual(receipt(identity, false));
  });

  it("hides an already accepted receipt immediately on an owner change", async () => {
    const hook = start();
    await act(async () => replies[0].resolve(receipt()));
    expect(hook.result.current).toEqual(receipt());
    hook.rerender({
      ...hook.props,
      identity: { ...identity, attemptId: "successor" },
    });
    expect(hook.result.current).toBeNull();
  });

  it.each(["disable", "owner-round-trip"] as const)(
    "requires fresh confirmation after revoking an accepted receipt (%s)",
    async (mode) => {
      const hook = start();
      await act(async () => replies[0].resolve(receipt()));
      expect(hook.result.current).toEqual(receipt());
      hook.rerender({
        ...hook.props,
        ...(mode === "disable"
          ? { enabled: false }
          : { identity: { ...identity, ownerDatabaseId: "other" } }),
      });
      expect(hook.result.current).toBeNull();
      hook.rerender(hook.props);
      // A previous scope's cached approval is not a receipt for this new
      // request, even when the serialized owner fields happen to match again.
      expect(hook.result.current).toBeNull();
      await act(async () =>
        replies[replies.length - 1].resolve(receipt(identity, false)),
      );
      expect(hook.result.current).toEqual(receipt(identity, false));
    },
  );

  it.each(["resolve", "reject"] as const)(
    "ignores a request that settles after unmount (%s)",
    async (settlement) => {
      const assertOwner = vi.fn();
      const hook = start({ assertOwner });
      hook.unmount();
      await act(async () => {
        if (settlement === "resolve") replies[0].resolve(receipt());
        else replies[0].reject(new Error("late private error"));
      });
      expect(hook.result.current).toBeNull();
      expect(assertOwner).toHaveBeenCalledTimes(1);
      expect(transport.invoke).toHaveBeenCalledTimes(1);
    },
  );

  it("stays unconfirmed if a fresh request fails after re-enabling a previously approved owner", async () => {
    const hook = start();
    await act(async () => replies[0].resolve(receipt()));
    hook.rerender({ ...hook.props, enabled: false });
    hook.rerender(hook.props);
    expect(hook.result.current).toBeNull();
    await act(async () => replies[1].reject(new Error("owner revoked")));
    expect(hook.result.current).toBeNull();
    expect(transport.invoke).toHaveBeenCalledTimes(2);
  });

  it("fences the discarded StrictMode effect despite an identical owner scope", async () => {
    const assertOwner = vi.fn();
    const hook = renderHook(
      () => useNativeBrowserExtensionReceipt(identity, true, assertOwner),
      {
        reactStrictMode: true,
      },
    );
    expect(replies).toHaveLength(2);
    await act(async () => replies[1].resolve(receipt(identity, false)));
    await act(async () => replies[0].resolve(receipt()));
    expect(hook.result.current).toEqual(receipt(identity, false));
    expect(assertOwner).toHaveBeenCalledTimes(3);
  });
});
