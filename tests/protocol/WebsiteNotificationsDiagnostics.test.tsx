import type { ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebsiteNotifications from "../../src/components/protocol/webBrowser/WebsiteNotifications";

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  active: true,
  writeText: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: fixture.active }),
}));

type Manager = ComponentProps<typeof WebsiteNotifications>["mgr"];
const PROXY = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const OTHER = "http://p11111111111111111111111111111111.localhost:43124";
const BLOCKED = "https://blocked.example.test";
function manager(): Manager {
  return {
    session: { id: "website-a", ownerDatabaseId: "database-a" },
    currentUrl: "https://website.example.test/private-path?private-query=1",
    webProxyOrigin: PROXY,
    webNetworkReports: [
      {
        kind: "fetch",
        reason: "origin-not-approved",
        origin: "https://api.example.test",
      },
    ],
    webNetworkRouting: {
      status: "current",
      quickConnectNavigation: false,
      quickConnectDiscovery: false,
      quickConnectDiscovered: false,
      quickConnectDirectNavigation: false,
      quickConnectRegionalNavigation: false,
    },
    webNetworkGuard: {
      platform: "windows",
      frameNavigation: "enforced",
      allNetworkRequestsMediated: false,
    },
    handleRefresh: vi.fn(),
    applicationExternalTarget: {
      label: "Website",
      url: "https://website.example.test/private-path?private-query=1",
    },
    openingApplicationExternal: false,
    handleOpenApplicationExternal: vi.fn(async () => undefined),
    automation: {
      error: null,
      busy: false,
      reload: vi.fn(async () => undefined),
      recordingScopeKey: "database-a:1",
    },
  };
}
function status() {
  return {
    platform: "windows",
    frameNavigation: "enforced",
    allNetworkRequestsMediated: false,
    httpObservations: {
      scope: "application",
      total: 5,
      documentBlocked: 1,
      recent: [
        { origin: "http://ipc.localhost", method: "POST", resourceKind: "xhr" },
        { origin: PROXY, method: "GET", resourceKind: "font" },
        { origin: OTHER, method: "POST", resourceKind: "xhr" },
        { origin: BLOCKED, method: "GET", resourceKind: "document" },
        { origin: PROXY, method: "POST", resourceKind: "xhr" },
      ].map((row, index) => ({
        ...row,
        sequence: index + 1,
        sourceKind: "document",
        documentBlocked: index === 3,
        headers: { Authorization: "private-auth" },
        body: "private-body",
        path: "/private-path",
        query: "private-query=1",
      })),
    },
  };
}
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
beforeEach(() => {
  fixture.active = true;
  fixture.invoke.mockReset().mockResolvedValue(status());
  fixture.writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: fixture.writeText },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (hiddenDescriptor)
    Object.defineProperty(document, "hidden", hiddenDescriptor);
  else Reflect.deleteProperty(document, "hidden");
});
async function openPopup() {
  fireEvent.click(
    screen.getByRole("button", { name: "Website notifications" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Website notifications",
  });
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}
async function openAdvanced(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByText("Protection details"));
  fireEvent.click(within(dialog).getByText("Advanced diagnostics"));
  return screen.findByRole("list", { name: "Filtered native observations" });
}
function chooseFilter(dialog: HTMLElement, label: string) {
  fireEvent.click(
    within(dialog).getByRole("combobox", {
      name: "Filter native observations",
    }),
  );
  const option = screen.getByRole("option", { name: label });
  // Exercise the actual shared Select's body portal, not an in-popup substitute.
  expect(dialog).not.toContainElement(option);
  fireEvent.mouseDown(option);
  expect(
    screen.getByRole("dialog", { name: "Website notifications" }),
  ).toBeVisible();
}

