import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OriginBrowserIdentity } from "../../src/types/protocols/originBrowser";

const boundary = vi.hoisted(() => ({
  listen: vi.fn(),
  reload: vi.fn(),
  stop: vi.fn(),
  accessible: true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: boundary.listen }));
import { useOriginBrowserNotices } from "../../src/hooks/protocol/useOriginBrowserNotices";
import OriginBrowserNotices from "../../src/components/protocol/webBrowser/OriginBrowserNotices";

const identity: OriginBrowserIdentity = {
  ownerDatabaseId: "db",
  connectionId: "connection",
  sessionId: "tab",
  attemptId: "attempt",
};
let receive: (event: { payload: unknown }) => void;
function Fixture({
  owner = identity,
  enabled = true,
  canReload = true,
}: {
  owner?: OriginBrowserIdentity;
  enabled?: boolean;
  canReload?: boolean;
}) {
  const notices = useOriginBrowserNotices({
    identity: owner,
    enabled,
    canReload,
    reload: boundary.reload,
    assertOwner: () => {
      if (!boundary.accessible) throw new Error("PRIVATE_NATIVE_ERROR");
    },
  });
  return <OriginBrowserNotices notices={notices} />;
}
beforeEach(() => {
  vi.clearAllMocks();
  boundary.accessible = true;
  boundary.reload.mockResolvedValue(true);
  boundary.listen.mockImplementation(async (_event, callback) => {
    receive = callback;
    return boundary.stop;
  });
});
afterEach(cleanup);
async function mount() {
  const view = render(<Fixture />);
  await waitFor(() => expect(boundary.listen).toHaveBeenCalledOnce());
  return view;
}
const emit = (payload: unknown) => act(() => receive({ payload }));
const timeout = (owner = identity) =>
  emit({ identity: owner, kind: "document-load-timeout" });

