/**
 * Mocked-invoke tests for the frontend half of session resilience: the unified
 * live-session registry call, the host heartbeat (claims + missing handling),
 * and the "Orphaned (live)" Session Manager rows.
 */
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));
vi.mock("../../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

import { listLiveSessions } from "../../../src/services/session/liveSessionRegistry";
import { planBootRestore } from "../../../src/services/session/bootRestorePlan";
import {
  buildSessionClaims,
  normalizeGraceSeconds,
} from "../../../src/services/session/sessionHostHeartbeat";
import {
  closeOrphanedLiveSession,
  computeOrphanedLiveSessions,
  resolveOrphanConnection,
} from "../../../src/services/session/orphanSessions";
import { SESSION_ENDED_WHILE_AWAY } from "../../../src/services/session/reconcileWorkspace";
import { serializePersistedConnectionSession } from "../../../src/utils/session/sessionPersistence";
import { useSessionHostHeartbeat } from "../../../src/hooks/session/useSessionHostHeartbeat";
import { OrphanedLiveSessions } from "../../../src/components/session/sessionManager/OrphanedLiveSessions";

const calls = (command: string) =>
  mocks.invoke.mock.calls.filter(([name]) => name === command);

const row = (
  protocol: string,
  backendSessionId: string,
  extra: Record<string, unknown> = {},
) => ({
  protocol,
  backendSessionId,
  frontendSessionId: null,
  connectionId: null,
  title: `${protocol}-title`,
  target: `${protocol}.example.test`,
  port: null,
  username: null,
  state: "connected",
  viewerAttached: null,
  createdAt: null,
  lastActivityAt: null,
  buffer: null,
  orphan: { claimed: true, unclaimedForSecs: 0, reapInSecs: null },
  ...extra,
});

const session = (
  id: string,
  protocol: string,
  backendSessionId?: string,
  status: ConnectionSession["status"] = "connected",
): ConnectionSession => ({
  id,
  connectionId: `conn-${id}`,
  name: id,
  status,
  startTime: new Date(0),
  protocol,
  hostname: `${protocol}.example.test`,
  backendSessionId,
});

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("unified live-session registry", () => {
  it("lists ssh/rdp/vnc/telnet/serial through ONE list_live_sessions call", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== "list_live_sessions") {
        throw new Error(`unexpected ${command}`);
      }
      return [
        row("ssh", "s1", { port: 22, username: "root" }),
        row("rdp", "r1", { state: "detached", connectionId: "c-r" }),
        row("vnc", "v1"),
        row("telnet", "t1", {
          buffer: {
            generation: 3,
            sequenceStart: 0,
            sequenceEnd: 44,
            droppedBytes: 0,
          },
        }),
        row("serial", "se1", { state: "disconnected" }),
      ];
    });
    const live = await listLiveSessions();
    expect(mocks.invoke.mock.calls.map(([name]) => name)).toEqual([
      "list_live_sessions",
    ]);
    expect(live.map((d) => [d.protocol, d.backendSessionId, d.alive])).toEqual([
      ["ssh", "s1", true],
      ["rdp", "r1", true], // detached is still adoptable
      ["vnc", "v1", true],
      ["telnet", "t1", true],
      ["serial", "se1", false], // dropped but not yet pruned
    ]);
    expect(live[3].buffer).toEqual({ generation: 3, sequenceEnd: 44 });
    expect(live[0]).toMatchObject({ host: "ssh.example.test", port: 22 });
  });

  it("falls back to the per-protocol commands when the registry is unavailable", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_live_sessions") throw new Error("unknown command");
      if (command === "list_sessions")
        return [{ id: "s1", is_alive: true, config: { host: "h" } }];
      if (command === "list_rdp_sessions") return [];
      throw new Error(`unexpected ${command}`);
    });
    const live = await listLiveSessions();
    expect(live.map((d) => d.backendSessionId)).toEqual(["s1"]);
  });

  it("boot reconciliation adopts a live telnet/serial/vnc tab and flags the dead one", () => {
    const rows = ["telnet", "serial", "vnc", "telnet"].map((protocol, i) =>
      serializePersistedConnectionSession(
        session(`tab-${i}`, protocol, `b-${i}`),
      ),
    );
    // Persistence now keeps the backend id for these protocols.
    expect(rows.map((r) => r.backendSessionId)).toEqual([
      "b-0",
      "b-1",
      "b-2",
      "b-3",
    ]);
    const plan = planBootRestore({
      rows,
      live: [
        { protocol: "telnet", backendSessionId: "b-0", alive: true },
        { protocol: "serial", backendSessionId: "b-1", alive: true },
        { protocol: "vnc", backendSessionId: "b-2", alive: true },
      ],
      reconnectOnReload: true,
      adoptLiveSessions: true,
      isQuarantined: () => false,
    });
    expect(plan.adoptedTabIds).toEqual(["tab-0", "tab-1", "tab-2"]);
    expect(plan.rows.find((r) => r.id === "tab-3")?.backendSessionId).toBe(
      undefined,
    );
  });
});

