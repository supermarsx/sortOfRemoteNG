import { describe, expect, it } from "vitest";
import {
  hasNoLiveTransport,
  isRestorableConnectionSession,
} from "../../src/utils/session/sessionClassification";

const binding = (status: "active" | "cleanup-pending" | "backend-closed") => ({
  ownerId: `owner-${status}`,
  backendSessionId: "native-1",
  protocol: "ssh" as const,
  status,
});

describe("hasNoLiveTransport", () => {
  it.each(["error", "connecting"] as const)(
    "is true for a %s session without VPN bindings",
    (status) => {
      expect(hasNoLiveTransport({ status })).toBe(true);
      expect(hasNoLiveTransport({ status, vpnLeaseBindings: [] })).toBe(true);
    },
  );

  it.each(["connected", "reconnecting", "disconnected"] as const)(
    "is false for a %s session (it is, or was, live)",
    (status) => {
      expect(hasNoLiveTransport({ status })).toBe(false);
    },
  );

  it("is false for an undefined status (defensive default: treat as live)", () => {
    expect(hasNoLiveTransport({})).toBe(false);
  });

  it("stays true when bindings are only cleanup-pending / backend-closed", () => {
    expect(
      hasNoLiveTransport({
        status: "error",
        vpnLeaseBindings: [
          binding("cleanup-pending"),
          binding("backend-closed"),
        ],
      }),
    ).toBe(true);
  });

  it("is false when any binding is active — a route is up, fail-closed applies", () => {
    expect(
      hasNoLiveTransport({
        status: "error",
        vpnLeaseBindings: [binding("backend-closed"), binding("active")],
      }),
    ).toBe(false);
    expect(
      hasNoLiveTransport({
        status: "connecting",
        vpnLeaseBindings: [binding("active")],
      }),
    ).toBe(false);
  });
});

describe("isRestorableConnectionSession — failed / ghost rows", () => {
  it("keeps connection and integration protocols restorable by default", () => {
    expect(isRestorableConnectionSession({ protocol: "ssh" })).toBe(true);
    expect(
      isRestorableConnectionSession({ protocol: "ssh", status: "connected" }),
    ).toBe(true);
    expect(
      isRestorableConnectionSession({ protocol: "rdp", status: "connecting" }),
    ).toBe(true);
    expect(
      isRestorableConnectionSession({
        protocol: "integration:netbox",
        status: "disconnected",
      }),
    ).toBe(true);
  });

  it("excludes a plain error session with no VPN cleanup evidence", () => {
    expect(
      isRestorableConnectionSession({ protocol: "ssh", status: "error" }),
    ).toBe(false);
    expect(
      isRestorableConnectionSession({
        protocol: "rdp",
        status: "error",
        vpnLeaseBindings: [],
        vpnLeaseOwnerIds: [],
      }),
    ).toBe(false);
  });

  it("keeps an error session that still carries VPN cleanup evidence", () => {
    expect(
      isRestorableConnectionSession({
        protocol: "ssh",
        status: "error",
        vpnLeaseBindings: [binding("cleanup-pending")],
      }),
    ).toBe(true);
    expect(
      isRestorableConnectionSession({
        protocol: "ssh",
        status: "error",
        vpnLeaseOwnerIds: ["owner-old"],
      }),
    ).toBe(true);
    expect(
      isRestorableConnectionSession({
        protocol: "ssh",
        status: "error",
        vpnLeaseReleaseTombstones: [{}],
      }),
    ).toBe(true);
    expect(
      isRestorableConnectionSession({
        protocol: "ssh",
        status: "error",
        vpnLeaseCleanupQuarantine: { proofs: [], proofIncomplete: true },
      }),
    ).toBe(true);
  });

  it("excludes a detached ghost that never had a live transport", () => {
    expect(
      isRestorableConnectionSession({
        protocol: "rdp",
        status: "connecting",
        layout: { isDetached: true },
      }),
    ).toBe(false);
    expect(
      isRestorableConnectionSession({
        protocol: "rdp",
        status: "error",
        layout: { isDetached: true },
        vpnLeaseBindings: [binding("cleanup-pending")],
      }),
    ).toBe(false);
  });

  it("keeps a detached row that is genuinely running in the background", () => {
    expect(
      isRestorableConnectionSession({
        protocol: "rdp",
        status: "connected",
        layout: { isDetached: true },
      }),
    ).toBe(true);
  });

  it("still excludes tool and winmgmt tabs regardless of status", () => {
    expect(
      isRestorableConnectionSession({
        protocol: "tool:settings",
        status: "connected",
      }),
    ).toBe(false);
    expect(
      isRestorableConnectionSession({
        protocol: "winmgmt:services",
        status: "connected",
      }),
    ).toBe(false);
  });
});
