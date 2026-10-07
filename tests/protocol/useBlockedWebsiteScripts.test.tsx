import React, { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlockedWebsiteScripts } from "../../src/hooks/protocol/useBlockedWebsiteScripts";
import BlockedScriptsDialog from "../../src/components/protocol/webBrowser/BlockedScriptsDialog";
import BlockedRequestsDialog from "../../src/components/protocol/webBrowser/BlockedRequestsDialog";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  ConnectionAction,
  ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type { ToastUpdate } from "../../src/components/ui/dialogs/Toast";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";

const mocks = vi.hoisted(() => ({
  context: {} as ConnectionContextType,
  rows: [] as Connection[],
  owner: "db-a",
  generation: 1,
  locked: false,
  read: vi.fn(),
  save: vi.fn(),
  toast: {
    warning: vi.fn(() => "blocked"),
    info: vi.fn(() => "reload"),
    error: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.context,
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mocks.toast }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: mocks.owner }),
      captureCurrentDatabaseDataTarget: () => {
        const owner = mocks.owner,
          generation = mocks.generation;
        return {
          databaseId: owner,
          readCurrent: mocks.read,
          assertAccessible: () => {
            if (
              mocks.locked ||
              mocks.owner !== owner ||
              mocks.generation !== generation
            )
              throw new Error("Revoked lease with private details");
          },
        };
      },
    }),
  },
}));
const script = {
  kind: "script",
  reason: "policy-blocked-resource",
  origin: "https://cdn.example.test",
};
const session = {
  id: "tab",
  connectionId: "web",
  ownerDatabaseId: "db-a",
  name: "Test website",
} as ConnectionSession;
const fixture = (): Connection => ({
  id: "web",
  name: "Test website",
  protocol: "https",
  hostname: "web.example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-10-05",
  updatedAt: "2026-10-05",
});
type Options = Parameters<typeof useBlockedWebsiteScripts>[0];
function options(): Options {
  return {
    session,
    connection: mocks.rows[0],
    policy: normalizeHttpProxyPolicy(undefined),
    reports: [script],
    documentScope: "page-1",
    getDocumentScope: () => "page-1",
    sharedSession: false,
    onReload: vi.fn(),
  };
}
function action(id = "blocked") {
  const updates = mocks.toast.update.mock.calls.filter(
    (call) => call[0] === id,
  );
  return (updates[updates.length - 1][1] as ToastUpdate).action!.onClick;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner = "db-a";
  mocks.generation = 1;
  mocks.locked = false;
  mocks.rows = [fixture()];
  mocks.read.mockImplementation(async () => ({
    connections: structuredClone(mocks.rows),
  }));
  mocks.save.mockImplementation(async (event: ConnectionAction) => {
    if (event.type === "UPDATE_CONNECTION") mocks.rows = [event.payload];
  });
  mocks.context = {
    databaseAvailability: {
      status: "ready",
      databaseId: "db-a",
      generation: 1,
    },
    getCurrentConnections: ({
      databaseId,
      generation,
    }: {
      databaseId: string;
      generation: number;
    }) => {
      if (
        mocks.locked ||
        databaseId !== mocks.owner ||
        generation !== mocks.generation
      )
        throw new Error("Locked");
      return mocks.rows;
    },
    dispatchAndFlush: mocks.save,
  } as unknown as ConnectionContextType;
});
afterEach(cleanup);

