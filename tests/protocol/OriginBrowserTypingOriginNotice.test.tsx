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
  allow: vi.fn(),
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
let offer: (origin: string) => void;
function Fixture({
  owner = identity,
  canAllow = true,
}: {
  owner?: OriginBrowserIdentity;
  canAllow?: boolean;
}) {
  const notices = useOriginBrowserNotices({
    identity: owner,
    enabled: true,
    canReload: true,
    reload: async () => true,
    assertOwner: () => {},
    allowTypingOrigin: canAllow ? boundary.allow : undefined,
  });
  offer = notices.offerTypingOrigin;
  return <OriginBrowserNotices notices={notices} />;
}
beforeEach(() => {
  vi.clearAllMocks();
  boundary.allow.mockResolvedValue(undefined);
  boundary.listen.mockImplementation(async () => () => {});
});
afterEach(cleanup);
async function mount(props: React.ComponentProps<typeof Fixture> = {}) {
  const view = render(<Fixture {...props} />);
  await waitFor(() => expect(boundary.listen).toHaveBeenCalled());
  return view;
}
const label = (origin: string) => `Allow ${origin} and type`;

describe("typing refused because the HTTP origin is not allowed", () => {
  it("floats a popup naming the exact origin with the explicit Allow button", async () => {
    await mount();
    act(() => offer("http://device.test:8080"));
    const stack = screen.getByRole("status", { name: "Browser notifications" });
    expect(stack).toHaveTextContent("http://device.test:8080");
    expect(stack).toHaveTextContent("plain-HTTP");
    expect(
      stack.querySelector("[data-native-browser-occlusion]"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: label("http://device.test:8080") }),
    ).toBeEnabled();
    // Showing the popup allows nothing.
    expect(boundary.allow).not.toHaveBeenCalled();
  });
  it("saves exactly the offered origin, port included, only on click", async () => {
    await mount();
    act(() => offer("http://device.test:8080"));
    fireEvent.click(
      screen.getByRole("button", { name: label("http://device.test:8080") }),
    );
    await waitFor(() =>
      expect(boundary.allow).toHaveBeenCalledExactlyOnceWith(
        "http://device.test:8080",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
  it("keeps the popup with a fixed error and a working button when saving fails", async () => {
    boundary.allow.mockRejectedValueOnce(new Error("PRIVATE_DISK_ERROR"));
    await mount();
    act(() => offer("http://device.test:8080"));
    const name = label("http://device.test:8080");
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "could not be confirmed saved",
      ),
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "PRIVATE_DISK_ERROR",
    );
    expect(screen.getByRole("button", { name })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(boundary.allow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
  it("dismisses without allowing anything", async () => {
    await mount();
    act(() => offer("http://device.test:8080"));
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss browser notification" }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(boundary.allow).not.toHaveBeenCalled();
  });
  it("offers nothing when the connection cannot be saved", async () => {
    await mount({ canAllow: false });
    act(() => offer("http://device.test:8080"));
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("shows one popup per origin and drops it with the browser attempt", async () => {
    const view = await mount();
    act(() => {
      offer("http://device.test:8080");
      offer("http://device.test:8080");
    });
    expect(screen.getAllByRole("button", { name: /^Allow / })).toHaveLength(1);
    view.rerender(<Fixture owner={{ ...identity, attemptId: "next" }} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
