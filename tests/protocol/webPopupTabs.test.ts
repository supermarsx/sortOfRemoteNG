import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import {
  webPopupTabs,
  type WebPopupDocument,
} from "../../src/utils/protocol/webPopupTabs";

const source: ConnectionSession = {
  id: "rmm-source",
  connectionId: "rmm",
  name: "Dashboard",
  protocol: "https",
  hostname: "rmm.example.test",
  status: "connected",
  startTime: new Date(),
  ownerDatabaseId: "owner",
};
const proxyUrl = `http://p${"a".repeat(32)}.localhost:9000/`;
const document: WebPopupDocument = {
  sessionId: "proxy-session",
  generation: 4,
  sequence: 3,
  token: "b".repeat(32),
  navigationToken: null,
};
const open = (extra = {}) =>
  webPopupTabs.open({
    source,
    document,
    proxyUrl,
    url: `${proxyUrl}takecontrol?token=private`,
    isCurrent: () => true,
    ...extra,
  });
afterEach(() => {
  webPopupTabs.revokeSource(source.id);
  window.document.querySelectorAll("iframe").forEach((frame) => frame.remove());
});

function titleViewer(extra = {}) {
  const session = open({
    url: `${proxyUrl}takecontrol/opaque-agent?token=private`,
    ...extra,
  });
  const frame = window.document.createElement("iframe");
  window.document.body.append(frame);
  const lease = webPopupTabs.attachViewer(session.id, frame)!;
  lease.navigate();
  const payload = {
    version: 1,
    sessionId: document.sessionId,
    documentSequence: 4,
    documentToken: "c".repeat(32),
    navigationToken: null,
    popupParentSequence: document.sequence,
    url: `${proxyUrl}takecontrol/opaque-agent?secret=private`,
    title: "PC-WEST-01 - Client - Site | Take Control",
  };
  const event = (type = "proxy_web_popup_title", fields = {}, envelope = {}) =>
    new MessageEvent("message", {
      source: frame.contentWindow,
      origin: new URL(proxyUrl).origin,
      data: { ...payload, type, ...fields },
      ...envelope,
    });
  // Native readiness predates the title channel and omits the parent field.
  const ready = () =>
    lease.receiveTitleReport(
      event("proxy_document_start", {
        popupParentSequence: undefined,
      }),
    );
  return { session, frame, lease, payload, event, ready };
}

