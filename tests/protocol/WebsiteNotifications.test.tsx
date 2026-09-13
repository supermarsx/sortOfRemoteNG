import type { ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebsiteNotifications from "../../src/components/protocol/webBrowser/WebsiteNotifications";

const observation = vi.hoisted(() => ({ mounted: vi.fn() }));
vi.mock(
  "../../src/components/protocol/webBrowser/NativeHttpObservations",
  () => ({
    default: ({ active }: { active: boolean }) => {
      observation.mounted(active);
      return <div data-testid="observation" data-active={active} />;
    },
  }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Manager = ComponentProps<typeof WebsiteNotifications>["mgr"];
function manager(overrides: Partial<Manager> = {}): Manager {
  return {
    session: { id: "website-a", ownerDatabaseId: "database-a" },
    currentUrl: "https://website.example/login",
    webProxyOrigin: "http://p0123456789abcdef0123456789abcdef.localhost:43123",
    webNetworkReports: [],
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
      url: "https://website.example/login",
    },
    openingApplicationExternal: false,
    handleOpenApplicationExternal: vi.fn(async () => undefined),
    automation: {
      error: null,
      busy: false,
      reload: vi.fn(async () => undefined),
      recordingScopeKey: "database-a:1",
    },
    ...overrides,
  };
}
async function open() {
  fireEvent.click(
    screen.getByRole("button", { name: "Website notifications" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Website notifications",
  });
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}
describe("website notifications popover", () => {
  it("shows only a neutral toolbar icon until opened, with real guidance and no observation activity", async () => {
    render(<WebsiteNotifications mgr={manager()} />);
    const button = screen.getByRole("button", {
      name: "Website notifications",
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveClass("text-warning");
    expect(screen.queryByText(/Website proxy routing/)).toBeNull();
    expect(screen.queryByText(/Sign-in & 2FA help/)).toBeNull();
    expect(observation.mounted).not.toHaveBeenCalled();
    const dialog = await open();
    expect(button).toHaveAttribute("aria-controls", dialog.id);
    expect(
      within(dialog).getByText(/partial browser enforcement/),
    ).toBeVisible();
    expect(screen.getByTestId("observation")).toHaveAttribute(
      "data-active",
      "false",
    );
    fireEvent.click(within(dialog).getByText("Protection details"));
    await waitFor(() =>
      expect(screen.getByTestId("observation")).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(
      within(dialog).getByText(
        /Browser-wide network interception is not yet enforced/,
      ),
    ).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
    const reopened = await open();
    expect(within(reopened).getByTestId("observation")).toHaveAttribute(
      "data-active",
      "false",
    );
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows the independent external route/session warning before explicit browser launch", async () => {
    const mgr = manager();
    render(<WebsiteNotifications mgr={mgr} />);
    const dialog = await open();
    fireEvent.click(within(dialog).getByText("Website · Sign-in & 2FA help"));
    const warning = within(dialog).getByText(
      /separate cookies and its own network route/,
    );
    const launch = within(dialog).getByRole("button", {
      name: "Open Website in system browser",
    });
    expect(warning).toBeVisible();
    expect(
      warning.compareDocumentPosition(launch) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mgr.handleOpenApplicationExternal).not.toHaveBeenCalled();
    fireEvent.click(launch);
    expect(mgr.handleOpenApplicationExternal).toHaveBeenCalledOnce();
  });
  it("badges actual failures without auto-dismiss and keeps reload explicit", async () => {
    const mgr = manager({
      webNetworkReports: [
        { kind: "document", reason: "document-expired", origin: null },
      ],
      automation: {
        error: "The app-wide library encryption is locked.",
        busy: false,
        reload: vi.fn(async () => undefined),
        recordingScopeKey: "database-a:1",
      },
    });
    render(<WebsiteNotifications mgr={mgr} />);
    expect(screen.getByLabelText("2 website issues")).toBeVisible();
    let dialog = await open();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /encryption is locked/,
    );
    expect(mgr.automation.reload).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reload library" }),
    );
    await waitFor(() => expect(mgr.automation.reload).toHaveBeenCalledOnce());
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reload page" }),
    );
    expect(mgr.handleRefresh).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByLabelText("2 website issues")).toBeVisible();
    dialog = await open();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /encryption is locked/,
    );
  });
  it.each(["proxy", "owner", "page"] as const)(
    "closes source-specific popup on %s changes and does not resurrect it after ABA",
    async (kind) => {
      const original = manager();
      const view = render(<WebsiteNotifications mgr={original} />);
      await open();
      const next =
        kind === "proxy"
          ? {
              ...original,
              webProxyOrigin:
                "http://p11111111111111111111111111111111.localhost:43124",
            }
          : kind === "owner"
            ? {
                ...original,
                session: { ...original.session, ownerDatabaseId: "database-b" },
              }
            : { ...original, currentUrl: "https://website.example/other" };
      view.rerender(<WebsiteNotifications mgr={next} />);
      expect(screen.queryByRole("dialog")).toBeNull();
      view.rerender(<WebsiteNotifications mgr={original} />);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByTestId("observation")).toBeNull();
    },
  );
  it.each(["missing", "mismatch"] as const)(
    "badges %s module diagnostics, not ordinary platform limitations or initialization",
    async (status) => {
      const original = manager();
      const view = render(
        <WebsiteNotifications
          mgr={{
            ...original,
            webNetworkGuard: {
              platform: "windows",
              frameNavigation: "initializing",
              allNetworkRequestsMediated: false,
            },
          }}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Website notifications" }),
      ).not.toHaveClass("text-warning");
      view.rerender(
        <WebsiteNotifications
          mgr={{
            ...original,
            webNetworkRouting: { ...original.webNetworkRouting!, status },
          }}
        />,
      );
      expect(screen.getByLabelText("1 website issue")).toBeVisible();
      const dialog = await open();
      expect(
        within(dialog).getByText(
          status === "missing"
            ? "Page routing module is not confirmed"
            : "Page routing settings do not match this connection",
        ),
      ).toBeVisible();
    },
  );
});
