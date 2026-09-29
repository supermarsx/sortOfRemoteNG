import React, { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import { WebPopupTab } from "../../src/components/protocol/WebPopupTab";
import { webPopupTabs } from "../../src/utils/protocol/webPopupTabs";

const context = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { sessions: [] as ConnectionSession[] },
  databaseAvailability: {
    status: "ready",
    databaseId: "owner",
    generation: 1,
  } as DatabaseAvailability,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => context,
}));
const browser = vi.hoisted(() => vi.fn());
vi.mock("../../src/components/protocol/WebBrowser", () => ({
  WebBrowser: (props: {
    session: ConnectionSession;
    sharedPopupId?: string;
  }) => {
    browser(props);
    return <section aria-label="Browser chrome">{props.session.name}</section>;
  },
}));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const source: ConnectionSession = {
  id: "source",
  connectionId: "rmm",
  name: "Dashboard",
  protocol: "https",
  hostname: "rmm.test",
  status: "connected",
  startTime: new Date(),
  ownerDatabaseId: "owner",
};
const proxyUrl = "http://p" + "a".repeat(32) + ".localhost:9000/";
const detachedLayout = (
  windowId: string,
): NonNullable<ConnectionSession["layout"]> => ({
  x: 0,
  y: 0,
  width: 1024,
  height: 768,
  zIndex: 1,
  isDetached: true,
  windowId,
});
const document = {
  sessionId: "proxy",
  generation: 1,
  sequence: 1,
  token: "a".repeat(32),
  navigationToken: null,
};
const open = (extra = {}) =>
  webPopupTabs.open({
    source,
    document,
    proxyUrl,
    url: proxyUrl + "takecontrol/opaque?token=private",
    isCurrent: () => true,
    ...extra,
  });
const browserProps = () =>
  browser.mock.lastCall![0] as {
    session: ConnectionSession;
    sharedPopupId: string;
    onActivateSession?: (sessionId: string) => void;
  };
beforeEach(() => {
  context.state.sessions = [source];
  context.databaseAvailability = {
    status: "ready",
    databaseId: "owner",
    generation: 1,
  };
  invoke.mockClear();
  context.dispatch.mockClear();
  browser.mockClear();
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    webPopupTabs.revokeSource(source.id);
  });
  vi.restoreAllMocks();
});

