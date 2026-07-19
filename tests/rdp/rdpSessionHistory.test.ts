import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  resolveRdpHistoryConnection,
  type RDPSessionHistoryEntry,
} from "../../src/utils/rdp/rdpSessionHistory";

const HISTORY_ENTRY: RDPSessionHistoryEntry = {
  connectionId: "old-id",
  connectionName: "Production desktop",
  hostname: "Prod.Example.com",
  port: 3389,
  username: "alice",
  lastConnected: "2026-07-19T11:00:00.000Z",
  disconnectedAt: "2026-07-19T12:00:00.000Z",
  duration: 3600,
  desktopWidth: 1920,
  desktopHeight: 1080,
};

describe("resolveRdpHistoryConnection", () => {
  it("prefers the persisted connection ID", () => {
    const idMatch = {
      id: "old-id",
      name: "Renamed desktop",
      protocol: "rdp",
      hostname: "different.example.com",
      port: 3390,
    } as Connection;
    const targetMatch = {
      id: "new-id",
      name: "Recreated desktop",
      protocol: "rdp",
      hostname: "prod.example.com",
      port: 3389,
    } as Connection;

    expect(
      resolveRdpHistoryConnection(HISTORY_ENTRY, [targetMatch, idMatch]),
    ).toBe(idMatch);
  });

  it("falls back to a normalized RDP host and port after a connection is recreated", () => {
    const recreated = {
      id: "new-id",
      name: "Recreated desktop",
      protocol: "RDP",
      hostname: "  prod.example.com  ",
      port: 3389,
    } as unknown as Connection;
    const wrongProtocol = {
      ...recreated,
      id: "web-id",
      protocol: "http",
    } as Connection;

    expect(
      resolveRdpHistoryConnection(HISTORY_ENTRY, [wrongProtocol, recreated]),
    ).toBe(recreated);
  });

  it("rejects a stale ID collision with a non-RDP connection", () => {
    const idCollision = {
      id: "old-id",
      name: "Unrelated web connection",
      protocol: "http",
      hostname: "prod.example.com",
      port: 3389,
    } as Connection;

    expect(
      resolveRdpHistoryConnection(HISTORY_ENTRY, [idCollision]),
    ).toBeNull();
  });

  it("returns null when neither ID nor RDP target matches", () => {
    const otherRdp = {
      id: "other-id",
      name: "Other desktop",
      protocol: "rdp",
      hostname: "other.example.com",
      port: 3389,
    } as Connection;

    expect(resolveRdpHistoryConnection(HISTORY_ENTRY, [otherRdp])).toBeNull();
  });
});
