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
import type {
  ConnectionSession,
  HttpBookmarkItem,
} from "../../src/types/connection/connection";
const f = vi.hoisted(() => ({ context: {} as any, revoked: false }));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => f.context,
}));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: () => () => {
    if (f.revoked) throw new Error("revoked");
  },
}));
import OriginBookmarkButton from "../../src/components/protocol/webBrowser/OriginBookmarkButton";

const session = {
  id: "tab",
  connectionId: "connection",
  ownerDatabaseId: "database",
} as ConnectionSession;
const props = () => ({
  session,
  bookmarks: f.context.state.connections[0].httpBookmarks,
  initialUrl: "https://example.test/start",
  currentUrl: "https://example.test/current?value=review#section",
  currentTitle: "Current website",
  eligible: true,
  canOpen: true,
  temporary: false,
  assertOwner: () => {
    if (f.revoked) throw new Error("revoked");
  },
  hideNative: vi.fn(),
  onOverlayChange: vi.fn(),
});
beforeEach(() => {
  f.revoked = false;
  f.context = {
    databaseAvailability: {
      status: "ready",
      databaseId: "database",
      generation: 1,
    },
    state: {
      connections: [{ id: "connection", name: "Saved", httpBookmarks: [] }],
    },
    getCurrentConnections: vi.fn(() => f.context.state.connections),
    dispatchAndFlush: vi.fn(async ({ payload }) => {
      f.context.state.connections = [payload];
    }),
  };
});
afterEach(cleanup);
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Bookmark this page" }));
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));
describe("native toolbar bookmark", () => {
  it("reviews and saves to the same connection library without requiring the bookmarks bar", async () => {
    const p = props();
    render(<OriginBookmarkButton {...p} />);
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    open();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "including query and fragment values",
    );
    expect(screen.getByRole("textbox", { name: "Bookmark name" })).toHaveValue(
      "Current website",
    );
    expect(p.hideNative).toHaveBeenCalledOnce();
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(true);
    save();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.context.dispatchAndFlush).toHaveBeenCalledOnce();
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      { name: "Current website", path: p.currentUrl },
    ]);
  });
  it("edits a nested duplicate instead of adding another bookmark or losing metadata", async () => {
    // Extra persisted metadata is intentional; it is not part of the public schema.
    const existingBookmark: HttpBookmarkItem & { id: string } = {
      id: "keep-id",
      name: "Old name",
      path: "/current?value=review#section",
    };
    f.context.state.connections[0].httpBookmarks = [
      {
        name: "Folder",
        isFolder: true,
        children: [existingBookmark],
      },
    ] satisfies HttpBookmarkItem[];
    render(<OriginBookmarkButton {...props()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit bookmark for this page" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), {
      target: { value: "New name" },
    });
    save();
    await waitFor(() =>
      expect(f.context.dispatchAndFlush).toHaveBeenCalledOnce(),
    );
    expect(f.context.state.connections[0].httpBookmarks).toEqual([
      {
        name: "Folder",
        isFolder: true,
        children: [
          { id: "keep-id", name: "New name", path: props().currentUrl },
        ],
      },
    ]);
  });
  it("disables temporary sessions with an explanation and never captures a database grant", () => {
    render(
      <OriginBookmarkButton
        {...props()}
        temporary
        session={{ ...session, ownerDatabaseId: undefined }}
      />,
    );
    const button = screen.getByRole("button", { name: "Bookmark this page" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "data-tooltip",
      "Save a connection to add bookmarks.",
    );
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.context.getCurrentConnections).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    "https://user:secret@example.test/",
    "javascript:alert(1)",
  ])("never bookmarks an absent or unsafe native address: %s", (currentUrl) => {
    render(<OriginBookmarkButton {...props()} currentUrl={currentUrl} />);
    expect(
      screen.getByRole("button", { name: "Bookmark this page" }),
    ).toBeDisabled();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
  });
  it("rejects database revocation and stale bookmark trees before mutation", async () => {
    const p = props();
    render(<OriginBookmarkButton {...p} />);
    open();
    f.context.state.connections[0].httpBookmarks = [
      { name: "Concurrent addition", path: "/new" },
    ];
    save();
    await screen.findByRole("alert");
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
    f.revoked = true;
    save();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("could not be saved"),
    );
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
  });
  it("retires the review through navigation A-B-A and owner eligibility changes", () => {
    const p = props(),
      view = render(<OriginBookmarkButton {...p} />);
    open();
    view.rerender(
      <OriginBookmarkButton {...p} currentUrl="https://example.test/other" />,
    );
    view.rerender(<OriginBookmarkButton {...p} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    view.rerender(<OriginBookmarkButton {...p} eligible={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.context.dispatchAndFlush).not.toHaveBeenCalled();
  });
  it("single-flights persistence and closes overlay ownership on unmount", async () => {
    let finish!: () => void;
    f.context.dispatchAndFlush.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    const p = props(),
      view = render(<OriginBookmarkButton {...p} />);
    open();
    const submit = screen.getByRole("button", { name: "Save bookmark" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(f.context.dispatchAndFlush).toHaveBeenCalledOnce();
    view.unmount();
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(false);
    await act(async () => finish());
  });
});