describe("session host heartbeat", () => {
  it("claims every held backend session (hidden tabs included) in a stable order", () => {
    const claims = buildSessionClaims([
      session("b", "telnet", "t-2"),
      session("a", "ssh", "s-1", "disconnected"), // restored row awaiting adoption
      session("c", "web"), // not a backend protocol
      session("d", "rdp"), // no backend id yet
      session("e", "telnet", "t-2"), // duplicate id
    ]);
    expect(claims).toEqual([
      { protocol: "ssh", backendSessionId: "s-1", frontendSessionId: "a" },
      { protocol: "telnet", backendSessionId: "t-2", frontendSessionId: "b" },
    ]);
  });

  it("normalizes the grace setting (0 disables, NaN falls back to 300)", () => {
    expect(normalizeGraceSeconds(0)).toBe(0);
    expect(normalizeGraceSeconds(90.7)).toBe(90);
    expect(normalizeGraceSeconds(10_000_000)).toBe(86_400);
    expect(normalizeGraceSeconds(Number.NaN)).toBe(300);
    expect(normalizeGraceSeconds(undefined)).toBe(300);
  });

  it("sends claims right away and on the interval, and marks missing tabs dead", async () => {
    vi.useFakeTimers();
    const sessions = [
      session("tab-1", "telnet", "t-1"),
      session("tab-2", "ssh", "s-1"),
    ];
    mocks.useConnections.mockReturnValue({
      state: { connections: [], sessions },
      dispatch: mocks.dispatch,
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== "session_host_heartbeat") return undefined;
      return {
        graceSeconds: 300,
        reaperEnabled: true,
        heartbeatIntervalMs: 5000,
        missing: [{ protocol: "ssh", backendSessionId: "s-1" }],
      };
    });
    renderHook(() => useSessionHostHeartbeat());
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls("session_host_heartbeat")).toHaveLength(1);
    expect(calls("session_host_heartbeat")[0][1]).toEqual({
      sessions: [
        {
          protocol: "ssh",
          backendSessionId: "s-1",
          frontendSessionId: "tab-2",
        },
        {
          protocol: "telnet",
          backendSessionId: "t-1",
          frontendSessionId: "tab-1",
        },
      ],
      graceSeconds: 300,
    });
    // Only the missing tab is marked dead, with the reconnect explanation.
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "tab-2",
        status: "disconnected",
        backendSessionId: undefined,
        errorMessage: SESSION_ENDED_WHILE_AWAY,
      }),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(calls("session_host_heartbeat").length).toBeGreaterThanOrEqual(2);
  });

  it("does not heartbeat on boot until a session is claimed, then keeps the interval", async () => {
    vi.useFakeTimers();
    mocks.useConnections.mockReturnValue({
      state: { connections: [], sessions: [] },
      dispatch: mocks.dispatch,
    });
    mocks.invoke.mockResolvedValue(undefined); // old backend: no ack
    renderHook(() => useSessionHostHeartbeat());
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls("session_host_heartbeat")).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(calls("session_host_heartbeat")).toHaveLength(1);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe("Orphaned (live) rows", () => {
  const savedTelnet: Connection = {
    id: "saved-telnet",
    name: "Switch",
    protocol: "telnet",
    hostname: "telnet.example.test",
    port: 23,
    isGroup: false,
    createdAt: "",
    updatedAt: "",
  };

  const live = [
    {
      protocol: "telnet",
      backendSessionId: "t-orphan",
      alive: true,
      host: "telnet.example.test",
      port: 23,
      title: "switch",
      orphan: { claimed: false, unclaimedForSecs: 40, reapInSecs: 260 },
    },
    {
      protocol: "serial",
      backendSessionId: "se-orphan",
      alive: true,
      host: "COM9",
    },
    {
      protocol: "ssh",
      backendSessionId: "s-owned",
      alive: true,
      host: "ssh.example.test",
    },
    {
      protocol: "vnc",
      backendSessionId: "v-other-window",
      alive: true,
      orphan: { claimed: true, unclaimedForSecs: 0, reapInSecs: null },
    },
  ];

  it("computes orphans: not owned by a tab, not claimed by another window", () => {
    const orphans = computeOrphanedLiveSessions(
      [session("tab", "ssh", "s-owned")],
      live,
    );
    expect(orphans.map((o) => o.backendSessionId)).toEqual([
      "t-orphan",
      "se-orphan",
    ]);
  });

  it("resolves a connection only unambiguously", () => {
    const twin = { ...savedTelnet, id: "twin" };
    expect(resolveOrphanConnection(live[0], [savedTelnet])?.id).toBe(
      "saved-telnet",
    );
    expect(resolveOrphanConnection(live[0], [savedTelnet, twin])).toBeNull();
    expect(resolveOrphanConnection(live[1], [savedTelnet])).toBeNull();
  });

  it("shows Adopt only when applicable, Close always, and wires both actions", () => {
    const onAdopt = vi.fn();
    const onClose = vi.fn();
    const orphans = computeOrphanedLiveSessions([], live).slice(0, 2);
    const view = render(
      <OrphanedLiveSessions
        orphans={orphans}
        connections={[savedTelnet]}
        onAdopt={onAdopt}
        onClose={onClose}
      />,
    );
    expect(view.getAllByTestId("orphaned-live-row")).toHaveLength(2);
    expect(view.getAllByTestId("orphaned-live-adopt")).toHaveLength(1);
    expect(view.getAllByTestId("orphaned-live-close")).toHaveLength(2);
    expect(view.getByText(/closes in 260s/)).toBeTruthy();
    fireEvent.click(view.getByTestId("orphaned-live-adopt"));
    expect(onAdopt).toHaveBeenCalledWith(orphans[0], savedTelnet);
    fireEvent.click(view.getAllByTestId("orphaned-live-close")[1]);
    expect(onClose).toHaveBeenCalledWith(orphans[1]);
  });

  it("renders nothing without orphans", () => {
    const view = render(
      <OrphanedLiveSessions
        orphans={[]}
        connections={[]}
        onAdopt={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(view.container.innerHTML).toBe("");
  });

  it("closes each protocol through its normal disconnect command", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    for (const [protocol, command] of [
      ["ssh", "disconnect_ssh"],
      ["rdp", "disconnect_rdp"],
      ["vnc", "disconnect_vnc"],
      ["telnet", "disconnect_telnet"],
      ["serial", "serial_disconnect"],
    ] as const) {
      await closeOrphanedLiveSession({
        protocol,
        backendSessionId: `${protocol}-1`,
        alive: true,
      });
      expect(mocks.invoke).toHaveBeenLastCalledWith(command, {
        sessionId: `${protocol}-1`,
      });
    }
    await expect(
      closeOrphanedLiveSession({
        protocol: "web",
        backendSessionId: "x",
        alive: true,
      }),
    ).rejects.toThrow(/Cannot close/);
  });
});
