import { readFileSync } from "node:fs";
import { TextEncoder } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBSITE_DARK_THEME } from "../../src/utils/connection/websiteDarkMode";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_dark_mode_client.js",
  "utf8",
);
const REGISTRY = "__sorngWebDarkMode_v1";
const MARKER = "__sorngWebDarkModeDocument_v1";

interface Controller {
  set(payload: unknown): Promise<string | undefined>;
  dispose(): void;
}
interface Registry {
  payload: { enabled: boolean; cssOnly?: boolean } | null;
  revision: number;
  subscribers: unknown[];
}
interface Realm {
  frame: HTMLIFrameElement;
  win: Window & Record<string, any>;
  doc: Document;
  controller: Controller | null;
}

const theme = (values: Record<string, unknown> = {}) => ({
  ...DEFAULT_WEBSITE_DARK_THEME,
  ...values,
});
const styles = (doc: Document) =>
  Array.from(doc.querySelectorAll("style.sorng-website-dark-mode"));
const text = (doc: Document) => styles(doc)[0]?.textContent ?? "";
const registryOf = (realm: Realm) => realm.win[REGISTRY] as Registry;
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const engine = () => ({
  enable: vi.fn(),
  disable: vi.fn(),
  setFetchMethod: vi.fn(),
});

const realms: Realm[] = [];

/** The app window as the page sees it: reading its location throws. */
function appWindow() {
  const app = {};
  Object.defineProperty(app, "location", {
    get() {
      throw new Error("cross-origin");
    },
  });
  Object.defineProperty(app, "parent", { value: app });
  return app;
}

/** One proxied document, i.e. one same-origin realm the readiness IIFE runs in. */
function frameIn(host: Document, name: string): Realm {
  const frame = host.createElement("iframe");
  frame.setAttribute("name", name);
  (host.body ?? host.documentElement).appendChild(frame);
  const win = frame.contentWindow as Window & Record<string, any>;
  win.TextEncoder = TextEncoder;
  const realm: Realm = {
    frame,
    win,
    doc: frame.contentDocument as Document,
    controller: null,
  };
  realms.push(realm);
  return realm;
}

/** The outermost proxied document: the next hop up is the app, cross-origin. */
function proxiedRoot(): Realm {
  const realm = frameIn(document, "proxy-root");
  Object.defineProperty(realm.win, "parent", {
    value: appWindow(),
    configurable: true,
  });
  return realm;
}

/**
 * Run the real injected source in a realm exactly as the readiness IIFE does:
 * nothing here calls into it, so a controller exists only because the file
 * installs itself eagerly as its own last statement.
 */
function install(realm: Realm, reader?: ReturnType<typeof engine>): Controller {
  if (reader) {
    const nodes: HTMLStyleElement[] = [];
    reader.enable.mockImplementation(() => {
      for (const [kind, css] of [
        ["user-agent", "html{color:white}"],
        ["fallback", ""],
      ]) {
        const node = realm.doc.createElement("style");
        node.className = `darkreader darkreader--${kind}`;
        node.textContent = css;
        realm.doc.head.append(node);
        nodes.push(node);
      }
      realm.doc.documentElement.setAttribute("data-darkreader-mode", "dynamic");
    });
    reader.disable.mockImplementation(() => {
      nodes.splice(0).forEach((node) => node.remove());
      realm.doc.documentElement.removeAttribute("data-darkreader-mode");
    });
    realm.win.DarkReader = reader;
  }
  realm.win.eval(`(function(){${source}})()`);
  realm.controller = realm.win[MARKER] as Controller;
  return realm.controller;
}

function unproxiedFrame(host: Realm, markup: string) {
  const frame = host.doc.createElement("iframe");
  host.doc.body.appendChild(frame);
  const written = frame.contentDocument as Document;
  written.open();
  written.write(markup);
  written.close();
  return frame;
}

