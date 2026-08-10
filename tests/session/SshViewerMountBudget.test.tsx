import { render, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabLayoutManager } from "../../src/components/session/TabLayoutManager";
import {
  HARD_MAX_MOUNTED_SSH_VIEWERS,
  normalizeMaxMountedSshViewers,
} from "../../src/hooks/session/useSshViewerMountBudget";
import { SshEventRouter } from "../../src/services/session/sshEventRouter";
import { TerminalOutputScheduler } from "../../src/services/session/terminalOutputScheduler";
import type {
  ConnectionSession,
  TabLayout,
} from "../../src/types/connection/connection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, variables?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
        String(variables?.[token] ?? `{{${token}}}`),
      ),
  }),
}));

vi.mock("react-resizable", () => ({
  Resizable: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const tabsLayout: TabLayout = { mode: "tabs", sessions: [] };

const makeSshSessions = (count: number): ConnectionSession[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `ssh-${index}`,
    connectionId: `connection-${index}`,
    name: `SSH ${index}`,
    status: "connected" as const,
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    protocol: "ssh",
    hostname: `host-${index}`,
    backendSessionId: `backend-${index}`,
    shellId: `shell-${index}`,
  }));

interface ResourceHarness {
  backendActors: Set<string>;
  router: SshEventRouter;
  scheduler: TerminalOutputScheduler;
  mounted: Set<string>;
  mountCounts: Map<string, number>;
  timers: number;
  observers: number;
  maximumMounted: number;
  maximumTimers: number;
  maximumObservers: number;
}

const createResourceHarness = (
  sessions: readonly ConnectionSession[],
): ResourceHarness => {
  const router = new SshEventRouter(async () => () => undefined);
  return {
    backendActors: new Set(
      sessions
        .map((session) => session.backendSessionId)
        .filter((id): id is string => Boolean(id)),
    ),
    router,
    scheduler: new TerminalOutputScheduler(),
    mounted: new Set(),
    mountCounts: new Map(),
    timers: 0,
    observers: 0,
    maximumMounted: 0,
    maximumTimers: 0,
    maximumObservers: 0,
  };
};

const ResourceTrackedWebTerminal = ({
  session,
  resource,
}: {
  session: ConnectionSession;
  resource: ResourceHarness;
}) => {
  useEffect(() => {
    resource.mounted.add(session.id);
    resource.mountCounts.set(
      session.id,
      (resource.mountCounts.get(session.id) ?? 0) + 1,
    );
    resource.timers++;
    resource.observers++;
    resource.maximumMounted = Math.max(
      resource.maximumMounted,
      resource.mounted.size,
    );
    resource.maximumTimers = Math.max(resource.maximumTimers, resource.timers);
    resource.maximumObservers = Math.max(
      resource.maximumObservers,
      resource.observers,
    );

    const registration = resource.scheduler.register(
      session.backendSessionId!,
      { write: vi.fn(), onGap: vi.fn() },
      { paused: true },
    );
    const unsubscribe = resource.router.subscribeActor(
      session.backendSessionId!,
      {
        onOutput: vi.fn(),
        onError: vi.fn(),
        onClosed: vi.fn(),
      },
    );
    return () => {
      unsubscribe();
      registration.dispose();
      resource.mounted.delete(session.id);
      resource.timers--;
      resource.observers--;
    };
  }, [resource, session.backendSessionId, session.id]);

  return <div data-testid={`web-terminal-viewer-${session.id}`} />;
};

interface ManagerHarnessProps {
  sessions: ConnectionSession[];
  activeSessionId: string;
  maxMountedSshViewers: number;
  layout?: TabLayout;
  resource?: ResourceHarness;
}

const ManagerHarness = ({
  sessions,
  activeSessionId,
  maxMountedSshViewers,
  layout = tabsLayout,
  resource,
}: ManagerHarnessProps) => (
  <TabLayoutManager
    sessions={sessions}
    activeSessionId={activeSessionId}
    layout={layout}
    onLayoutChange={vi.fn()}
    onSessionSelect={vi.fn()}
    onSessionClose={vi.fn()}
    onSessionDetach={vi.fn()}
    maxMountedSshViewers={maxMountedSshViewers}
    renderSession={(session) =>
      resource ? (
        <ResourceTrackedWebTerminal session={session} resource={resource} />
      ) : (
        <div data-testid={`viewer-${session.id}`} />
      )
    }
  />
);

const mountedViewerIds = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-testid^="web-terminal-viewer-"]')]
    .map((element) => element.getAttribute("data-testid")!)
    .map((testId) => testId.replace("web-terminal-viewer-", ""))
    .sort();