describe("WebPopupTab browser wrapper", () => {
  it("forwards the current activation callback without activating the source or invalidating adapted identity", () => {
    const session = open();
    const onActivateSession = vi.fn();
    const view = render(
      <WebPopupTab session={session} onActivateSession={onActivateSession} />,
    );
    const adapted = browserProps().session;
    expect(browserProps().onActivateSession).toBe(onActivateSession);
    expect(onActivateSession).not.toHaveBeenCalled();
    browserProps().onActivateSession?.("new-child");
    expect(onActivateSession).toHaveBeenCalledExactlyOnceWith("new-child");
    const nextActivate = vi.fn();
    view.rerender(
      <WebPopupTab session={session} onActivateSession={nextActivate} />,
    );
    expect(browserProps().session).toBe(adapted);
    expect(browserProps().onActivateSession).toBe(nextActivate);
    browserProps().onActivateSession?.("duplicate-child");
    expect(nextActivate).toHaveBeenCalledExactlyOnceWith("duplicate-child");
    expect(context.dispatch).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["http", "https"] as const)(
    "renders browser chrome with source %s identity and child routing, without mutating sessions",
    (protocol) => {
      const parent = Object.freeze({ ...source, protocol });
      context.state.sessions = [parent];
      const session = Object.freeze({
        ...open({ source: parent }),
        name: "PC-WEST-01 — Take Control",
      });
      const original = JSON.stringify({ parent, session });
      const attach = vi.spyOn(webPopupTabs, "attachViewer");
      const { container } = render(<WebPopupTab session={session} />);
      expect(
        screen.getByRole("region", { name: "Browser chrome" }),
      ).toHaveTextContent(session.name);
      expect(container.querySelector("iframe")).toBeNull();
      const props = browserProps();
      expect(props.sharedPopupId).toBe(session.id);
      expect(props.session).toEqual({
        ...parent,
        ...session,
        connectionId: parent.connectionId,
        hostname: parent.hostname,
        protocol,
      });
      expect(props.session).not.toBe(session);
      expect(props.onActivateSession).toBeUndefined();
      expect(attach).not.toHaveBeenCalled();
      expect(context.dispatch).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(JSON.stringify({ parent, session })).toBe(original);
      expect(session.protocol).toBe("tool:webPopup");
      for (const secret of [proxyUrl, "private", document.token, "opaque"])
        expect(JSON.stringify(props)).not.toContain(secret);
    },
  );

  it("preserves child layout and owner when adapting a source in a detached window", () => {
    const parent = {
      ...source,
      layout: detachedLayout("child-window"),
    };
    context.state.sessions = [parent];
    const session = { ...open({ source: parent }), tabGroupId: "child-group" };
    render(<WebPopupTab session={session} />);
    expect(browserProps().session.layout).toBe(session.layout);
    expect(browserProps().session.ownerDatabaseId).toBe(
      session.ownerDatabaseId,
    );
    expect(browserProps().session.tabGroupId).toBe("child-group");
    expect(browserProps().session.id).toBe(session.id);
  });

  it("keeps adapted identity stable through unrelated context and registry updates, and renders renamed child metadata", () => {
    const session = open();
    const view = render(
      <StrictMode>
        <WebPopupTab session={session} />
      </StrictMode>,
    );
    const first = browserProps().session;
    const chrome = screen.getByRole("region", { name: "Browser chrome" });
    context.state.sessions = [source, { ...source, id: "unrelated" }];
    context.databaseAvailability = { ...context.databaseAvailability };
    view.rerender(
      <StrictMode>
        <WebPopupTab session={session} />
      </StrictMode>,
    );
    expect(browserProps().session).toBe(first);
    act(() => {
      webPopupTabs.navigate(
        session.id,
        document,
        proxyUrl + "takecontrol/next",
      );
    });
    expect(browserProps().session).toBe(first);
    view.rerender(
      <StrictMode>
        <WebPopupTab
          session={{ ...session, name: "PC-EAST-02 — Take Control" }}
        />
      </StrictMode>,
    );
    expect(screen.getByRole("region", { name: "Browser chrome" })).toBe(chrome);
    expect(chrome).toHaveTextContent("PC-EAST-02 — Take Control");
    expect(browserProps().session.id).toBe(session.id);
    expect(source.name).toBe("Dashboard");
    expect(context.dispatch).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    "source gone",
    "source disconnected",
    "owner locked",
    "database changed",
    "root replaced",
    "owner changed",
    "connection changed",
    "source moved",
    "child moved",
    "child owner changed",
  ])(
    "revokes only the child and removes browser chrome when %s",
    async (reason) => {
      let valid = true;
      const onClose = vi.fn();
      let session = open({ isCurrent: () => valid, onClose });
      const view = render(<WebPopupTab session={session} />);
      if (reason === "source gone") context.state.sessions = [];
      if (reason === "source disconnected")
        context.state.sessions = [{ ...source, status: "disconnected" }];
      if (reason === "owner locked")
        context.databaseAvailability.status = "suspended";
      if (reason === "database changed")
        context.databaseAvailability.databaseId = "other";
      if (reason === "root replaced") valid = false;
      if (reason === "owner changed")
        context.state.sessions = [{ ...source, ownerDatabaseId: "other" }];
      if (reason === "connection changed")
        context.state.sessions = [{ ...source, connectionId: "other" }];
      if (reason === "source moved")
        context.state.sessions = [
          { ...source, layout: detachedLayout("other") },
        ];
      if (reason === "child moved")
        session = {
          ...session,
          layout: detachedLayout("other"),
        };
      if (reason === "child owner changed")
        session = { ...session, ownerDatabaseId: "other" };
      view.rerender(<WebPopupTab session={session} />);
      await act(async () => {});
      expect(
        screen.queryByRole("region", { name: "Browser chrome" }),
      ).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("expired");
      expect(webPopupTabs.getSnapshot(session.id)).toBeNull();
      expect(onClose).toHaveBeenCalledExactlyOnceWith(session.id);
      expect(context.dispatch).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(source.status).toBe("connected");
    },
  );

  it("restored metadata cannot recreate a runtime entry or browser", () => {
    render(
      <WebPopupTab
        session={{ ...source, id: "expired", protocol: "tool:webPopup" }}
      />,
    );
    expect(browser).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("expired");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reacts to registry revocation without touching the parent session", () => {
    const session = open();
    render(<WebPopupTab session={session} />);
    act(() => {
      webPopupTabs.revokeSource(source.id, document);
    });
    expect(screen.queryByRole("region", { name: "Browser chrome" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("expired");
    expect(context.state.sessions).toEqual([source]);
    expect(context.dispatch).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