afterEach(() => {
  for (const realm of realms.splice(0).reverse()) {
    try {
      realm.controller?.dispose();
    } catch {
      // The realm may already be gone with its frame.
    }
    realm.frame.remove();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("dark-mode delivery across frames", () => {
  it("themes a frame that loads after the command, with no message of its own", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "main{color:rgb(1,2,3)}" }),
    });
    expect(styles(root.doc)).toHaveLength(1);

    const late = frameIn(root.doc, "late");
    install(late);
    await settled();

    expect(styles(late.doc)).toHaveLength(1);
    expect(text(late.doc)).toContain("main{color:rgb(1,2,3)}");
    expect(registryOf(root).revision).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(late.win, REGISTRY)).toBe(
      false,
    );
  });

  it("fans one command out to every open frame and survives a frame that cannot be styled", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const first = frameIn(root.doc, "first");
    install(first);
    const second = frameIn(root.doc, "second");
    install(second);
    const sealed = frameIn(root.doc, "sealed");
    install(sealed);
    Object.defineProperty(sealed.doc, "createElement", {
      configurable: true,
      value: () => {
        throw new Error("This document is sealed");
      },
    });

    await expect(
      controller.set({
        enabled: true,
        theme: theme({
          mode: "customCss",
          customCss: "main{color:rgb(9,9,9)}",
        }),
      }),
    ).resolves.toBeUndefined();

    expect(registryOf(root).subscribers).toHaveLength(4);
    expect(styles(root.doc)).toHaveLength(1);
    expect(styles(first.doc)).toHaveLength(1);
    expect(styles(second.doc)).toHaveLength(1);
    expect(styles(sealed.doc)).toHaveLength(0);
  });

  it("still reports a failure of the document the app addressed", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const child = frameIn(root.doc, "child");
    install(child);

    await expect(
      controller.set({ enabled: true, theme: theme({ brightness: 999 }) }),
    ).rejects.toThrow("Invalid dark-mode adjustment");
    expect(styles(root.doc)).toHaveLength(0);
    expect(styles(child.doc)).toHaveLength(0);
  });

  it("unregisters a frame on pagehide while retaining its outgoing dark paint", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const child = frameIn(root.doc, "child");
    install(child);
    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "main{color:rgb(1,1,1)}" }),
    });
    expect(styles(child.doc)).toHaveLength(1);

    child.win.dispatchEvent(new child.win.Event("pagehide"));
    expect(styles(child.doc)).toHaveLength(1);
    expect(registryOf(root).subscribers).toHaveLength(1);

    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "main{color:rgb(2,2,2)}" }),
    });
    expect(text(child.doc)).toContain("main{color:rgb(1,1,1)}");
    expect(text(root.doc)).toContain("main{color:rgb(2,2,2)}");
  });

  it("registers three levels of nesting on the outermost realm and filters there only", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const one = frameIn(root.doc, "one");
    install(one);
    const two = frameIn(one.doc, "two");
    install(two);
    const three = frameIn(two.doc, "three");
    install(three);

    await controller.set({ enabled: true, theme: theme({ mode: "filter" }) });

    expect(registryOf(root).subscribers).toHaveLength(4);
    expect(text(root.doc)).toContain("filter:invert(100%) hue-rotate(180deg)");
    for (const realm of [one, two, three]) {
      expect(Object.prototype.hasOwnProperty.call(realm.win, REGISTRY)).toBe(
        false,
      );
      expect(text(realm.doc)).toContain("img,video,canvas,svg image");
      expect(text(realm.doc)).not.toContain("html{color-scheme:dark");
    }
  });

  it("converts every frame in dynamicFilter mode but adjusts only the outermost", async () => {
    const root = proxiedRoot();
    const outer = engine();
    const controller = install(root, outer);
    const child = frameIn(root.doc, "child");
    const inner = engine();
    install(child, inner);

    await controller.set({
      enabled: true,
      theme: theme({ mode: "dynamicFilter", brightness: 90 }),
    });

    expect(outer.enable).toHaveBeenCalledOnce();
    expect(inner.enable).toHaveBeenCalledOnce();
    expect(text(root.doc)).toContain("html{filter:brightness(90%)");
    expect(styles(child.doc)).toHaveLength(1);
    expect(text(child.doc)).toContain("#cpanel_body");
  });

  it("falls back to CSS in every frame, late ones included, when the engine is refused", async () => {
    const root = proxiedRoot();
    const outer = engine();
    const controller = install(root, outer);
    const child = frameIn(root.doc, "child");
    const inner = engine();
    install(child, inner);

    await controller.set({
      enabled: true,
      cssOnly: true,
      theme: theme({ mode: "dynamicFilter", brightness: 90 }),
    });
    await settled();

    expect(outer.enable).not.toHaveBeenCalled();
    expect(inner.enable).not.toHaveBeenCalled();
    // The reason travels with the command, so a frame never has to discover it.
    expect(registryOf(root).payload).toMatchObject({ cssOnly: true });
    for (const doc of [root.doc, child.doc]) {
      expect(text(doc)).toContain("html,body{background-color:#181a1b");
      expect(text(doc)).toContain("font[color]");
      expect(text(doc)).not.toContain("html{filter:");
    }

    const late = frameIn(root.doc, "late");
    const lateEngine = engine();
    install(late, lateEngine);
    await settled();
    expect(lateEngine.enable).not.toHaveBeenCalled();
    expect(text(late.doc)).toContain("html,body{background-color:#181a1b");
  });

  it("toggling the extension off and on again re-themes every frame", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const child = frameIn(root.doc, "child");
    install(child);

    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "main{color:rgb(5,5,5)}" }),
    });
    await controller.set({ enabled: false });
    expect(styles(root.doc)).toHaveLength(0);
    expect(styles(child.doc)).toHaveLength(0);
    expect(registryOf(root).payload?.enabled).toBe(false);

    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "main{color:rgb(6,6,6)}" }),
    });
    expect(text(child.doc)).toContain("main{color:rgb(6,6,6)}");
    expect(registryOf(root).revision).toBe(3);
  });

  it("gives a frame that navigates the stored command at its new document start", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const before = frameIn(root.doc, "nav");
    install(before);
    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "main{color:rgb(4,4,4)}" }),
    });
    expect(text(before.doc)).toContain("main{color:rgb(4,4,4)}");

    before.win.dispatchEvent(new before.win.Event("pagehide"));
    before.frame.remove();
    const after = frameIn(root.doc, "nav");
    install(after);
    await settled();

    expect(text(after.doc)).toContain("main{color:rgb(4,4,4)}");
    expect(registryOf(root).subscribers).toHaveLength(2);
  });
});

