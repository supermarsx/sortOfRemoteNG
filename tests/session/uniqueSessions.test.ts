import { describe, expect, it } from "vitest";
import { connectionReducer } from "../../src/contexts/ConnectionProvider";
import type { ConnectionState } from "../../src/contexts/ConnectionContextTypes";
import type { ConnectionSession } from "../../src/types/connection/connection";
import {
  dedupeTabLayout,
  uniqueSessionsById,
} from "../../src/utils/session/uniqueSessions";

const make = (id: string, name = id): ConnectionSession => ({
  id,
  connectionId: "c1",
  name,
  status: "connected",
  startTime: new Date("2026-11-17T00:00:00Z"),
  protocol: "ssh",
  hostname: "h",
});

const base = (sessions: ConnectionSession[]): ConnectionState => ({
  connections: [],
  sessions,
  selectedConnection: null,
  selectedConnectionIds: new Set(),
  filter: {
    searchTerm: "",
    protocols: [],
    tags: [],
    colorTags: [],
    showRecent: false,
    showFavorites: false,
    sortBy: "custom",
    sortDirection: "asc",
  },
  isLoading: false,
  sidebarCollapsed: false,
  tabGroups: [],
});

describe("duplicate session ids", () => {
  it("ADD_SESSION for an existing id upserts instead of appending", () => {
    // Two racing restore/adopt paths both pass a stale-ref guard and dispatch.
    let s = base([]);
    s = connectionReducer(s, { type: "ADD_SESSION", payload: make("a") });
    s = connectionReducer(s, { type: "ADD_SESSION", payload: make("b") });
    s = connectionReducer(s, {
      type: "ADD_SESSION",
      payload: make("a", "restored"),
    });
    expect(s.sessions.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.sessions[0].name).toBe("restored");
  });

  it("SET_SESSIONS collapses duplicate ids in the snapshot", () => {
    const s = connectionReducer(base([make("a")]), {
      type: "SET_SESSIONS",
      payload: [make("a"), make("b"), make("a", "newer")],
    });
    expect(s.sessions.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("uniqueSessionsById keeps identity when unique", () => {
    const list = [make("a"), make("b")];
    expect(uniqueSessionsById(list)).toBe(list);
    expect(uniqueSessionsById([...list, make("a")])).toHaveLength(2);
  });

  it("dedupeTabLayout drops repeated slot ids", () => {
    const pos = { x: 0, y: 0, width: 1, height: 1 };
    const layout = {
      mode: "grid2" as const,
      sessions: [
        { sessionId: "a", position: pos },
        { sessionId: "a", position: pos },
        { sessionId: "b", position: pos },
      ],
    };
    expect(dedupeTabLayout(layout).sessions.map((x) => x.sessionId)).toEqual([
      "a",
      "b",
    ]);
  });
});
