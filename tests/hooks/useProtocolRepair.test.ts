import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import {
  buildRepairPatch,
  buildRepairSuggestions,
  readIgnoredIds,
  useProtocolRepair,
  PROTOCOL_REPAIR_IGNORED_KEY,
} from "../../src/hooks/connection/useProtocolRepair";

function conn(partial: Partial<Connection> & { id: string }): Connection {
  return {
    name: partial.id,
    protocol: "rdp",
    hostname: "host.local",
    port: 3389,
    isGroup: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Connection;
}

const fixtures: Connection[] = [
  conn({ id: "web443", name: "Portal", protocol: "rdp", port: 443 }),
  conn({
    id: "urlhost",
    name: "Router",
    protocol: "rdp",
    hostname: "http://router.local/admin",
    port: 3389,
  }),
  conn({ id: "realrdp", name: "Desktop", protocol: "rdp", port: 3389 }),
  conn({ id: "ssh", name: "Shell", protocol: "ssh", port: 22 }),
  conn({
    id: "group",
    name: "Folder",
    protocol: "rdp",
    port: 443,
    isGroup: true,
  }),
];

function wrapperFor(connections: Connection[], dispatch = vi.fn()) {
  const value = {
    state: { connections },
    dispatch,
  } as unknown as ConnectionContextType;
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(ConnectionContext.Provider, { value }, children);
  return { Wrapper, dispatch };
}

describe("buildRepairSuggestions", () => {
  it("flags rdp+443 and rdp+http:// hostnames but not real rdp, ssh or groups", () => {
    const out = buildRepairSuggestions(fixtures);
    expect(out.map((s) => s.id)).toEqual(["web443", "urlhost"]);
    expect(out[0].suggestedProtocol).toBe("https");
    expect(out[0].patch).toEqual({
      protocol: "https",
      port: 443,
      hostname: "host.local",
    });
    expect(out[1].suggestedProtocol).toBe("http");
    expect(out[1].patch).toEqual({
      protocol: "http",
      port: 80,
      hostname: "router.local",
    });
    expect(out[1].reason).toMatch(/http:\/\//);
  });

  it("skips ignored ids", () => {
    const out = buildRepairSuggestions(fixtures, new Set(["web443"]));
    expect(out.map((s) => s.id)).toEqual(["urlhost"]);
  });

  it("returns nothing when nothing is suspicious", () => {
    expect(buildRepairSuggestions([fixtures[2], fixtures[3]])).toEqual([]);
    expect(buildRepairSuggestions(undefined)).toEqual([]);
  });

  it("tolerates partial records without a protocol", () => {
    expect(
      buildRepairSuggestions([{ id: "x", name: "X" } as Connection]),
    ).toEqual([]);
  });
});

describe("buildRepairPatch", () => {
  it("uses the port embedded in the URL and strips the scheme/path", () => {
    expect(
      buildRepairPatch(
        { protocol: "rdp", hostname: "https://portal:8443/login", port: 3389 },
        "https",
      ),
    ).toEqual({ protocol: "https", port: 8443, hostname: "portal" });
  });

  it("keeps an explicit web port", () => {
    expect(
      buildRepairPatch({ protocol: "rdp", hostname: "h", port: 8080 }, "http")
        .port,
    ).toBe(8080);
  });

  it("replaces 3389 with the suggested default port", () => {
    expect(
      buildRepairPatch({ protocol: "rdp", hostname: "h", port: 3389 }, "https")
        .port,
    ).toBe(443);
  });
});

describe("useProtocolRepair", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns no suggestions outside a ConnectionProvider", () => {
    const { result } = renderHook(() => useProtocolRepair());
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.applyFixes(["web443"])).toBe(0);
  });

  it("applyFixes updates only the chosen rows", () => {
    const { Wrapper, dispatch } = wrapperFor(fixtures);
    const { result } = renderHook(() => useProtocolRepair(), {
      wrapper: Wrapper,
    });
    expect(result.current.suggestions).toHaveLength(2);

    let applied = 0;
    act(() => {
      applied = result.current.applyFixes(["urlhost"]);
    });
    expect(applied).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe("UPDATE_CONNECTION");
    expect(action.payload).toMatchObject({
      id: "urlhost",
      name: "Router",
      protocol: "http",
      port: 80,
      hostname: "router.local",
    });
    expect(action.payload.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("ignores unknown ids and non-suspicious ids", () => {
    const { Wrapper, dispatch } = wrapperFor(fixtures);
    const { result } = renderHook(() => useProtocolRepair(), {
      wrapper: Wrapper,
    });
    act(() => {
      expect(result.current.applyFixes(["realrdp", "nope"])).toBe(0);
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dismiss persists in localStorage and survives a remount", () => {
    const { Wrapper } = wrapperFor(fixtures);
    const first = renderHook(() => useProtocolRepair(), { wrapper: Wrapper });
    act(() => first.result.current.ignore("web443"));
    expect(first.result.current.suggestions.map((s) => s.id)).toEqual([
      "urlhost",
    ]);
    expect(first.result.current.ignoredCount).toBe(1);
    expect(
      JSON.parse(window.localStorage.getItem(PROTOCOL_REPAIR_IGNORED_KEY)!),
    ).toEqual(["web443"]);
    first.unmount();

    const second = renderHook(() => useProtocolRepair(), { wrapper: Wrapper });
    expect(second.result.current.suggestions.map((s) => s.id)).toEqual([
      "urlhost",
    ]);

    act(() => second.result.current.resetIgnored());
    expect(second.result.current.suggestions).toHaveLength(2);
    expect(readIgnoredIds().size).toBe(0);
    expect(window.localStorage.getItem(PROTOCOL_REPAIR_IGNORED_KEY)).toBeNull();
  });

  it("is a no-op when nothing is suspicious", () => {
    const { Wrapper, dispatch } = wrapperFor([fixtures[2], fixtures[3]]);
    const { result } = renderHook(() => useProtocolRepair(), {
      wrapper: Wrapper,
    });
    expect(result.current.suggestions).toEqual([]);
    act(() => {
      expect(result.current.applyFixes(["realrdp", "ssh"])).toBe(0);
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("survives corrupt ignore-list storage", () => {
    window.localStorage.setItem(PROTOCOL_REPAIR_IGNORED_KEY, "{not json");
    expect(readIgnoredIds().size).toBe(0);
  });
});