describe("dark-mode delivery into frameset documents", () => {
  it("paints the gutters through bordercolor, skips the engine and restores both", async () => {
    const root = proxiedRoot();
    const outer = root.doc.createElement("frameset");
    outer.setAttribute("bordercolor", "#cccccc");
    root.doc.documentElement.appendChild(outer);
    const inner = root.doc.createElement("frameset");
    outer.appendChild(inner);
    const reader = engine();
    const controller = install(root, reader);

    await controller.set({ enabled: true, theme: theme() });

    // The engine converts a frameset document invisibly: its frames carry the
    // content, and only the bordercolor attribute repaints the gutters.
    expect(reader.enable).not.toHaveBeenCalled();
    expect(outer.getAttribute("bordercolor")).toBe("#181a1b");
    expect(inner.getAttribute("bordercolor")).toBe("#181a1b");
    expect(text(root.doc)).toContain(
      "html,frameset{background-color:#181a1b!important;}",
    );

    await controller.set({ enabled: false });
    expect(outer.getAttribute("bordercolor")).toBe("#cccccc");
    expect(inner.hasAttribute("bordercolor")).toBe(false);
    expect(styles(root.doc)).toHaveLength(0);
  });

  it("lets the frames answer for a frameset root that skipped the engine", async () => {
    const root = proxiedRoot();
    const set = root.doc.createElement("frameset");
    root.doc.documentElement.appendChild(set);
    const outer = engine();
    const controller = install(root, outer);
    const first = frameIn(root.doc, "first");
    install(first, engine());
    const second = frameIn(root.doc, "second");
    install(second, engine());

    expect(await controller.set({ enabled: true, theme: theme() })).toBe(
      "engine",
    );
    expect(outer.enable).not.toHaveBeenCalled();
  });

  it("calls the whole page CSS-only as soon as one frame misses the engine", async () => {
    const root = proxiedRoot();
    const outer = engine();
    const controller = install(root, outer);
    const child = frameIn(root.doc, "child");
    install(child);

    const pending = controller.set({ enabled: true, theme: theme() });
    // Only this frame's realm lacks the engine; the root converted normally.
    const script = child.doc.querySelector("script");
    script?.dispatchEvent(new child.win.Event("error"));

    expect(await pending).toBe("cssOnly");
    expect(outer.enable).toHaveBeenCalledOnce();
    expect(text(child.doc)).toContain("html,body{background-color:#181a1b");
  });

  it("leaves the gutters of an inverted page alone in filter mode", async () => {
    const root = proxiedRoot();
    const frameset = root.doc.createElement("frameset");
    root.doc.documentElement.appendChild(frameset);
    const controller = install(root);

    await controller.set({
      enabled: true,
      theme: theme({ mode: "filter", backgroundColor: "#000000" }),
    });

    // The whole-page inversion darkens the gutters by itself; painting them a
    // pre-inverted colour tints them instead (measured green in real Edge).
    expect(frameset.hasAttribute("bordercolor")).toBe(false);
    expect(text(root.doc)).toContain("filter:invert(100%) hue-rotate(180deg)");
    expect(text(root.doc)).not.toContain("html,frameset{background-color:");
  });

  it("paints a frameset that only arrives after the command did", async () => {
    const root = proxiedRoot();
    const reader = engine();
    const controller = install(root, reader);
    await controller.set({ enabled: true, theme: theme() });
    expect(reader.enable).toHaveBeenCalledOnce();
    expect(styles(root.doc)).toHaveLength(1);
    expect(text(root.doc)).toContain("#cpanel_body");

    const frameset = root.doc.createElement("frameset");
    root.doc.documentElement.appendChild(frameset);
    root.doc.dispatchEvent(new root.win.Event("DOMContentLoaded"));

    expect(frameset.getAttribute("bordercolor")).toBe("#181a1b");
    expect(text(root.doc)).toContain("html,frameset{background-color:");
  });
});