describe("source-owned web popup registry", () => {
  it("applies current optional sandbox permissions to popup navigations and revokes them on release", () => {
    const session = open();
    const frame = window.document.createElement("iframe");
    window.document.body.append(frame);
    let allowDownloads = true;
    const lease = webPopupTabs.attachViewer(session.id, frame, () => ({
      allowDownloads,
    }))!;
    expect(lease.navigate()).toBe(true);
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-same-origin allow-scripts allow-forms allow-downloads",
    );
    allowDownloads = false;
    expect(lease.navigate()).toBe(true);
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-same-origin allow-scripts allow-forms",
    );
    webPopupTabs.close(session.id);
    expect(frame).toHaveAttribute("sandbox", "");
  });
  it("requires document-start then exact child identity, and leaves the runtime snapshot unchanged", () => {
    const { session, lease, event, ready } = titleViewer();
    const snapshot = webPopupTabs.getSnapshot(session.id);
    expect(lease.receiveTitleReport(event())).toBeNull();
    ready();
    expect(lease.receiveTitleReport(event())).toBe("PC-WEST-01 — Take Control");
    expect(
      lease.receiveTitleReport(
        event("proxy_web_popup_title", {
          title: "PC-EAST-02 - Client - Site | Take Control",
          // The native reporter strips the registry URL's query and fragment.
          url: `${proxyUrl}takecontrol/opaque-agent`,
        }),
      ),
    ).toBe("PC-EAST-02 — Take Control");
    expect(webPopupTabs.getSnapshot(session.id)).toBe(snapshot);
  });

  it.each([
    { version: 2 },
    { type: "proxy_title" },
    { sessionId: "foreign" },
    { popupParentSequence: 99 },
    { popupParentSequence: "3" },
    { popupParentSequence: undefined },
    { documentSequence: 3 },
    { documentSequence: 5 },
    { documentSequence: 4.5 },
    { documentToken: "d".repeat(32) },
    { documentToken: "invalid" },
    { navigationToken: "d".repeat(32) },
    { navigationToken: undefined },
    { title: null },
    { url: "https://rmm.example.test/" },
    { url: `${proxyUrl}takecontrol/another-agent` },
    {
      url: `${proxyUrl.replace("http://", "http://user@")}takecontrol/opaque-agent`,
    },
    {
      url: `${proxyUrl.replace("http://", "http://:password@")}takecontrol/opaque-agent`,
    },
    { url: "about:blank" },
    { url: null },
    { url: "x".repeat(16_385) },
  ])("rejects a mismatched or malformed title report %j", (fields) => {
    const { lease, event, ready } = titleViewer();
    ready();
    expect(
      lease.receiveTitleReport(event("proxy_web_popup_title", fields)),
    ).toBeNull();
  });

  it("rejects sibling/nested/null sources and foreign origins for readiness and titles", () => {
    const first = titleViewer();
    const sibling = titleViewer();
    const nested = window.document.createElement("iframe");
    window.document.body.append(nested);
    for (const envelope of [
      { source: sibling.frame.contentWindow },
      { source: nested.contentWindow },
      { source: null },
      { source: window },
      { origin: "null" },
      { origin: "https://rmm.example.test" },
      { origin: window.location.origin },
    ]) {
      first.lease.receiveTitleReport(
        first.event("proxy_document_start", {}, envelope),
      );
      expect(first.lease.receiveTitleReport(first.event())).toBeNull();
    }
    first.ready();
    for (const envelope of [
      { source: sibling.frame.contentWindow },
      { source: nested.contentWindow },
      { origin: "null" },
    ])
      expect(
        first.lease.receiveTitleReport(
          first.event("proxy_web_popup_title", {}, envelope),
        ),
      ).toBeNull();
    expect(sibling.lease.receiveTitleReport(first.event())).toBeNull();
  });

  it("invalidates navigation and refuses old starts, tokens, and late title reports", () => {
    const { lease, event, ready } = titleViewer();
    ready();
    lease.receiveTitleReport(event("proxy_navigation_start"));
    ready();
    expect(lease.receiveTitleReport(event())).toBeNull();
    const next = { documentSequence: 5, documentToken: "d".repeat(32) };
    lease.receiveTitleReport(event("proxy_document_start", next));
    ready();
    expect(lease.receiveTitleReport(event())).toBeNull();
    lease.receiveTitleReport(event("proxy_navigation_start"));
    expect(lease.receiveTitleReport(event("proxy_web_popup_title", next))).toBe(
      "PC-WEST-01 — Take Control",
    );
    // Same sequence with a new token cannot replace an accepted document.
    lease.receiveTitleReport(
      event("proxy_document_start", { ...next, documentToken: "e".repeat(32) }),
    );
    expect(lease.receiveTitleReport(event("proxy_web_popup_title", next))).toBe(
      "PC-WEST-01 — Take Control",
    );
  });

  it("registry navigation requires fresh readiness and prevents late former-page names", () => {
    const { session, lease, event, ready } = titleViewer();
    ready();
    webPopupTabs.navigate(session.id, document, `${proxyUrl}takecontrol/next`);
    expect(lease.receiveTitleReport(event())).toBeNull();
    ready();
    expect(lease.receiveTitleReport(event())).toBeNull();
    const next = {
      documentSequence: 5,
      documentToken: "d".repeat(32),
      url: `${proxyUrl}takecontrol/next`,
    };
    lease.receiveTitleReport(event("proxy_document_start", next));
    expect(lease.receiveTitleReport(event("proxy_web_popup_title", next))).toBe(
      "PC-WEST-01 — Take Control",
    );
  });

  it("checks root ownership at report time and refuses revoked or released leases", () => {
    let valid = true;
    const { session, lease, event, ready } = titleViewer({
      isCurrent: () => valid,
    });
    ready();
    valid = false;
    expect(lease.receiveTitleReport(event())).toBeNull();
    valid = true;
    lease.release();
    expect(lease.receiveTitleReport(event())).toBeNull();
    webPopupTabs.close(session.id);
    expect(lease.receiveTitleReport(event())).toBeNull();
  });

  it("does not rename unrelated tool routes", () => {
    const { lease, event, ready } = titleViewer({ url: `${proxyUrl}webterm` });
    ready();
    expect(lease.receiveTitleReport(event())).toBeNull();
  });

  it("does not attach a second untracked frame and rechecks ownership at navigation", () => {
    let valid = true;
    const session = open({ isCurrent: () => valid });
    const first = window.document.createElement("iframe");
    const second = window.document.createElement("iframe");
    const lease = webPopupTabs.attachViewer(session.id, first)!;
    expect(webPopupTabs.attachViewer(session.id, second)).toBeNull();
    valid = false;
    expect(lease.navigate()).toBe(false);
    expect(first.getAttribute("src")).toBeNull();
    expect(second.getAttribute("src")).toBeNull();
  });

  it("revokes all children even if a subscriber or close callback throws", () => {
    const fail = () => {
      throw new Error("observer failure");
    };
    const first = open({ onClose: fail });
    const second = open();
    const unsubscribe = webPopupTabs.subscribe(first.id, fail);
    expect(() => webPopupTabs.revokeSource(source.id)).not.toThrow();
    expect(webPopupTabs.getSnapshot(first.id)).toBeNull();
    expect(webPopupTabs.getSnapshot(second.id)).toBeNull();
    unsubscribe();
  });
  it("returns only opaque session routing metadata, never a URL, identity or source handle", () => {
    const session = open();
    expect(session.protocol).toBe("tool:webPopup");
    expect(session.connectionId).toBe("tool-web-popup");
    expect(session.ownerDatabaseId).toBe("owner");
    for (const secret of [
      proxyUrl,
      "private",
      document.token,
      "proxy-session",
      source.hostname,
    ])
      expect(JSON.stringify(session)).not.toContain(secret);
    expect(webPopupTabs.getSnapshot(session.id)?.url).toContain(
      "token=private",
    );
  });
  it.each([
    "https://rmm.example.test/takecontrol",
    "about:blank",
    "javascript:alert(1)",
    `http://p${"c".repeat(32)}.localhost:9000/`,
    `${proxyUrl}__sortofremoteng_reserved`,
    `${proxyUrl.replace("http://", "http://user:password@")}takecontrol`,
  ])("rejects unmapped or reserved destination %s", (url) => {
    expect(() => open({ url })).toThrow();
  });
  it("rejects stale root proofs and restricts every location update to the same proxy", () => {
    const session = open();
    expect(
      webPopupTabs.navigate(
        session.id,
        { ...document, generation: 5 },
        `${proxyUrl}next`,
      ),
    ).toBe(false);
    expect(
      webPopupTabs.navigate(session.id, document, "https://other.test/"),
    ).toBe(false);
    expect(
      webPopupTabs.close(session.id, { ...document, token: "c".repeat(32) }),
    ).toBe(false);
    expect(webPopupTabs.navigate(session.id, document, `${proxyUrl}next`)).toBe(
      true,
    );
    expect(webPopupTabs.getSnapshot(session.id)?.url).toBe(`${proxyUrl}next`);
  });
  it("bounds children, reuses capacity after close, and notifies closure once", () => {
    const onClose = vi.fn();
    const first = open({ onClose });
    for (let i = 1; i < 8; i++) open();
    expect(() => open()).toThrow(/limit/);
    expect(webPopupTabs.close(first.id)).toBe(true);
    expect(webPopupTabs.close(first.id)).toBe(false);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(first.id);
    expect(() => open()).not.toThrow();
  });
  it("rejects invalid source and owner generations before opening or navigating", () => {
    expect(() => open({ isCurrent: () => false })).toThrow();
    let valid = true;
    const onFocus = vi.fn();
    const session = open({ isCurrent: () => valid, onFocus });
    valid = false;
    expect(webPopupTabs.focus(session.id)).toBe(false);
    expect(webPopupTabs.navigate(session.id, document, `${proxyUrl}next`)).toBe(
      false,
    );
    expect(onFocus).not.toHaveBeenCalled();
    webPopupTabs.revokeSource(source.id, { ...document, generation: 99 });
    expect(webPopupTabs.getSnapshot(session.id)).not.toBeNull();
    webPopupTabs.revokeSource(source.id, document);
    expect(webPopupTabs.getSnapshot(session.id)).toBeNull();
  });
  it("revokes the actual child frame synchronously without touching another source", () => {
    const session = open();
    const frame = window.document.createElement("iframe");
    frame.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms",
    );
    frame.src = `${proxyUrl}takecontrol`;
    webPopupTabs.attachViewer(session.id, frame);
    const other = open({ source: { ...source, id: "another" } });
    webPopupTabs.revokeSource(source.id);
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("src")).toBe("about:blank");
    expect(webPopupTabs.getSnapshot(other.id)).not.toBeNull();
    webPopupTabs.close(other.id);
  });
});