describe("reviewed all-request permissions", () => {
  const requestOptions = (): Options => ({
    ...options(),
    reports: [
      {
        kind: "fetch",
        reason: "origin-not-approved",
        origin: "https://api.example.test",
      },
      {
        kind: "navigation",
        reason: "origin-not-approved",
        origin: "https://login.example.test",
      },
    ],
  });

  it("reviews fetch and navigation reports without auto-grant and verifies an explicit owning-connection save", async () => {
    mocks.rows = [{ ...mocks.rows[0], password: "SYNTHETIC_UNCHANGED" }];
    const props = requestOptions();
    const getConnections = vi.fn(mocks.context.getCurrentConnections!);
    mocks.context.getCurrentConnections = getConnections;
    const { result, rerender } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    expect(result.current.hasBlockedRequests).toBe(true);
    expect(result.current.hasBlockedScripts).toBe(false);
    expect(result.current.review).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    act(() => result.current.openRequestReview());
    expect(result.current.review).toMatchObject({
      mode: "requests",
      reports: props.reports,
    });
    await act(() => result.current.allowAllRequests());
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.rows = [
      {
        ...mocks.rows[0],
        description: "Concurrent note",
      },
    ];
    const before = structuredClone(mocks.rows[0]);
    act(() => result.current.setAcceptAllRequests(true));
    await act(() => result.current.allowAllRequests());
    expect(getConnections).toHaveBeenCalledWith({
      databaseId: "db-a",
      generation: 1,
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      type: "UPDATE_CONNECTION",
      payload: {
        ...before,
        httpProxyPolicy: { ...props.policy, allowAllRequests: true },
      },
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.toast.info).toHaveBeenCalledTimes(1);
    expect(result.current.review).toBeNull();
    expect(props.onReload).not.toHaveBeenCalled();
    rerender({
      ...props,
      connection: mocks.rows[0],
      policy: mocks.rows[0].httpProxyPolicy!,
    });
    act(action("reload"));
    expect(props.onReload).toHaveBeenCalledOnce();
  });

  it("never reuses script consent or a script-mode review as all-request consent", async () => {
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: options(),
    });
    act(() => result.current.openReview());
    act(() => {
      result.current.setAcceptAllScripts(true);
      result.current.setAcceptAllRequests(true);
    });
    expect(result.current.review?.mode).toBe("scripts");
    await act(() => result.current.allowAllRequests());
    expect(mocks.save).not.toHaveBeenCalled();
    act(() => result.current.openRequestReview());
    expect(result.current.acceptAllRequests).toBe(false);
    expect(result.current.acceptAllScripts).toBe(false);
    await act(() => result.current.allowAllRequests());
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(["owner", "generation", "lock", "shared", "document", "settings"])(
    "refuses a %s change or restricted session before writing request permission",
    async (change) => {
      let scope = "page-1";
      const props = {
        ...requestOptions(),
        sharedSession: change === "shared",
        getDocumentScope: () => scope,
      };
      const { result } = renderHook(useBlockedWebsiteScripts, {
        initialProps: props,
      });
      act(() => result.current.openRequestReview());
      act(() => result.current.setAcceptAllRequests(true));
      if (change === "owner") mocks.owner = "db-b";
      if (change === "generation") mocks.generation++;
      if (change === "lock") mocks.locked = true;
      if (change === "document") scope = "page-2";
      if (change === "settings")
        mocks.rows = [
          {
            ...mocks.rows[0],
            httpProxyPolicy: { ...props.policy!, httpsOnly: true },
          },
        ];
      await act(() => result.current.allowAllRequests());
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.toast.info).not.toHaveBeenCalled();
      expect(result.current.error).toBeTruthy();
      expect(result.current.error).not.toContain("private");
      expect(props.onReload).not.toHaveBeenCalled();
    },
  );

  it.each(["reject", "ignored", "verification"])(
    "does not announce permission or reload after a %s persistence failure",
    async (failure) => {
      const props = requestOptions();
      if (failure === "reject")
        mocks.save.mockRejectedValue(new Error("private save details"));
      if (failure === "ignored") mocks.save.mockResolvedValue(undefined);
      if (failure === "verification")
        mocks.read.mockRejectedValue(new Error("private read details"));
      const { result } = renderHook(useBlockedWebsiteScripts, {
        initialProps: props,
      });
      act(() => result.current.openRequestReview());
      act(() => result.current.setAcceptAllRequests(true));
      await act(() => result.current.allowAllRequests());
      expect(mocks.save).toHaveBeenCalledTimes(1);
      expect(mocks.toast.info).not.toHaveBeenCalled();
      expect(result.current.error).toContain("could not be confirmed");
      expect(result.current.error).not.toContain("private");
      expect(props.onReload).not.toHaveBeenCalled();
    },
  );

  it("does not write twice while pending or announce success after ownership changes during save", async () => {
    let finish!: () => void;
    mocks.save.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const props = requestOptions();
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    act(() => result.current.openRequestReview());
    act(() => result.current.setAcceptAllRequests(true));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.allowAllRequests();
    });
    await act(() => result.current.allowAllRequests());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    mocks.owner = "db-b";
    await act(async () => {
      finish();
      await pending;
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.toast.info).not.toHaveBeenCalled();
    expect(result.current.error).toContain("could not be confirmed");
    expect(props.onReload).not.toHaveBeenCalled();
  });

  it.each(["cancel", "unmount"])(
    "rejects retained request-grant callbacks after %s",
    async (change) => {
      const { result, unmount } = renderHook(useBlockedWebsiteScripts, {
        initialProps: requestOptions(),
      });
      act(() => result.current.openRequestReview());
      act(() => result.current.setAcceptAllRequests(true));
      const allow = result.current.allowAllRequests;
      if (change === "cancel") act(() => result.current.closeReview());
      else unmount();
      await act(() => allow());
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it("requires both request trust and policy-change consent in the themed request dialog", async () => {
    const props = {
      ...requestOptions(),
      policy: {
        ...normalizeHttpProxyPolicy(undefined),
        pageScripts: "inline-only" as const,
        sameOriginOnly: true,
        httpsOnly: true,
      },
    };
    function Fixture() {
      const permissions = useBlockedWebsiteScripts(props);
      return (
        <>
          <button onClick={permissions.openRequestReview}>
            Review requests
          </button>
          <BlockedRequestsDialog permissions={permissions} />
          <BlockedScriptsDialog scripts={permissions} />
        </>
      );
    }
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Review requests" }));
    expect(
      screen.getByRole("dialog", { name: "Website request permissions" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Blocked website scripts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Blocked website requests" }).children,
    ).toHaveLength(2);
    expect(
      screen.getByText(/Requests stay on the internal proxy/),
    ).toBeVisible();
    expect(screen.getByText(/blocked requests are not replayed/)).toBeVisible();
    const allow = screen.getByRole("button", {
      name: "Allow all website requests",
    });
    expect(allow).toHaveClass("sor-btn", "sor-btn-primary");
    expect(allow).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I trust all current and future request destinations for this connection",
      }),
    );
    expect(allow).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I approve enabling website scripts and disabling same-origin-only restrictions",
      }),
    );
    expect(allow).toBeEnabled();
    fireEvent.click(allow);
    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalled());
    expect(mocks.rows[0].httpProxyPolicy).toEqual({
      ...props.policy,
      allowAllRequests: true,
      pageScripts: "allow",
      sameOriginOnly: false,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.onReload).not.toHaveBeenCalled();
  });

  it("does not offer another grant when all-request trust is already active", () => {
    const props = {
      ...requestOptions(),
      policy: {
        ...normalizeHttpProxyPolicy(undefined),
        allowAllRequests: true,
      },
    };
    function Fixture() {
      const permissions = useBlockedWebsiteScripts(props);
      return (
        <>
          <button onClick={permissions.openRequestReview}>
            Review requests
          </button>
          <BlockedRequestsDialog permissions={permissions} />
        </>
      );
    }
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Review requests" }));
    expect(screen.getByRole("status")).toHaveTextContent("already enabled");
    expect(
      screen.queryByRole("button", { name: "Allow all website requests" }),
    ).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(props.onReload).not.toHaveBeenCalled();
  });
});

