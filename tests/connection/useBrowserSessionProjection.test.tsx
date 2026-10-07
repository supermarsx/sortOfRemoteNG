import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import {
  useBrowserSessionProjection,
  type BrowserSessionProjectionOwner,
} from "../../src/hooks/connection/useBrowserSessionProjection";
import {
  notifyBrowserSessionProjectionChange,
  subscribeBrowserSessionProjectionChanges,
  type BrowserSessionProjectionChange,
} from "../../src/utils/services/browserSessionProjectionEvents";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let owner: BrowserSessionProjectionOwner;
let revoked: boolean;
let notificationRevoked: boolean;
let busy: boolean;
let capture: Mock<Parameters<typeof useBrowserSessionProjection>[1]>;
let notices: Mock<(change: BrowserSessionProjectionChange) => void>;
let unsubscribe: () => void;
const advance = (ms = 50) => act(() => vi.advanceTimersByTimeAsync(ms));
const notification = (
  changeId = "change",
  databaseId = "database",
): BrowserSessionProjectionChange => ({
  databaseId,
  changeId,
  assertCurrent: () => {
    if (notificationRevoked) throw new Error("Source owner revoked");
  },
});
const emit = (value = notification()) =>
  act(() => notifyBrowserSessionProjectionChange(value));
beforeEach(() => {
  vi.useFakeTimers();
  revoked = false;
  notificationRevoked = false;
  busy = false;
  owner = {
    databaseId: "database",
    assertCurrent: () => {
      if (revoked) throw new Error("Provider owner revoked");
    },
    isBusy: () => busy,
    currentDescriptor: () => undefined,
    refresh: vi.fn(async () => ({ changed: false })),
  };
  capture = vi.fn((databaseId?: string) =>
    databaseId === undefined || databaseId === "database" ? owner : null,
  );
  notices = vi.fn<(change: BrowserSessionProjectionChange) => void>();
  unsubscribe = subscribeBrowserSessionProjectionChanges(notices);
});
afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function mount() {
  const result = renderHook(() => useBrowserSessionProjection(1, capture));
  await advance();
  vi.mocked(owner.refresh).mockClear();
  notices.mockClear();
  return result;
}

it("coalesces verified notifications and never echoes them with another sync change ID", async () => {
  const view = await mount();
  vi.mocked(owner.refresh).mockResolvedValue({ changed: true });
  emit();
  emit();
  emit(notification("newer"));
  await advance();
  expect(owner.refresh).toHaveBeenCalledOnce();
  expect(notices).toHaveBeenCalledTimes(3); // original notifications only
  emit();
  await advance();
  expect(owner.refresh).toHaveBeenCalledOnce();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores raw native events and foreign owner notifications", async () => {
  const view = await mount();
  act(() =>
    window.dispatchEvent(
      new CustomEvent("database-protection:browser-sessions-changed", {
        detail: { databaseId: "database" },
      }),
    ),
  );
  emit(notification("foreign", "other"));
  await advance();
  expect(owner.refresh).not.toHaveBeenCalled();
  view.unmount();
});

it.each(["lock", "profile-switch", "database-switch", "unlock-generation"])(
  "discards queued work when the captured provider fence reports %s",
  async () => {
    const view = await mount();
    emit();
    revoked = true;
    await advance();
    expect(owner.refresh).not.toHaveBeenCalled();
    view.unmount();
  },
);

it("checks the notification's captured source lease again before refreshing", async () => {
  const view = await mount();
  emit();
  notificationRevoked = true;
  await advance();
  expect(owner.refresh).not.toHaveBeenCalled();
  view.unmount();
});

it("does not overlap pending refreshes and retries a busy owner without native calls", async () => {
  const view = await mount();
  busy = true;
  emit();
  await advance(1000);
  expect(owner.refresh).not.toHaveBeenCalled();
  busy = false;
  const reply = deferred<{ changed: boolean }>();
  vi.mocked(owner.refresh).mockReturnValueOnce(reply.promise);
  await advance(250);
  emit(notification("during"));
  emit(notification("during"));
  await advance(1000);
  expect(owner.refresh).toHaveBeenCalledOnce();
  await act(async () => reply.resolve({ changed: true }));
  await advance(250);
  expect(owner.refresh).toHaveBeenCalledTimes(2);
  view.unmount();
});

it("does not automatically retry a rejected CAS refresh or publish a successful change", async () => {
  const view = await mount();
  vi.mocked(owner.refresh).mockRejectedValue(new Error("Public body changed"));
  emit();
  await advance(60_000);
  expect(owner.refresh).toHaveBeenCalledOnce();
  expect(notices).toHaveBeenCalledOnce(); // original verified notification only
  view.unmount();
});

it.each(["revocation", "unmount"])(
  "does not publish a catch-up result after %s while refresh is pending",
  async (reason) => {
    const reply = deferred<{ changed: boolean }>();
    vi.mocked(owner.refresh).mockReturnValue(reply.promise);
    const view = renderHook(() => useBrowserSessionProjection(1, capture));
    await advance();
    if (reason === "unmount") view.unmount();
    else revoked = true;
    await act(async () => reply.resolve({ changed: true }));
    expect(notices).not.toHaveBeenCalled();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("publishes one semantic catch-up, but no notification for ledger/activity-only refresh", async () => {
  vi.mocked(owner.refresh).mockResolvedValueOnce({ changed: true });
  const view = renderHook(
    ({ generation }) => useBrowserSessionProjection(generation, capture),
    { initialProps: { generation: 1 } },
  );
  await advance(1000);
  expect(owner.refresh).toHaveBeenCalledOnce();
  expect(notices).toHaveBeenCalledOnce();
  expect(Object.keys(notices.mock.calls[0][0]).sort()).toEqual([
    "assertCurrent",
    "changeId",
    "databaseId",
  ]);
  view.rerender({ generation: 2 });
  await advance(1000);
  expect(owner.refresh).toHaveBeenCalledTimes(2);
  expect(notices).toHaveBeenCalledOnce();
  view.unmount();
});

it("does not subscribe while unready and drops queued work when readiness is revoked", async () => {
  const view = renderHook(
    ({ ready }) => useBrowserSessionProjection(ready, capture),
    {
      initialProps: { ready: undefined as number | undefined },
    },
  );
  emit();
  await advance(1000);
  expect(capture).not.toHaveBeenCalled();
  view.rerender({ ready: 1 });
  view.rerender({ ready: undefined });
  await advance(1000);
  expect(owner.refresh).not.toHaveBeenCalled();
  view.unmount();
});