describe("attempt-scoped native browser notifications", () => {
  it("shows one themed timeout toast and reloads only on a mounted action", async () => {
    await mount();
    timeout();
    timeout();
    const notice = screen.getByRole("status", {
      name: "Browser notifications",
    });
    expect(notice).toHaveTextContent(
      "The page took too long to load. Loading was stopped.",
    );
    expect(screen.getAllByRole("button", { name: "Reload page" })).toHaveLength(
      1,
    );
    expect(boundary.reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(boundary.reload).toHaveBeenCalledExactlyOnceWith();
  });
  it("accepts only known kinds for the complete issuing identity and ignores native diagnostic fields", async () => {
    await mount();
    for (const field of [
      "ownerDatabaseId",
      "connectionId",
      "sessionId",
      "attemptId",
    ])
      timeout({ ...identity, [field]: "other" });
    for (const payload of [
      null,
      "bad",
      {},
      { identity },
      { identity, kind: "unknown" },
      { identity: {}, kind: "document-load-timeout" },
    ])
      emit(payload);
    expect(screen.queryByRole("status")).toBeNull();
    emit({
      identity,
      kind: "document-load-timeout",
      url: "https://secret.invalid/?token=PRIVATE_TOKEN",
      message: "PRIVATE_NATIVE_ERROR",
    });
    expect(screen.getByRole("status")).not.toHaveTextContent(/secret|PRIVATE/);
  });
  it("dismisses without reloading and shows a future timeout again", async () => {
    await mount();
    timeout();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss browser notification" }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(boundary.reload).not.toHaveBeenCalled();
    timeout();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeEnabled();
  });
  it("keeps the notice but disables Reload behind another browser tool", async () => {
    const view = await mount();
    timeout();
    view.rerender(<Fixture canReload={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(boundary.reload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeDisabled();
    view.rerender(<Fixture />);
    expect(screen.getByRole("button", { name: "Reload page" })).toBeEnabled();
  });
  it("rechecks owner authority at notice delivery and before Reload", async () => {
    await mount();
    boundary.accessible = false;
    timeout();
    expect(screen.queryByRole("status")).toBeNull();
    boundary.accessible = true;
    timeout();
    boundary.accessible = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(boundary.reload).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "PRIVATE_NATIVE_ERROR",
    );
  });
  it("retires notices and old callbacks across reconnect, inactivity and unmount", async () => {
    const view = await mount();
    timeout();
    const oldReceive = receive;
    const oldAction = screen.getByRole("button", { name: "Reload page" });
    const successor = { ...identity, attemptId: "successor" };
    view.rerender(<Fixture owner={successor} />);
    await waitFor(() => expect(boundary.listen).toHaveBeenCalledTimes(2));
    act(() =>
      oldReceive({ payload: { identity, kind: "document-load-timeout" } }),
    );
    timeout();
    fireEvent.click(oldAction);
    expect(screen.queryByRole("status")).toBeNull();
    expect(boundary.reload).not.toHaveBeenCalled();
    timeout(successor);
    expect(screen.getByRole("status")).toBeVisible();
    view.rerender(<Fixture owner={successor} enabled={false} />);
    expect(screen.queryByRole("status")).toBeNull();
    timeout(successor);
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
    expect(boundary.stop).toHaveBeenCalledTimes(2);
  });
  it.each([false, "reject"])(
    "keeps failures sanitized and retryable (%s)",
    async (result) => {
      if (result === "reject")
        boundary.reload.mockRejectedValueOnce(
          new Error("PRIVATE_NATIVE_ERROR"),
        );
      else boundary.reload.mockResolvedValueOnce(false);
      await mount();
      timeout();
      fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
      await screen.findByText(
        "Reload was not accepted. Review the browser status and try again.",
      );
      expect(screen.getByRole("status")).not.toHaveTextContent(
        "PRIVATE_NATIVE_ERROR",
      );
      fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
      await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
      expect(boundary.reload).toHaveBeenCalledTimes(2);
    },
  );
  it("keeps Reload single-flight and does not erase a newer notice with an old result", async () => {
    let finish!: (accepted: boolean) => void;
    boundary.reload.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    timeout();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    fireEvent.click(screen.getByRole("button", { name: "Reloading…" }));
    expect(boundary.reload).toHaveBeenCalledOnce();
    timeout();
    await act(async () => finish(true));
    expect(screen.getByRole("button", { name: "Reload page" })).toBeEnabled();
  });
  it("does not leak delayed Reload completion into a successor attempt", async () => {
    let finish!: (accepted: boolean) => void;
    boundary.reload.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const view = await mount();
    timeout();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    const successor = { ...identity, attemptId: "successor" };
    view.rerender(<Fixture owner={successor} />);
    await waitFor(() => expect(boundary.listen).toHaveBeenCalledTimes(2));
    timeout(successor);
    await act(async () => finish(false));
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Reload was not accepted",
    );
    expect(screen.getByRole("button", { name: "Reload page" })).toBeEnabled();
  });
  it("shows one retention warning per attempt without asserting restore or reloading a form", async () => {
    await mount();
    emit({
      identity,
      kind: "cookie-retention-failed",
      message: "PRIVATE_NATIVE_ERROR",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cookie retention failed. Sign-in won't be retained. Reopen the website to retry.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      /restored|PRIVATE/,
    );
    expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
    timeout();
    expect(
      screen.getAllByRole("button", { name: "Dismiss browser notification" }),
    ).toHaveLength(2);
    expect(boundary.reload).not.toHaveBeenCalled();
  });
  it("does not repeat dismissed retention failures, including after tab reactivation", async () => {
    const view = await mount();
    const fail = (owner = identity) =>
      emit({ identity: owner, kind: "cookie-retention-failed" });
    fail();
    fail();
    expect(
      screen.getAllByRole("button", { name: "Dismiss browser notification" }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss browser notification" }),
    );
    fail();
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(<Fixture enabled={false} />);
    view.rerender(<Fixture />);
    await waitFor(() => expect(boundary.listen).toHaveBeenCalledTimes(2));
    fail();
    expect(screen.queryByRole("status")).toBeNull();
    const successor = { ...identity, attemptId: "successor" };
    view.rerender(<Fixture owner={successor} />);
    await waitFor(() => expect(boundary.listen).toHaveBeenCalledTimes(3));
    fail(identity);
    expect(screen.queryByRole("status")).toBeNull();
    fail(successor);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sign-in won't be retained",
    );
    expect(boundary.reload).not.toHaveBeenCalled();
  });
  it("releases registration that finishes after unmount", async () => {
    let finish!: (stop: () => void) => void;
    boundary.listen.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = await mount();
    view.unmount();
    await act(async () => finish(boundary.stop));
    expect(boundary.stop).toHaveBeenCalledOnce();
  });
  it("reports listener failure with fixed wording", async () => {
    boundary.listen.mockRejectedValueOnce(new Error("PRIVATE_NATIVE_ERROR"));
    await mount();
    await screen.findByText(
      "Browser notifications are unavailable for this attempt.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "PRIVATE_NATIVE_ERROR",
    );
  });
});