describe("dark-mode delivery into documents the proxy never served", () => {
  it("styles a document.write frame with CSS only and overrides its colour attributes", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const proxied = frameIn(root.doc, "proxied");
    install(proxied);
    const frame = unproxiedFrame(
      root,
      '<html data-doc="written"><body bgcolor="#ffffff" text="#000000">' +
        '<font color="#000000">Line</font></body></html>',
    );

    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "" }),
    });

    const written = frame.contentDocument as Document;
    expect(styles(written)).toHaveLength(1);
    expect(text(written)).toContain(
      "[bgcolor]{background-color:#181a1b!important;}",
    );
    expect(text(written)).toContain(
      "font[color],font[color] *{color:inherit!important;}",
    );
    expect(text(written)).toContain("html,body{background-color:#181a1b");
    // A proxied frame themes itself; it must not also be styled from here.
    expect(styles(proxied.doc)).toHaveLength(1);

    await controller.set({ enabled: false });
    expect(styles(written)).toHaveLength(0);
  });

  it("adopts a frame added after the command and stops once the extension is off", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "" }),
    });

    // Microtasks only: the mutation observer is the one path that can reach a
    // frame added after the document's own load event has already fired.
    const late = unproxiedFrame(root, "<html><body><p>Late</p></body></html>");
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() =>
      expect(styles(late.contentDocument as Document)).toHaveLength(1),
    );

    await controller.set({ enabled: false });
    const after = unproxiedFrame(
      root,
      "<html><body><p>After</p></body></html>",
    );
    await settled();
    expect(styles(after.contentDocument as Document)).toHaveLength(0);
    expect(styles(late.contentDocument as Document)).toHaveLength(0);
  });

  it("skips a frame it cannot reach and keeps styling the rest", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const hostile = root.doc.createElement("iframe");
    Object.defineProperty(hostile, "contentDocument", {
      get() {
        throw new Error("cross-origin");
      },
    });
    root.doc.body.appendChild(hostile);
    const reachable = unproxiedFrame(
      root,
      "<html><body><p>Ok</p></body></html>",
    );

    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss", customCss: "" }),
    });

    expect(styles(reachable.contentDocument as Document)).toHaveLength(1);
  });

  it("leaves the frames of an inverted page to the outermost filter", async () => {
    const root = proxiedRoot();
    const controller = install(root);
    const frame = unproxiedFrame(
      root,
      "<html><body><p>Inverted</p></body></html>",
    );

    await controller.set({ enabled: true, theme: theme({ mode: "filter" }) });

    const written = frame.contentDocument as Document;
    expect(text(written)).toContain("img,video,canvas,svg image");
    expect(text(written)).not.toContain("html,body{background-color:");
  });
});

describe("the root-realm dark-mode registry", () => {
  it("is defined once, cannot be replaced, and is joined rather than rebuilt", () => {
    const root = proxiedRoot();
    install(root);
    const descriptor = Object.getOwnPropertyDescriptor(
      root.win,
      REGISTRY,
    ) as PropertyDescriptor;

    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.writable).toBe(false);
    expect(descriptor.configurable).toBe(false);
    expect(() =>
      Object.defineProperty(root.win, REGISTRY, { value: {} }),
    ).toThrow();

    const registry = registryOf(root);
    const child = frameIn(root.doc, "child");
    install(child);
    expect(registryOf(root)).toBe(registry);
    expect(registry.subscribers).toHaveLength(2);
  });

  it("installs one controller per document however often the file runs", async () => {
    const root = proxiedRoot();
    const reader = engine();
    const first = install(root, reader);
    root.win.eval(`(function(){${source}})()`);
    const second = root.win[MARKER] as Controller;

    expect(second).toBe(first);
    expect(root.win[MARKER]).toBe(first);
    expect(registryOf(root).subscribers).toHaveLength(1);

    await first.set({ enabled: true, theme: theme() });
    expect(reader.enable).toHaveBeenCalledOnce();
    expect(styles(root.doc)).toHaveLength(1);
    expect(text(root.doc)).toContain("#cpanel_body");
  });
});