describe("blocked script notifications and reviewed grants", () => {
  it("does not repeat the toast when switching away from and back to the owning database", () => {
    const props = options();
    const { rerender, result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    for (const databaseId of ["db-b", "db-a"]) {
      mocks.owner = databaseId;
      mocks.generation++;
      mocks.context.databaseAvailability = {
        status: "ready",
        databaseId,
        generation: mocks.generation,
      };
      rerender({ ...props });
    }
    expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
    act(action());
    expect(result.current.review).not.toBeNull();
  });
  it("allows inline and unknown sources only after explicit all-script trust consent", async () => {
    const props = { ...options(), reports: [{ ...script, origin: null }] };
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    act(action());
    await act(() => result.current.allowAllScripts());
    expect(mocks.save).not.toHaveBeenCalled();
    act(() => result.current.setAcceptAllScripts(true));
    await act(() => result.current.allowAllScripts());
    expect(mocks.rows[0].httpProxyPolicy).toEqual({
      ...props.policy,
      allowAllScripts: true,
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(props.onReload).not.toHaveBeenCalled();
  });
  it("refuses all-script trust if database ownership changes after review", async () => {
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: options(),
    });
    act(action());
    act(() => result.current.setAcceptAllScripts(true));
    mocks.owner = "db-b";
    await act(() => result.current.allowAllScripts());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });
  it("presents a themed all-script option even for unknown-only reports", async () => {
    const props = { ...options(), reports: [{ ...script, origin: null }] };
    function Fixture() {
      return <BlockedScriptsDialog scripts={useBlockedWebsiteScripts(props)} />;
    }
    render(<Fixture />);
    act(action());
    const allow = screen.getByRole("button", {
      name: "Allow all website scripts",
    });
    expect(allow).toBeDisabled();
    expect(allow).toHaveClass("sor-btn", "sor-btn-primary");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I trust all current and future scripts on this connection",
      }),
    );
    expect(allow).toBeEnabled();
    fireEvent.click(allow);
    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalled());
    expect(mocks.rows[0].httpProxyPolicy?.allowAllScripts).toBe(true);
  });
  it("shows one actionable toast, not one per source, retry or page reload", () => {
    let props = options();
    const { result, rerender } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
    expect(result.current.review).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    props = {
      ...props,
      reports: [
        ...props.reports,
        { ...script, origin: "https://other.example.test" },
      ],
    };
    rerender(props);
    props = {
      ...props,
      documentScope: "page-2",
      getDocumentScope: () => "page-2",
    };
    rerender(props);
    expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
    act(action());
    expect(result.current.review?.reports).toHaveLength(2);
    expect(result.current.review?.documentScope).toBe("page-2");
  });
  it("ignores fonts and fetch and only notifies after a script report", () => {
    const props = { ...options(), reports: [{ ...script, kind: "font" }] };
    const { rerender } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    rerender({ ...props, reports: [script] });
    expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
  });
  it("saves only the reviewed source in the owning connection and offers an explicit reload", async () => {
    const props = options();
    const { result, rerender } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    act(action());
    // Unrelated edits made after opening the dialog must survive.
    mocks.rows = [
      { ...mocks.rows[0], description: "A concurrent note", name: "Renamed" },
    ];
    await act(() => result.current.allowSource(script));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.rows[0]).toMatchObject({
      description: "A concurrent note",
      name: "Renamed",
    });
    expect(
      mocks.rows[0].httpProxyPolicy?.externalResourceOrigins?.slice(-1)[0],
    ).toEqual({ origin: script.origin, kinds: ["script"] });
    expect(props.onReload).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(result.current.review).toBeNull();
    rerender({
      ...props,
      connection: mocks.rows[0],
      policy: mocks.rows[0].httpProxyPolicy!,
    });
    act(action("reload"));
    expect(props.onReload).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite a policy edited while the review is open", async () => {
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: options(),
    });
    act(action());
    mocks.rows = [
      {
        ...mocks.rows[0],
        httpProxyPolicy: {
          ...normalizeHttpProxyPolicy(undefined),
          httpsOnly: true,
        },
      },
    ];
    await act(() => result.current.allowSource(script));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.current.error).toContain("settings changed");
  });
  it.each(["lock", "owner", "generation", "missing", "duplicate", "hostname"])(
    "refuses a stale %s before any write",
    async (change) => {
      const { result } = renderHook(useBlockedWebsiteScripts, {
        initialProps: options(),
      });
      act(action());
      if (change === "lock") mocks.locked = true;
      if (change === "owner") mocks.owner = "db-b";
      if (change === "generation") mocks.generation++;
      if (change === "missing") mocks.rows = [];
      if (change === "duplicate")
        mocks.rows = [...mocks.rows, { ...mocks.rows[0] }];
      if (change === "hostname")
        mocks.rows = [{ ...mocks.rows[0], hostname: "changed.example.test" }];
      await act(() => result.current.allowSource(script));
      expect(mocks.save).not.toHaveBeenCalled();
      expect(result.current.error).toBeTruthy();
      expect(result.current.error).not.toContain("private");
    },
  );
  it("refuses a stale navigation, canceled review and report absent from review", async () => {
    let scope = "page-1";
    const props = { ...options(), getDocumentScope: () => scope };
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    act(action());
    await act(() =>
      result.current.allowSource({
        ...script,
        origin: "https://unreported.test",
      }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    const stale = result.current.allowSource;
    act(() => result.current.closeReview());
    await act(() => stale(script));
    expect(mocks.save).not.toHaveBeenCalled();
    act(() => result.current.openReview());
    scope = "page-2";
    await act(() => result.current.allowSource(script));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not save or reopen from callbacks retained after unmount", async () => {
    const { result, unmount } = renderHook(useBlockedWebsiteScripts, {
      initialProps: options(),
    });
    const open = action();
    act(open);
    const allow = result.current.allowSource;
    unmount();
    act(open);
    await act(() => allow(script));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toast.remove).toHaveBeenCalledWith("blocked");
  });
  it("does not write twice while a save is pending and does not report success on save failure", async () => {
    let fail!: (reason: unknown) => void;
    mocks.save.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: options(),
    });
    act(action());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.allowSource(script);
    });
    await act(() => result.current.allowSource(script));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      fail(new Error("private database details"));
      await pending;
    });
    expect(mocks.toast.info).not.toHaveBeenCalled();
    expect(result.current.error).toContain("could not be confirmed");
  });
  it("checks durable storage instead of claiming an ignored write succeeded", async () => {
    mocks.save.mockResolvedValue(undefined);
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: options(),
    });
    act(action());
    await act(() => result.current.allowSource(script));
    expect(mocks.toast.info).not.toHaveBeenCalled();
    expect(result.current.error).toContain("could not be confirmed");
  });
  it("does not grant permissions from a shared popup", async () => {
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: { ...options(), sharedSession: true },
    });
    act(action());
    await act(() => result.current.allowSource(script));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("requires explicit acknowledgement before enabling restrictive connection policy", async () => {
    const props = {
      ...options(),
      policy: {
        ...normalizeHttpProxyPolicy(undefined),
        pageScripts: "inline-only" as const,
        sameOriginOnly: true,
      },
    };
    const { result } = renderHook(useBlockedWebsiteScripts, {
      initialProps: props,
    });
    act(action());
    await act(() => result.current.allowSource(script));
    expect(mocks.save).not.toHaveBeenCalled();
    act(() => result.current.setAcceptPolicyChange(true));
    await act(() => result.current.allowSource(script));
    expect(mocks.rows[0].httpProxyPolicy).toMatchObject({
      pageScripts: "allow",
      sameOriginOnly: false,
    });
  });
  it("renders themed review, known-source limitation, consent and allow actions", async () => {
    const props = {
      ...options(),
      policy: {
        ...normalizeHttpProxyPolicy(undefined),
        pageScripts: "inline-only" as const,
      },
      reports: [script, { ...script, origin: null }],
    };
    function Fixture() {
      const scripts = useBlockedWebsiteScripts(props);
      return <BlockedScriptsDialog scripts={scripts} />;
    }
    render(
      <StrictMode>
        <Fixture />
      </StrictMode>,
    );
    act(action());
    expect(
      screen.getByRole("dialog", { name: "Blocked website scripts" }),
    ).toBeVisible();
    expect(screen.getByText(/Inline scripts, eval/)).toBeVisible();
    const allow = screen.getByRole("button", {
      name: `Allow scripts from ${script.origin}`,
    });
    expect(allow).toHaveClass("sor-btn", "sor-btn-primary");
    expect(allow.parentElement).toHaveClass("flex", "justify-end", "pt-1");
    expect(allow.closest("li")).toHaveClass("p-4", "space-y-3");
    expect(allow.closest(".sor-modal-body")).toHaveClass("p-6", "space-y-5");
    expect(allow).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I approve these connection policy changes",
      }),
    );
    fireEvent.click(allow);
    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
