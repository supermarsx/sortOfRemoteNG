import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SessionRenderActivityProvider } from "../../src/components/session/SessionRenderActivity";
import { useSessionRenderActivity } from "../../src/contexts/SessionRenderActivityContext";
import { TabLayoutManager } from "../../src/components/session/TabLayoutManager";
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

const sessions: ConnectionSession[] = ["one", "two"].map((id) => ({
  id,
  connectionId: `connection-${id}`,
  name: id,
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "ssh",
  hostname: `${id}.example.test`,
}));

const tabs: TabLayout = { mode: "tabs", sessions: [] };

const ActivityProbe = ({ sessionId }: { sessionId: string }) => {
  const { isActive } = useSessionRenderActivity();
  return <div data-testid={`activity-${sessionId}`}>{String(isActive)}</div>;
};

describe("SessionRenderActivity", () => {
  it("labels existing tab subtrees without changing their mount count", () => {
    const commonProps = {
      sessions,
      layout: tabs,
      onLayoutChange: vi.fn(),
      onSessionSelect: vi.fn(),
      onSessionClose: vi.fn(),
      onSessionDetach: vi.fn(),
      renderSession: (session: ConnectionSession) => (
        <ActivityProbe sessionId={session.id} />
      ),
    };
    const view = render(
      <TabLayoutManager {...commonProps} activeSessionId="one" />,
    );

    expect(view.getByTestId("activity-one")).toHaveTextContent("true");
    expect(view.getByTestId("activity-two")).toHaveTextContent("false");
    expect(
      view.container.querySelectorAll("[data-testid^='activity-']"),
    ).toHaveLength(2);

    view.rerender(<TabLayoutManager {...commonProps} activeSessionId="two" />);
    expect(view.getByTestId("activity-one")).toHaveTextContent("false");
    expect(view.getByTestId("activity-two")).toHaveTextContent("true");
    expect(
      view.container.querySelectorAll("[data-testid^='activity-']"),
    ).toHaveLength(2);
  });

  it("defaults detached or standalone viewers to active", () => {
    const view = render(<ActivityProbe sessionId="standalone" />);
    expect(view.getByTestId("activity-standalone")).toHaveTextContent("true");

    view.rerender(
      <SessionRenderActivityProvider isActive={false}>
        <ActivityProbe sessionId="standalone" />
      </SessionRenderActivityProvider>,
    );
    expect(view.getByTestId("activity-standalone")).toHaveTextContent("false");
  });
});
