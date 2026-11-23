import { render } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabLayoutManager } from "../../src/components/session/TabLayoutManager";
import { useSessionRenderActivity } from "../../src/contexts/SessionRenderActivityContext";
import type {
  ConnectionSession,
  TabLayout,
} from "../../src/types/connection/connection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string = _key) => fallback,
  }),
}));
vi.mock("react-resizable", () => ({
  Resizable: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const make = (id: string, detached = false): ConnectionSession => ({
  id,
  connectionId: `connection-${id}`,
  name: id,
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "https",
  hostname: `${id}.example.test`,
  layout: detached
    ? { x: 0, y: 0, width: 100, height: 100, zIndex: 1, isDetached: true }
    : undefined,
});

const tabs: TabLayout = { mode: "tabs", sessions: [] };
const lifecycle = { mounts: 0, unmounts: 0 };

const Probe = ({ id }: { id: string }) => {
  const { isActive } = useSessionRenderActivity();
  useEffect(() => {
    lifecycle.mounts += 1;
    return () => {
      lifecycle.unmounts += 1;
    };
  }, []);
  return <div data-testid={`probe-${id}`}>{String(isActive)}</div>;
};

describe("TabLayoutManager hosted native pages", () => {
  const props = {
    layout: tabs,
    onLayoutChange: vi.fn(),
    onSessionSelect: vi.fn(),
    onSessionClose: vi.fn(),
    onSessionDetach: vi.fn(),
    renderSession: (session: ConnectionSession) => <Probe id={session.id} />,
  };

  it("keeps the viewer instance mounted, hidden and render-active when its tab detaches", () => {
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
    const view = render(
      <TabLayoutManager
        {...props}
        sessions={[make("page"), make("other")]}
        activeSessionId="page"
      />,
    );
    expect(lifecycle.mounts).toBe(2);
    // The page's tab leaves the main layout but its display request holds it.
    view.rerender(
      <TabLayoutManager
        {...props}
        sessions={[make("other")]}
        hostedSessions={[make("page", true)]}
        activeSessionId="other"
      />,
    );
    expect(lifecycle.mounts).toBe(2);
    expect(lifecycle.unmounts).toBe(0);
    expect(view.getByTestId("probe-page")).toHaveTextContent("true");
    const slot = view.container.querySelector("[data-session-id='page']");
    expect((slot as HTMLElement).style.visibility).toBe("hidden");
    expect((slot as HTMLElement).style.width).toBe("0px");
    // It is not an active tab: the other tab is the only one that shows.
    expect(view.getByTestId("probe-other")).toHaveTextContent("true");
  });

  it("returns to a normal tab on reattach without a remount, and unmounts when the host ends", () => {
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
    const view = render(
      <TabLayoutManager
        {...props}
        sessions={[make("other")]}
        hostedSessions={[make("page", true)]}
        activeSessionId="other"
      />,
    );
    expect(lifecycle.mounts).toBe(2);
    view.rerender(
      <TabLayoutManager
        {...props}
        sessions={[make("other"), make("page")]}
        activeSessionId="page"
      />,
    );
    expect(lifecycle.mounts).toBe(2);
    expect(lifecycle.unmounts).toBe(0);
    expect(view.getByTestId("probe-page")).toHaveTextContent("true");
    view.rerender(
      <TabLayoutManager
        {...props}
        sessions={[make("other")]}
        activeSessionId="other"
      />,
    );
    expect(lifecycle.unmounts).toBe(1);
  });
});
