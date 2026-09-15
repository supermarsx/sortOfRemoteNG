import React, { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSynologySectionAccess } from "../../src/hooks/synology/useSynologySectionAccess";
import { invokeManagement } from "../../src/utils/security/managementInvoke";
import { SessionRenderActivityContext } from "../../src/contexts/SessionRenderActivityContext";
import type { SynologyTab } from "../../src/hooks/synology/synologyAdminData";
import { SYNOLOGY_SECTION_READS } from "../../src/utils/synology/synologyAccess";
vi.mock("../../src/utils/security/managementInvoke", () => ({
  invokeManagement: vi.fn(),
  toSafeManagementError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
const options = () => ({
  instanceId: "instance-a",
  sessionId: "receipt-a" as string | null,
  connected: true,
  isActive: true,
  assertCurrent: vi.fn(),
  onSessionExpired: vi.fn(),
  fileStationReady: false,
});
const available = (section: unknown) => ({
  section,
  status: "available",
  reason: "Primary read succeeded. Writes need separate permission.",
});
const account = {
  signedInAs: "nas-admin",
  role: "administrator",
  portalSession: false,
  sessionName: "FileStation",
  loginHandshake: "ik",
  authVersion: 7,
  route: "quickconnect_relay",
  secondFactor: "otp",
};
/** Full (per-read) native snapshot; utilization restricted when `restricted`. */
const full = (section: SynologyTab, restricted = false) => {
  const reads = SYNOLOGY_SECTION_READS[section].map((field) => ({
    field,
    api:
      field === "utilization"
        ? "SYNO.Core.System.Utilization"
        : "SYNO.DSM.Info",
    state:
      restricted && field === "utilization"
        ? "session_restricted"
        : "available",
    reason: "Read successfully.",
  }));
  const partial = reads.some((read) => read.state !== "available");
  return {
    section,
    status: partial ? "partial" : "available",
    requirement: partial ? "session" : null,
    reason: partial
      ? "Some data in this section needs additional DSM access; the parts you can read are shown."
      : "All data in this section was read successfully.",
    account,
    reads,
  };
};
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
};
beforeEach(() => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.mocked(invokeManagement)
    .mockReset()
    .mockImplementation(
      async (_command, args) => available(args?.section) as never,
    );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("NAS section read-access discovery", () => {
  it("probes each section once under StrictMode with exact instance and receipt, never polls", async () => {
    const props = options();
    const { result, rerender } = renderHook(
      () => useSynologySectionAccess(props),
      {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      },
    );
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(invokeManagement).toHaveBeenCalledTimes(18);
    const sections = vi
      .mocked(invokeManagement)
      .mock.calls.map(([command, args]) => {
        expect(command).toBe("syn_get_section_access");
        expect(args).toMatchObject({
          instanceId: "instance-a",
          expectedSessionId: "receipt-a",
        });
        return args?.section;
      });
    expect(new Set(sections).size).toBe(18);
    rerender();
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(300_000);
    });
    expect(invokeManagement).toHaveBeenCalledTimes(18);
    act(() => result.current.recheck());
    await act(async () => {});
    expect(invokeManagement).toHaveBeenCalledTimes(36);
  });
  it("keeps at most three reads in flight even across receipt replacement and ignores old replies", async () => {
    const pending: ReturnType<typeof deferred>[] = [];
    vi.mocked(invokeManagement).mockImplementation(() => {
      const task = deferred();
      pending.push(task);
      return task.promise as never;
    });
    const { result, rerender, unmount } = renderHook(useSynologySectionAccess, {
      initialProps: options(),
    });
    expect(pending).toHaveLength(3);
    rerender({
      ...options(),
      instanceId: "instance-b",
      sessionId: "receipt-b",
    });
    expect(pending).toHaveLength(3);
    expect(result.current.entries.system.status).toBe("checking");
    await act(async () => pending[0].resolve(available("fileStation")));
    expect(pending).toHaveLength(4);
    expect(result.current.entries.fileStation.status).toBe("checking");
    expect(invokeManagement).toHaveBeenLastCalledWith(
      "syn_get_section_access",
      {
        instanceId: "instance-b",
        expectedSessionId: "receipt-b",
        section: "fileStation",
      },
    );
    unmount();
    await act(async () => {
      pending.slice(1).forEach((task) => task.resolve(available("system")));
    });
    expect(pending).toHaveLength(4);
  });
  it("masks published results immediately on disconnect and replacement", async () => {
    const { result, rerender } = renderHook(useSynologySectionAccess, {
      initialProps: options(),
    });
    await waitFor(() => expect(result.current.checking).toBe(false));
    vi.mocked(invokeManagement).mockImplementation(() => new Promise(() => {}));
    rerender({ ...options(), connected: false, sessionId: null });
    expect(result.current.entries.system.status).toBe("checking");
    expect(result.current.account).toBeNull();
    expect(result.current.checking).toBe(false);
    rerender({ ...options(), sessionId: "receipt-new" });
    expect(result.current.entries.system.status).toBe("checking");
  });
  it("pauses scheduling while hidden, resumes the same queue, and stops on unmount", async () => {
    const pending: ReturnType<typeof deferred>[] = [];
    vi.mocked(invokeManagement).mockImplementation(() => {
      const task = deferred();
      pending.push(task);
      return task.promise as never;
    });
    const { result, unmount } = renderHook(useSynologySectionAccess, {
      initialProps: options(),
    });
    expect(pending).toHaveLength(3);
    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () =>
      pending.forEach((task, index) =>
        task.resolve(available(["fileStation", "dashboard", "system"][index])),
      ),
    );
    expect(pending).toHaveLength(3);
    expect(result.current.active).toBe(false);
    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(pending).toHaveLength(6);
    unmount();
    await act(async () =>
      pending.slice(3).forEach((task) => task.resolve(available("storage"))),
    );
    expect(pending).toHaveLength(6);
  });
  it("honors explicit inactivity and session-render inactivity without starting probes", () => {
    const explicit = renderHook(useSynologySectionAccess, {
      initialProps: { ...options(), isActive: false },
    });
    expect(invokeManagement).not.toHaveBeenCalled();
    explicit.unmount();
    renderHook(() => useSynologySectionAccess(options()), {
      wrapper: ({ children }) => (
        <SessionRenderActivityContext.Provider value={{ isActive: false }}>
          {children}
        </SessionRenderActivityContext.Provider>
      ),
    });
    expect(invokeManagement).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { section: "wrong", status: "available", reason: "ok" },
    { section: "fileStation", status: "admin", reason: "ok" },
    { section: "fileStation", status: "available", reason: "x".repeat(1025) },
    { section: "fileStation", status: "available", reason: "bad\nreason" },
    { section: "fileStation", status: "available", reason: "" },
    { section: "fileStation", status: "partial", reason: "No reads." },
    { ...full("fileStation"), account: { ...account, role: "root" } },
    {
      ...full("fileStation"),
      account: { ...account, signedInAs: "nas\u0000admin" },
    },
    { ...full("fileStation"), reads: [] },
  ])(
    "treats malformed native results as unknown, not access granted or denied: %j",
    async (payload) => {
      vi.mocked(invokeManagement).mockResolvedValue(payload as never);
      const { result } = renderHook(() => useSynologySectionAccess(options()));
      await waitFor(() => expect(result.current.checking).toBe(false));
      expect(result.current.entries.fileStation.status).toBe("unknown");
    },
  );
  it("does not turn transport failure into denied and only notifies canonical receipt expiry", async () => {
    const props = options();
    vi.mocked(invokeManagement).mockRejectedValue(
      new Error("Network unavailable"),
    );
    const { result } = renderHook(() => useSynologySectionAccess(props));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.entries.system.status).toBe("unknown");
    expect(props.onSessionExpired).not.toHaveBeenCalled();
    vi.mocked(invokeManagement).mockRejectedValue(
      new Error("SYNOLOGY_SESSION_EXPIRED: Sign in again"),
    );
    act(() => result.current.recheck());
    await waitFor(() =>
      expect(props.onSessionExpired).toHaveBeenCalledWith(
        "receipt-a",
        "SYNOLOGY_SESSION_EXPIRED: Sign in again",
      ),
    );
  });
  it("checks owner access before scheduling and after each awaited result", async () => {
    const props = options();
    const pending = deferred();
    let revoked = false;
    props.assertCurrent.mockImplementation(() => {
      if (revoked) throw new Error("Owner locked");
    });
    vi.mocked(invokeManagement).mockReturnValue(pending.promise as never);
    const { result } = renderHook(() => useSynologySectionAccess(props));
    revoked = true;
    await act(async () => pending.resolve(available("fileStation")));
    expect(invokeManagement).toHaveBeenCalledTimes(3);
    expect(result.current.entries.fileStation.status).toBe("unknown");
    act(() => result.current.recheck());
    expect(invokeManagement).toHaveBeenCalledTimes(3);
  });
  it("keeps a successfully read File Station available while other checks are pending", () => {
    vi.mocked(invokeManagement).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() =>
      useSynologySectionAccess({ ...options(), fileStationReady: true }),
    );
    expect(result.current.entries.fileStation.status).toBe("available");
    expect(result.current.entries.vms.status).toBe("checking");
  });
  it.each([
    ["denied", "permission"],
    ["unavailable", "dsm_version"],
    ["unknown", null],
  ])(
    "preserves a verified legacy native %s classification",
    async (status, requirement) => {
      vi.mocked(invokeManagement).mockImplementation(
        async (_command, args) =>
          ({
            section: args?.section as SynologyTab,
            status,
            reason: "Safe native explanation.",
          }) as never,
      );
      const { result } = renderHook(() => useSynologySectionAccess(options()));
      await waitFor(() => expect(result.current.checking).toBe(false));
      expect(result.current.entries.system).toEqual({
        section: "system",
        status,
        requirement,
        reason: "Safe native explanation.",
        account: null,
        reads: [],
      });
      expect(result.current.account).toBeNull();
    },
  );
  it("publishes full per-read snapshots and the session identity", async () => {
    vi.mocked(invokeManagement).mockImplementation(
      async (_command, args) =>
        full(args?.section as SynologyTab, args?.section === "system") as never,
    );
    const { result } = renderHook(() => useSynologySectionAccess(options()));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.entries.system).toEqual(full("system", true));
    expect(result.current.entries.system.reads[1]).toMatchObject({
      field: "utilization",
      state: "session_restricted",
    });
    expect(result.current.entries.storage.status).toBe("available");
    expect(result.current.account).toEqual(account);
  });
  it("rechecks one section without resetting the others and ignores its older in-flight reply", async () => {
    const pending: {
      section: SynologyTab;
      task: ReturnType<typeof deferred>;
    }[] = [];
    vi.mocked(invokeManagement).mockImplementation((_command, args) => {
      const task = deferred();
      pending.push({ section: args?.section as SynologyTab, task });
      return task.promise as never;
    });
    const { result } = renderHook(() => useSynologySectionAccess(options()));
    // Drain the initial queue but leave "system" unresolved to race a recheck.
    let index = 0;
    while (index < pending.length) {
      const { section, task } = pending[index++];
      if (section === "system") continue;
      await act(async () => task.resolve(full(section)));
    }
    expect(pending).toHaveLength(18);
    expect(result.current.entries.system.status).toBe("checking");
    act(() => result.current.recheck("system"));
    expect(pending).toHaveLength(19);
    expect(pending[18].section).toBe("system");
    const stale = pending.find(({ section }) => section === "system")!;
    await act(async () => stale.task.resolve(full("system", true)));
    expect(result.current.entries.system.status).toBe("checking");
    await act(async () => pending[18].task.resolve(full("system")));
    expect(result.current.entries.system.status).toBe("available");
    // A settled section can be rechecked again; unrelated results stay published.
    act(() => result.current.recheck("system"));
    expect(pending).toHaveLength(20);
    expect(result.current.entries.system.status).toBe("checking");
    expect(result.current.entries.storage.status).toBe("available");
    expect(result.current.checking).toBe(true);
    await act(async () => pending[19].task.resolve(full("system", true)));
    expect(result.current.entries.system.status).toBe("partial");
    expect(
      vi
        .mocked(invokeManagement)
        .mock.calls.slice(18)
        .map(([, args]) => args?.section),
    ).toEqual(["system", "system"]);
  });
  it("keeps the three-read limit for single-section rechecks", async () => {
    const pending: ReturnType<typeof deferred>[] = [];
    vi.mocked(invokeManagement).mockImplementation(() => {
      const task = deferred();
      pending.push(task);
      return task.promise as never;
    });
    const { result } = renderHook(() => useSynologySectionAccess(options()));
    expect(pending).toHaveLength(3);
    act(() => {
      result.current.recheck("fileStation");
      result.current.recheck("fileStation");
    });
    expect(pending).toHaveLength(3);
    await act(async () => pending[0].resolve(full("fileStation")));
    expect(pending).toHaveLength(4);
    // The stale first reply was ignored; fileStation is still being checked once more.
    expect(result.current.entries.fileStation.status).toBe("checking");
    const sections = vi
      .mocked(invokeManagement)
      .mock.calls.map(([, args]) => args?.section);
    expect(sections.filter((section) => section === "fileStation")).toEqual([
      "fileStation",
    ]);
    // The rechecked section is appended to the queue once, after the pending probes.
    for (let i = 1; i < pending.length; i++) {
      const section = vi.mocked(invokeManagement).mock.calls[i][1]
        ?.section as SynologyTab;
      await act(async () => pending[i].resolve(full(section)));
    }
    expect(result.current.checking).toBe(false);
    const calls = vi.mocked(invokeManagement).mock.calls;
    expect(calls[calls.length - 1][1]?.section).toBe("fileStation");
    expect(
      vi
        .mocked(invokeManagement)
        .mock.calls.filter(([, args]) => args?.section === "fileStation"),
    ).toHaveLength(2);
    expect(invokeManagement).toHaveBeenCalledTimes(19);
  });
  it("routes session expiry from a single-section recheck unchanged", async () => {
    const props = options();
    const { result } = renderHook(() => useSynologySectionAccess(props));
    await waitFor(() => expect(result.current.checking).toBe(false));
    vi.mocked(invokeManagement).mockRejectedValue(
      new Error("SYNOLOGY_SESSION_EXPIRED: Sign in again"),
    );
    act(() => result.current.recheck("system"));
    await waitFor(() =>
      expect(props.onSessionExpired).toHaveBeenCalledWith(
        "receipt-a",
        "SYNOLOGY_SESSION_EXPIRED: Sign in again",
      ),
    );
    expect(invokeManagement).toHaveBeenCalledTimes(19);
    expect(invokeManagement).toHaveBeenLastCalledWith(
      "syn_get_section_access",
      {
        instanceId: "instance-a",
        expectedSessionId: "receipt-a",
        section: "system",
      },
    );
    expect(result.current.entries.system.status).toBe("unknown");
    expect(result.current.entries.storage.status).toBe("available");
  });
  it("does not recheck a section after owner access is revoked", async () => {
    const props = options();
    const { result } = renderHook(() => useSynologySectionAccess(props));
    await waitFor(() => expect(result.current.checking).toBe(false));
    props.assertCurrent.mockImplementation(() => {
      throw new Error("Owner locked");
    });
    act(() => result.current.recheck("system"));
    expect(invokeManagement).toHaveBeenCalledTimes(18);
    expect(result.current.entries.system.status).toBe("available");
  });
});
