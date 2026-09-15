import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SynologyAccountAccess from "../../src/components/synology/synologyPanel/SynologyAccountAccess";
import type { SubProps } from "../../src/components/synology/synologyPanel/types";
import type { SynologyTab } from "../../src/hooks/synology/synologyAdminData";
import type { SynologySectionAccess } from "../../src/hooks/synology/useSynologySectionAccess";
import {
  SYNOLOGY_SECTION_READS,
  type SynologyAccountAccess as Account,
  type SynologyReadState,
} from "../../src/utils/synology/synologyAccess";
import { SYNOLOGY_SECTION_LABELS } from "../../src/utils/synology/synologySectionLabels";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

const HOST = "nas-7f3a.example.com";
const QC_HOST = "my-nas.de3.quickconnect.to";
const SID = "sid-Zx81VqLmP0";
const TOKEN = "syno-token-4Kq9";
const DEVICE_ID = "did-8c1f0e2a";
const account = (overrides: Partial<Account> = {}): Account => ({
  signedInAs: "nas-admin",
  role: "administrator",
  portalSession: false,
  sessionName: "FileStation",
  loginHandshake: "ik",
  authVersion: 7,
  route: "quickconnect_relay",
  secondFactor: "otp",
  ...overrides,
});
const entry = (
  section: SynologyTab,
  identity: Account | null,
  states: Partial<Record<string, SynologyReadState>> = {},
): SynologySectionAccess => {
  const reads = SYNOLOGY_SECTION_READS[section].map((field) => ({
    field,
    api:
      field === "utilization"
        ? "SYNO.Core.System.Utilization"
        : field === "users"
          ? "SYNO.Core.User"
          : "SYNO.DSM.Info",
    state: states[field] ?? ("available" as SynologyReadState),
    // Native reasons are never copied; prove it with private-looking text.
    reason: `Checked against ${HOST} with ${SID}`,
  }));
  const restricted = reads.some((read) => read.state !== "available");
  return {
    section,
    status: restricted ? "partial" : "available",
    requirement: restricted ? "session" : null,
    reason: `Reason mentioning https://${HOST}:5001/webapi and ${TOKEN}`,
    account: identity,
    reads,
  };
};
function manager({
  identity = account(),
  states = {},
  reconnect = vi.fn(),
  checking = false,
}: {
  identity?: Account | null;
  states?: Partial<Record<string, SynologyReadState>>;
  reconnect?: ReturnType<typeof vi.fn> | null;
  checking?: boolean;
} = {}) {
  const entries = Object.fromEntries(
    (Object.keys(SYNOLOGY_SECTION_LABELS) as SynologyTab[]).map((section) => [
      section,
      entry(section, identity, states),
    ]),
  );
  return {
    host: HOST,
    port: "5001",
    username: "nas-admin",
    password: "hunter2-password",
    sessionId: SID,
    instanceId: `instance-${TOKEN}`,
    quickConnectId: QC_HOST,
    deviceId: DEVICE_ID,
    ...(reconnect ? { reconnect } : {}),
    sectionAccess: {
      entries,
      account: identity,
      active: true,
      checking,
      recheck: vi.fn(),
    },
  } as unknown as SubProps["mgr"] & { reconnect?: ReturnType<typeof vi.fn> };
}
const panel = () => screen.getByTestId("synology-account-access");
const identityText = () =>
  screen.getByTestId("synology-account-identity").textContent;

