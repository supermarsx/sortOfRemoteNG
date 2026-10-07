import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_external_link_client.js",
  "utf8",
);
const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const upstream = "https://mail.example.test";
const parentOrigin = "http://localhost:3000";
const identity = {
  sessionId: "owa",
  documentToken: "a".repeat(32),
  documentSequence: 4,
  navigationToken: null,
};
let handlers: Map<string, EventListener>;
let post: ReturnType<typeof vi.fn>;
let parent: { postMessage: ReturnType<typeof vi.fn> };
function arm(overrides = {}, event = {}) {
  handlers.get("message")!({
    source: parent,
    origin: parentOrigin,
    data: {
      ...identity,
      version: 1,
      type: "sorng_owa_external_links",
      enabled: true,
      ...overrides,
    },
    ...event,
  } as unknown as MessageEvent);
}
function click(href: string, overrides = {}) {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  anchor.innerHTML = "<span>Email link</span>";
  document.body.append(anchor);
  const event = {
    target: anchor.firstChild,
    isTrusted: true,
    type: "click",
    button: 0,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  };
  handlers.get(event.type)?.(event as unknown as Event);
  return event;
}
beforeEach(() => {
  handlers = new Map();
  post = vi.fn();
  parent = { postMessage: post };
  vi.spyOn(document, "baseURI", "get").mockReturnValue(`${proxy}/owa/`);
  const frame = {
    parent,
    URL,
    addEventListener: (type: string, handler: EventListener) =>
      handlers.set(type, handler),
    removeEventListener: (type: string) => handlers.delete(type),
  };
  new Function(
    "window",
    "location",
    "identity",
    "sourceOrigin",
    `${source};installOwaExternalLinks(identity,sourceOrigin);`,
  )(frame, new URL(`${proxy}/owa/`), identity, upstream);
});
afterEach(() => {
  handlers.get("pagehide")?.(new Event("pagehide"));
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("OWA external link capture", () => {
  it.each([
    "https://news.example.test/article?q=a%20b&sig=x%2By#part",
    "//news.example.test/article?q=a%20b&sig=x%2By#part",
    `/owa/redir.aspx?C=mailbox-secret&URL=${encodeURIComponent("https://news.example.test/article?q=a%20b&sig=x%2By#part")}`,
    `${upstream}/owa/shared@example.test/redir.aspx?url=${encodeURIComponent("https://news.example.test/article?q=a%20b&sig=x%2By#part")}&cookie=private`,
    `${proxy}/__sortofremoteng_public_navigation_v1?destination=${encodeURIComponent("https://news.example.test/article?q=a%20b&sig=x%2By#part")}&document=4&__sorng_generation_v1=private`,
  ])("reports the upstream link without wrapper tokens: %s", (url) => {
    arm();
    const event = click(url);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledExactlyOnceWith(
      {
        ...identity,
        version: 1,
        type: "sorng_owa_external_link",
        destinationUrl:
          "https://news.example.test/article?q=a%20b&sig=x%2By#part",
      },
      parentOrigin,
    );
    expect(JSON.stringify(post.mock.calls)).not.toMatch(
      /mailbox-secret|private|localhost:43123/,
    );
  });
  it.each([
    "/owa/?ae=Item&id=123",
    "#inbox",
    "?path=/mail",
    "?path=/options",
    "/owa/?search=subject%3Ainvoice",
    "/ecp/",
    `${upstream}/ecp/?rfr=owa`,
    `${upstream}/owa/`,
    `${proxy}/owa/#mail`,
    "/owa/auth/logon.aspx",
    "javascript:doMailAction()",
    "file:///C:/secret",
    "data:text/html,hello",
    "app://settings",
    "https://user:secret@news.example.test/",
    "/owa/redir.aspx?URL=javascript%3Aalert(1)",
    "/owa/redir.aspx?URL=https://one.test&url=https://two.test",
  ])(
    "leaves ordinary OWA interactions and invalid URLs to existing policy: %s",
    (url) => {
      arm();
      const event = click(url);
      expect(post).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    },
  );
  it("preserves SafeLinks query signatures through an OWA redirect wrapper", () => {
    const safeLink =
      "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fnews.example.test%2Fa%3Fsig%3Dx%252By&data=signed%2Bdata&sdata=a%2Bb&reserved=0";
    arm();
    click(
      `/owa/redir.aspx?C=mailbox-secret&URL=${encodeURIComponent(safeLink)}`,
    );
    expect(post.mock.calls[0][0].destinationUrl).toBe(safeLink);
  });
  it("requires both parent arming and a real click; scripts and redirects cannot request opening", () => {
    click("https://news.example.test/");
    arm({ documentToken: "stale" });
    click("https://news.example.test/");
    arm({}, { source: {} });
    click("https://news.example.test/");
    arm();
    click("https://news.example.test/", { isTrusted: false });
    expect(post).not.toHaveBeenCalled();
    click("https://news.example.test/", { type: "auxclick", button: 1 });
    expect(post).toHaveBeenCalledOnce();
    arm({ enabled: false });
    click("https://news.example.test/");
    expect(post).toHaveBeenCalledOnce();
  });
  it("removes observers when the document leaves", () => {
    arm();
    handlers.get("pagehide")!(new Event("pagehide"));
    expect(handlers.size).toBe(0);
  });
  it.each([`${proxy}/owa/message`, "about:blank", "about:srcdoc"])(
    "captures email links in an accessible %s message frame using the root identity",
    (address) => {
      const child = document.createElement("iframe");
      document.body.append(child);
      vi.spyOn(child.contentDocument!, "URL", "get").mockReturnValue(address);
      vi.spyOn(child.contentDocument!, "baseURI", "get").mockReturnValue(
        address,
      );
      const listen = vi.spyOn(child.contentWindow!, "addEventListener");
      arm();
      const handler = listen.mock.calls.find(
        ([type, , capture]) => type === "click" && capture === true,
      )?.[1] as EventListener;
      expect(handler).toBeTypeOf("function");
      const anchor = child.contentDocument!.createElement("a");
      anchor.href = "https://news.example.test/from-message?signature=x%2By";
      child.contentDocument!.body.append(anchor);
      const preventDefault = vi.fn();
      handler({
        target: anchor,
        type: "click",
        button: 0,
        isTrusted: true,
        preventDefault,
        stopImmediatePropagation: vi.fn(),
      } as unknown as Event);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(post).toHaveBeenCalledExactlyOnceWith(
        {
          ...identity,
          version: 1,
          type: "sorng_owa_external_link",
          destinationUrl: anchor.href,
        },
        parentOrigin,
      );
    },
  );
  it("discovers inserted frames, rebinds loaded documents, and removes departed frames", async () => {
    arm();
    const child = document.createElement("iframe");
    // jsdom can fire iframe load synchronously on insertion. Keep its document
    // unavailable until the observer turn to exercise discovery independently.
    let unavailable = vi
      .spyOn(child, "contentDocument", "get")
      .mockReturnValue(null);
    document.body.append(child);
    const oldWindow = child.contentWindow!;
    const listen = vi.spyOn(oldWindow, "addEventListener");
    const remove = vi.spyOn(oldWindow, "removeEventListener");
    unavailable.mockRestore();
    await vi.waitFor(() =>
      expect(listen).toHaveBeenCalledWith("click", expect.any(Function), true),
    );
    unavailable = vi
      .spyOn(child, "contentDocument", "get")
      .mockReturnValue(null);
    child.src = "about:blank";
    const nextWindow = child.contentWindow!;
    const nextListen = vi.spyOn(nextWindow, "addEventListener");
    const nextRemove = vi.spyOn(nextWindow, "removeEventListener");
    unavailable.mockRestore();
    child.dispatchEvent(new Event("load"));
    await vi.waitFor(() =>
      expect(nextListen).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
        true,
      ),
    );
    expect(nextListen).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function), true);
    child.remove();
    await vi.waitFor(() =>
      expect(nextRemove).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
        true,
      ),
    );
  });
  it.each(["inaccessible", "different-origin"])(
    "leaves %s frames and window.open untouched",
    (mode) => {
      const child = document.createElement("iframe");
      document.body.append(child);
      const read = vi.spyOn(child, "contentDocument", "get");
      if (mode === "inaccessible")
        read.mockImplementation(() => {
          throw new DOMException("Blocked", "SecurityError");
        });
      else
        vi.spyOn(child.contentDocument!, "URL", "get").mockReturnValue(
          "https://unrelated.example.test/message",
        );
      const listen = vi.spyOn(child.contentWindow!, "addEventListener");
      const open = window.open;
      expect(() => arm()).not.toThrow();
      expect(read).toHaveBeenCalled();
      expect(listen).not.toHaveBeenCalled();
      expect(window.open).toBe(open);
      expect(post).not.toHaveBeenCalled();
    },
  );
  it("cleans up and rearms root/child listeners without using a revoked watcher", () => {
    const child = document.createElement("iframe");
    document.body.append(child);
    const listen = vi.spyOn(child.contentWindow!, "addEventListener");
    const remove = vi.spyOn(child.contentWindow!, "removeEventListener");
    arm();
    const handler = listen.mock.calls.find(
      ([type, , capture]) => type === "click" && capture === true,
    )![1] as EventListener;
    const anchor = child.contentDocument!.createElement("a");
    anchor.href = "https://news.example.test/message";
    const event = {
      target: anchor,
      type: "click",
      button: 0,
      isTrusted: true,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as Event;
    arm({ enabled: false });
    expect(remove).toHaveBeenCalledWith("click", handler, true);
    handler(event);
    expect(post).not.toHaveBeenCalled();
    arm();
    handler(event);
    expect(post).toHaveBeenCalledOnce();
    expect(
      listen.mock.calls.filter(
        ([type, , capture]) => type === "click" && capture === true,
      ),
    ).toHaveLength(2);
    handlers.get("pagehide")!(new Event("pagehide"));
    handler(event);
    expect(post).toHaveBeenCalledOnce();
  });
  it("releases observers when a previously accessible frame navigates cross-origin", async () => {
    const child = document.createElement("iframe");
    document.body.append(child);
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    arm();
    const remove = vi
      .spyOn(child.contentWindow!, "removeEventListener")
      .mockImplementation(() => {
        throw new DOMException("Cross-origin window", "SecurityError");
      });
    vi.spyOn(child, "contentDocument", "get").mockReturnValue(null);
    child.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(remove).toHaveBeenCalled());
    expect(disconnect).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
  });
  it("ignores frame-free OWA mutations and coalesces frame mutations and loads", async () => {
    const scan = vi.spyOn(document, "querySelectorAll");
    const rootScans = () =>
      scan.mock.calls.filter(([selector]) => selector === "iframe,frame")
        .length;
    arm();
    expect(rootScans()).toBe(1);
    for (let i = 0; i < 20; i++) {
      const row = document.createElement("div");
      row.innerHTML = "<span>Updated message</span>";
      document.body.append(row);
      row.textContent = "Changed search result";
    }
    const image = document.createElement("img");
    document.body.append(image);
    image.dispatchEvent(new Event("load"));
    await new Promise<void>((resolve) =>
      queueMicrotask(() => queueMicrotask(resolve)),
    );
    expect(rootScans()).toBe(1);
    const first = document.createElement("iframe");
    const second = document.createElement("iframe");
    document.body.append(first, second);
    first.dispatchEvent(new Event("load"));
    second.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(rootScans()).toBe(2));
    first.remove();
    second.remove();
    await vi.waitFor(() => expect(rootScans()).toBe(3));
  });
});