describe("real website notification diagnostics integration", () => {
  it("reads only when Advanced diagnostics opens, never from ordinary disclosure or a closed popup", async () => {
    render(<WebsiteNotifications mgr={manager()} />);
    expect(fixture.invoke).not.toHaveBeenCalled();
    const dialog = await openPopup();
    expect(fixture.invoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText("Protection details"));
    await act(async () => {});
    expect(fixture.invoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText("Advanced diagnostics"));
    await screen.findByRole("list", { name: "Filtered native observations" });
    expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith(
      "web_network_guard_status",
    );
    expect(fixture.writeText).not.toHaveBeenCalled();
    const list = screen.getByRole("list", {
      name: "Filtered native observations",
    });
    expect(list).not.toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("website-notifications-popover")).toHaveClass(
      "overflow-y-auto",
    );
    fireEvent.click(within(dialog).getByText("Advanced diagnostics"));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", {
          name: "Native WebView HTTP observations",
        }),
      ).toBeNull(),
    );
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Close website notifications",
      }),
    );
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: "Website notifications" }),
    ).toBeNull();
    vi.useRealTimers();
    await openPopup();
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
  });

  it("copies current filtered rows newest-first plus visible denials, and the portaled All filter explicitly includes IPC", async () => {
    render(<WebsiteNotifications mgr={manager()} />);
    const dialog = await openPopup();
    const list = await openAdvanced(dialog);
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(
      `POST ${PROXY}`,
    );
    expect(
      screen.getByRole("list", { name: "Blocked documents outside filter" }),
    ).toHaveTextContent(BLOCKED);
    const nativeRegion = screen.getByRole("region", {
      name: "Native WebView HTTP observations",
    });
    fireEvent.click(
      within(nativeRegion).getByRole("button", { name: "Copy diagnostics" }),
    );
    await waitFor(() => expect(fixture.writeText).toHaveBeenCalledTimes(1));
    const currentCopy = fixture.writeText.mock.calls[0][0] as string;
    expect(currentCopy).toContain("Displayed filter: current proxy origin");
    expect(currentCopy).toContain("not attributed to this tab");
    expect(currentCopy.indexOf(`5 | POST ${PROXY}`)).toBeLessThan(
      currentCopy.indexOf(`2 | GET ${PROXY}`),
    );
    expect(currentCopy).toContain(`4 | GET ${BLOCKED}`);
    expect(currentCopy).not.toContain(OTHER);
    expect(currentCopy).not.toContain("http://ipc.localhost");
    expect(currentCopy).not.toContain("private-");
    chooseFilter(dialog, "All, including app IPC");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(list).toHaveTextContent("http://ipc.localhost");
    expect(list).toHaveTextContent(OTHER);
    expect(
      screen.queryByRole("list", { name: "Blocked documents outside filter" }),
    ).toBeNull();
    fireEvent.click(
      within(nativeRegion).getByRole("button", { name: "Copy diagnostics" }),
    );
    await waitFor(() => expect(fixture.writeText).toHaveBeenCalledTimes(2));
    const allCopy = fixture.writeText.mock.calls[1][0] as string;
    expect(allCopy).toContain("Displayed filter: all, including app IPC");
    expect(allCopy).toContain("1 | POST http://ipc.localhost");
    expect(allCopy).toContain(OTHER);
    expect(allCopy).not.toContain("private-");
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
  });

  it("copies routing separately without native reads or the manager's secret-bearing URL", async () => {
    render(<WebsiteNotifications mgr={manager()} />);
    const dialog = await openPopup();
    const routing = within(dialog).getByRole("region", {
      name: "Website network restrictions",
    });
    fireEvent.click(
      within(routing).getByRole("button", { name: "Copy diagnostics" }),
    );
    await waitFor(() => expect(fixture.writeText).toHaveBeenCalledTimes(1));
    const text = fixture.writeText.mock.calls[0][0] as string;
    expect(text).toContain(
      "https://api.example.test | fetch | origin-not-approved",
    );
    expect(text).toContain("Native document navigation: enforced");
    expect(text).not.toContain("private-");
    expect(text).not.toContain("QuickConnect");
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it("discards an in-flight snapshot when the popup changes owner and does not expose old observations on reopen", async () => {
    let finish!: (value: ReturnType<typeof status>) => void;
    fixture.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const mgr = manager();
    const view = render(<WebsiteNotifications mgr={mgr} />);
    const dialog = await openPopup();
    fireEvent.click(within(dialog).getByText("Protection details"));
    fireEvent.click(within(dialog).getByText("Advanced diagnostics"));
    await waitFor(() => expect(fixture.invoke).toHaveBeenCalledTimes(1));
    const native = screen.getByRole("region", {
      name: "Native WebView HTTP observations",
    });
    expect(
      within(native).getByRole("button", { name: "Copy diagnostics" }),
    ).toBeDisabled();
    view.rerender(
      <WebsiteNotifications
        mgr={{
          ...mgr,
          session: { ...mgr.session, ownerDatabaseId: "database-b" },
          webProxyOrigin: OTHER,
        }}
      />,
    );
    await act(async () => {
      finish(status());
    });
    expect(
      screen.queryByRole("dialog", { name: "Website notifications" }),
    ).toBeNull();
    await openPopup();
    expect(
      screen.queryByRole("list", { name: "Filtered native observations" }),
    ).toBeNull();
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(fixture.writeText).not.toHaveBeenCalled();
  });
});