describe("NAS API session identity panel", () => {
  it("spells out who is signed in and how the session was opened", () => {
    render(<SynologyAccountAccess mgr={manager()} />);
    expect(panel()).toHaveAccessibleName("NAS API session");
    expect(identityText()).toBe(
      "Signed in as nas-admin · Administrator: yes · Session: FileStation · Login handshake: DSM 7 secure (IK) · Route: QuickConnect relay · 2FA: one-time code",
    );
    expect(panel()).toHaveAttribute("data-tone", "neutral");
    expect(screen.queryByTestId("synology-account-notice")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reconnect/ })).toBeNull();
  });
  it.each([
    [{ role: "administrator" }, "Administrator: yes"],
    [{ role: "standard" }, "Administrator: no ·"],
    [{ role: "unknown" }, "Administrator: unknown (DSM did not report it)"],
    [{ sessionName: "FileStation" }, "Session: FileStation ·"],
    [{ sessionName: "webui" }, "Session: DSM desktop (webui)"],
    [{ portalSession: true }, "Session: FileStation (application portal)"],
    [{ loginHandshake: "ik" }, "Login handshake: DSM 7 secure (IK)"],
    [
      { loginHandshake: "ik_incomplete" },
      "Login handshake: DSM 7 secure, incomplete",
    ],
    [{ loginHandshake: "legacy" }, "Login handshake: legacy ·"],
    [
      { loginHandshake: "legacy_unavailable" },
      "Login handshake: legacy (secure handshake unavailable)",
    ],
    [{ route: "direct" }, "Route: Direct"],
    [{ route: "http_proxy" }, "Route: HTTP proxy"],
    [{ route: "quickconnect_relay" }, "Route: QuickConnect relay"],
    [{ route: "quickconnect_direct" }, "Route: QuickConnect direct"],
    [{ secondFactor: "none" }, "2FA: none"],
    [{ secondFactor: "otp" }, "2FA: one-time code"],
    [{ secondFactor: "trusted_device" }, "2FA: trusted device"],
  ] as [Partial<Account>, string][])(
    "renders %j as %s",
    (overrides, expected) => {
      render(
        <SynologyAccountAccess
          mgr={manager({ identity: account(overrides) })}
        />,
      );
      expect(identityText()).toContain(expected);
      expect(identityText()).toMatch(/^Signed in as nas-admin · /);
    },
  );
  it("infers delegated administration when DSM does not report the role", () => {
    const mgr = manager({
      identity: account({ role: "unknown" }),
      states: {
        users: "requires_administrator",
        groups: "requires_administrator",
      },
    });
    render(<SynologyAccountAccess mgr={mgr} />);
    expect(identityText()).toContain(
      "Administrator: no (delegated administration)",
    );
    expect(screen.getByTestId("synology-account-notice")).toHaveTextContent(
      "Administrator-only data is hidden for this account.",
    );
    expect(panel()).toHaveAttribute("data-tone", "neutral");
  });
  it("explains hidden administrator data for a standard account without offering reconnect", () => {
    render(
      <SynologyAccountAccess
        mgr={manager({
          identity: account({ role: "standard" }),
          states: { utilization: "requires_administrator" },
        })}
      />,
    );
    expect(screen.getByTestId("synology-account-notice")).toHaveTextContent(
      "Administrator-only data is hidden for this account.",
    );
    expect(screen.queryByRole("button", { name: /Reconnect/ })).toBeNull();
  });
  it("warns an administrator in a restricted IK session and offers both reconnect actions", () => {
    const mgr = manager({ states: { utilization: "session_restricted" } });
    render(<SynologyAccountAccess mgr={mgr} />);
    expect(panel()).toHaveAttribute("data-tone", "warning");
    expect(panel()).toHaveClass("bg-warning/10");
    expect(screen.getByTestId("synology-account-notice")).toHaveTextContent(
      "Use Reconnect as DSM session, then recheck access.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect as DSM session" }),
    );
    expect(mgr.reconnect).toHaveBeenCalledWith({
      sessionProfile: "dsm_desktop",
    });
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(mgr.reconnect).toHaveBeenCalledTimes(2);
    expect(mgr.reconnect).toHaveBeenLastCalledWith();
    expect(screen.getByTestId("synology-reconnect")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Hide session details" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
  it.each([
    [{ loginHandshake: "legacy" }, "without DSM 7's secure login handshake"],
    [
      { loginHandshake: "legacy_unavailable" },
      "without DSM 7's secure login handshake",
    ],
    [
      { loginHandshake: "ik_incomplete" },
      "without DSM 7's secure login handshake",
    ],
    [
      { sessionName: "webui" },
      "still restricts some data for this DSM session",
    ],
    [
      { portalSession: true, role: "unknown" },
      "opened through a DSM application portal",
    ],
  ] as [Partial<Account>, string][])(
    "hides Reconnect as DSM session for %j",
    (overrides, notice) => {
      const mgr = manager({
        identity: account(overrides),
        states: { utilization: "session_restricted" },
      });
      render(<SynologyAccountAccess mgr={mgr} />);
      expect(panel()).toHaveAttribute("data-tone", "warning");
      expect(screen.getByTestId("synology-account-notice")).toHaveTextContent(
        notice,
      );
      expect(
        screen.queryByRole("button", { name: "Reconnect as DSM session" }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
      expect(mgr.reconnect).toHaveBeenCalledOnce();
    },
  );
  it("does not warn when a restricted session belongs to a non-administrator", () => {
    render(
      <SynologyAccountAccess
        mgr={manager({
          identity: account({ role: "standard" }),
          states: { utilization: "session_restricted" },
        })}
      />,
    );
    expect(panel()).toHaveAttribute("data-tone", "neutral");
    expect(screen.queryByRole("button", { name: /Reconnect/ })).toBeNull();
  });
  it("disables reconnect actions until the connection exposes reconnect", () => {
    render(
      <SynologyAccountAccess
        mgr={manager({
          reconnect: null,
          states: { utilization: "session_restricted" },
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Reconnect as DSM session" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDisabled();
  });
  it("keeps a rejected reconnect from escaping as an unhandled rejection", async () => {
    const reconnect = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <SynologyAccountAccess
        mgr={manager({
          reconnect,
          states: { utilization: "session_restricted" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
  });
  it("explains a missing identity while checking and after a legacy backend", () => {
    const { unmount } = render(
      <SynologyAccountAccess
        mgr={manager({ identity: null, checking: true })}
      />,
    );
    expect(panel()).toHaveTextContent(
      "Session details appear after the first section check.",
    );
    unmount();
    render(<SynologyAccountAccess mgr={manager({ identity: null })} />);
    expect(panel()).toHaveTextContent(
      "This desktop version did not report session details.",
    );
    expect(screen.queryByTestId("synology-account-identity")).toBeNull();
  });
  it("lets narrow layouts collapse the details", () => {
    render(<SynologyAccountAccess mgr={manager()} />);
    const toggle = screen.getByRole("button", { name: "Show session details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveClass("md:hidden");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: "Hide session details" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
  it.each([
    [
      "an administrator restricted session",
      account(),
      { utilization: "session_restricted" },
    ],
    ["a legacy backend", null, {}],
  ] as [string, Account | null, Partial<Record<string, SynologyReadState>>][])(
    "copies session diagnostics for %s without hostnames, URLs, SIDs, tokens or device ids",
    async (_name, identity, states) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      render(
        <SynologyAccountAccess mgr={manager({ identity, states: states })} />,
      );
      const copy = within(screen.getByTestId("synology-session-diagnostics"));
      expect(
        screen.getByTestId("synology-session-diagnostics"),
      ).toHaveTextContent("Copy session diagnostics");
      fireEvent.click(copy.getByRole("button", { name: "Copy diagnostics" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      const text = String(writeText.mock.calls[0][0]);
      expect(text).toContain("Synology NAS API session diagnostics");
      expect(text).toContain("Sections:");
      if (identity) {
        expect(text).toContain("Signed in as: nas-admin");
        expect(text).toContain("Administrator: yes");
        expect(text).toContain("Login handshake: DSM 7 secure (IK)");
        expect(text).toContain("Route: QuickConnect relay");
        expect(text).toContain("2FA: one-time code");
        expect(text).toContain(
          "System: partial (session) — SYNO.Core.System.Utilization session_restricted",
        );
      }
      for (const secret of [
        HOST,
        QC_HOST,
        "quickconnect.to",
        "example.com",
        "https:",
        "5001",
        "webapi",
        SID,
        TOKEN,
        DEVICE_ID,
        "hunter2",
        "instance-",
      ])
        expect(text).not.toContain(secret);
    },
  );
});