describe("SSH viewer mount budget", () => {
  it("normalizes the configurable budget to a deterministic 1..64 range", () => {
    expect(normalizeMaxMountedSshViewers(undefined)).toBe(32);
    expect(normalizeMaxMountedSshViewers(Number.NaN)).toBe(32);
    expect(normalizeMaxMountedSshViewers(0)).toBe(1);
    expect(normalizeMaxMountedSshViewers(12.9)).toBe(12);
    expect(normalizeMaxMountedSshViewers(10_000)).toBe(
      HARD_MAX_MOUNTED_SSH_VIEWERS,
    );
  });

  for (const sessionCount of [100, 500, 1_000]) {
    it(`bounds viewer resources for ${sessionCount} live SSH actors`, async () => {
      const sessions = makeSshSessions(sessionCount);
      const resource = createResourceHarness(sessions);
      const budget = 32;
      const lastSession = sessions[sessions.length - 1]!;
      const view = render(
        <StrictMode>
          <ManagerHarness
            sessions={sessions}
            activeSessionId={lastSession.id}
            maxMountedSshViewers={budget}
            resource={resource}
          />
        </StrictMode>,
      );

      await waitFor(() => {
        expect(resource.scheduler.diagnostics().registrations).toBe(budget);
        expect(resource.router.diagnostics()).toMatchObject({
          backendListeners: 3,
          subscribers: budget * 3,
        });
      });
      expect(mountedViewerIds(view.container)).toHaveLength(budget);
      expect(resource.mounted.size).toBe(budget);
      expect(resource.maximumMounted).toBeLessThanOrEqual(budget);
      expect(resource.timers).toBe(budget);
      expect(resource.maximumTimers).toBeLessThanOrEqual(budget);
      expect(resource.observers).toBe(budget);
      expect(resource.maximumObservers).toBeLessThanOrEqual(budget);
      expect(resource.backendActors.size).toBe(sessionCount);
      expect(resource.mounted).toContain(lastSession.id);

      view.unmount();
      await waitFor(() =>
        expect(resource.router.diagnostics().subscribers).toBe(0),
      );
      expect(resource.scheduler.diagnostics().registrations).toBe(0);
      expect(resource.timers).toBe(0);
      expect(resource.observers).toBe(0);
      expect(resource.backendActors.size).toBe(sessionCount);
      resource.router.dispose();
      resource.scheduler.dispose();
    });
  }

  it("uses MRU order when an evicted session becomes active", async () => {
    const sessions = makeSshSessions(3);
    const resource = createResourceHarness(sessions);
    const view = render(
      <ManagerHarness
        sessions={sessions}
        activeSessionId="ssh-0"
        maxMountedSshViewers={2}
        resource={resource}
      />,
    );
    expect(mountedViewerIds(view.container)).toEqual(["ssh-0", "ssh-1"]);

    view.rerender(
      <ManagerHarness
        sessions={sessions}
        activeSessionId="ssh-2"
        maxMountedSshViewers={2}
        resource={resource}
      />,
    );
    await waitFor(() =>
      expect(mountedViewerIds(view.container)).toEqual(["ssh-0", "ssh-2"]),
    );
    expect(resource.mountCounts.get("ssh-2")).toBe(1);
    expect(resource.backendActors.size).toBe(3);

    view.rerender(
      <ManagerHarness
        sessions={sessions}
        activeSessionId="ssh-1"
        maxMountedSshViewers={2}
        resource={resource}
      />,
    );
    await waitFor(() =>
      expect(mountedViewerIds(view.container)).toEqual(["ssh-1", "ssh-2"]),
    );
    expect(resource.backendActors.size).toBe(3);
    view.unmount();
    resource.router.dispose();
    resource.scheduler.dispose();
  });

  it("removes a closed session from MRU before the same id returns", async () => {
    const sessions = makeSshSessions(3);
    const resource = createResourceHarness(sessions);
    const view = render(
      <ManagerHarness
        sessions={sessions}
        activeSessionId="ssh-0"
        maxMountedSshViewers={2}
        resource={resource}
      />,
    );
    view.rerender(
      <ManagerHarness
        sessions={sessions}
        activeSessionId="ssh-2"
        maxMountedSshViewers={2}
        resource={resource}
      />,
    );
    await waitFor(() =>
      expect(mountedViewerIds(view.container)).toEqual(["ssh-0", "ssh-2"]),
    );

    const withoutClosed = sessions.filter((session) => session.id !== "ssh-2");
    view.rerender(
      <ManagerHarness
        sessions={withoutClosed}
        activeSessionId="ssh-0"
        maxMountedSshViewers={2}
        resource={resource}
      />,
    );
    await waitFor(() =>
      expect(mountedViewerIds(view.container)).toEqual(["ssh-0", "ssh-1"]),
    );
    view.rerender(
      <ManagerHarness
        sessions={sessions}
        activeSessionId="ssh-0"
        maxMountedSshViewers={2}
        resource={resource}
      />,
    );
    await waitFor(() =>
      expect(mountedViewerIds(view.container)).toEqual(["ssh-0", "ssh-1"]),
    );
    expect(resource.backendActors.size).toBe(3);
    view.unmount();
    resource.router.dispose();
    resource.scheduler.dispose();
  });

  it("always mounts active and visible established viewers even above budget", () => {
    const sessions = makeSshSessions(3);
    const tiledLayout: TabLayout = {
      mode: "grid4",
      sessions: [
        {
          sessionId: "ssh-0",
          position: { x: 0, y: 0, width: 50, height: 100 },
        },
        {
          sessionId: "ssh-1",
          position: { x: 50, y: 0, width: 50, height: 100 },
        },
      ],
    };
    const view = render(
      <ManagerHarness
        sessions={sessions}
        activeSessionId="ssh-2"
        maxMountedSshViewers={1}
        layout={tiledLayout}
      />,
    );
    expect(
      view.container.querySelectorAll('[data-testid^="viewer-"]'),
    ).toHaveLength(3);
  });

  it("does not evict connecting SSH or unaudited protocol viewers", () => {
    const sessions: ConnectionSession[] = [
      ...makeSshSessions(3),
      {
        ...makeSshSessions(1)[0],
        id: "ssh-connecting",
        connectionId: "connection-connecting",
        status: "connecting",
        backendSessionId: undefined,
        shellId: undefined,
      },
      {
        ...makeSshSessions(1)[0],
        id: "rdp-0",
        connectionId: "connection-rdp",
        protocol: "rdp",
      },
    ];
    const view = render(
      <ManagerHarness
        sessions={sessions}
        activeSessionId="ssh-0"
        maxMountedSshViewers={1}
      />,
    );
    const mounted = [
      ...view.container.querySelectorAll(
        '[data-session-viewer-state="mounted"]',
      ),
    ].map((element) => element.getAttribute("data-session-id"));
    expect(mounted).toEqual(
      expect.arrayContaining(["ssh-0", "ssh-connecting", "rdp-0"]),
    );
    expect(mounted).not.toContain("ssh-1");
    expect(mounted).not.toContain("ssh-2");
  });
});
