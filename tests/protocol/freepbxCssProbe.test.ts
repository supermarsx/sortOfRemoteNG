import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_network_client.js",
  "utf8",
);
const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
let controller: {
  dispose(): void;
  mapUrl(value: string, kind: string): string;
};
let report: ReturnType<typeof vi.fn>;
let nativeFetch: ReturnType<typeof vi.fn>;
let nativeXhr: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
let nativeSocket: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
beforeEach(() => {
  vi.stubGlobal("location", new URL(`${proxy}/admin/`));
  vi.spyOn(document, "baseURI", "get").mockReturnValue(`${proxy}/admin/`);
  report = vi.fn();
  nativeFetch = vi.fn().mockResolvedValue({ ok: true });
  nativeXhr = vi.fn();
  nativeSocket = vi.fn();
  vi.stubGlobal("fetch", nativeFetch);
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      open(...args: unknown[]) {
        nativeXhr(...args);
      }
      send() {}
      setRequestHeader() {}
    },
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      constructor(...args: unknown[]) {
        nativeSocket(...args);
      }
    },
  );
  const install = window.eval(
    `(function(){${source}\nreturn installWebNetworkClient;})()`,
  );
  controller = install(
    {
      version: 1,
      sessionId: "freepbx",
      documentSequence: 1,
      requestGeneration: "a".repeat(32),
      sourceOrigin: "https://pbx.example",
      proxyOrigin: proxy,
      mappings: [],
    },
    report,
  );
});
afterEach(() => {
  controller?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FreePBX Modernizr CSS probes", () => {
  // Exact probe from FreePBX/framework release/16.0:
  // amp_conf/htdocs/admin/assets/js/modernizr-3.3.1.min.js (multiplebgs).
  const probe = "background:url(https://),url(https://),red url(https://)";
  it("lets the real support-probe assignment finish without aborting the bundle", () => {
    const setter = vi.spyOn(CSSStyleDeclaration.prototype, "cssText", "set");
    expect(() => {
      document.createElement("a").style.cssText = probe;
    }).not.toThrow();
    expect(setter).toHaveBeenCalledWith(probe);
    expect(report).not.toHaveBeenCalled();
  });
  it.each(["http://", "https://", "HTTPS://"])(
    "preserves exact inert probe %s in dynamic CSS",
    (url) => {
      expect(() =>
        document
          .createElement("div")
          .setAttribute("style", `background:url('${url}')`),
      ).not.toThrow();
      expect(() =>
        document
          .createElement("div")
          .style.setProperty("background", `url(${url})`),
      ).not.toThrow();
      expect(report).not.toHaveBeenCalled();
    },
  );
  it("still routes adjacent real URLs with the current generation", () => {
    const element = document.createElement("div");
    element.setAttribute(
      "style",
      `${probe};list-style-image:url(images/tango.png)`,
    );
    expect(element.getAttribute("style")).toContain(
      `${proxy}/admin/images/tango.png?__sorng_generation_v1=${"a".repeat(32)}`,
    );
  });
  it("preserves existing small inline data image support", () => {
    expect(() =>
      document
        .createElement("div")
        .setAttribute(
          "style",
          'background:url("data:image/png;base64,iVBORw0KGgo=")',
        ),
    ).not.toThrow();
    expect(report).not.toHaveBeenCalled();
  });
  it.each([
    "https://evil.example/a.png",
    "javascript:alert",
    "https://user:secret@pbx.example/a",
    "https://[",
  ])("keeps rejecting unsafe CSS URL %s", (url) => {
    expect(() =>
      document
        .createElement("div")
        .setAttribute("style", `background:url('${url}')`),
    ).toThrow();
  });
  it("does not extend the exception to imports or network APIs", () => {
    expect(() =>
      document
        .createElement("div")
        .setAttribute("style", '@import url("https://")'),
    ).toThrow();
    expect(() => controller.mapUrl("https://", "fetch")).toThrow();
  });
  it.each(["http://", "https://", "https://unapproved.example/probe"])(
    "blocks CSS imports, fetch and XHR before native calls: %s",
    async (url) => {
      expect(() =>
        new CSSStyleSheet().insertRule(`@import url("${url}");`),
      ).toThrow();
      await expect(window.fetch(url)).rejects.toThrow();
      expect(() => new XMLHttpRequest().open("GET", url)).toThrow();
      expect(nativeFetch).not.toHaveBeenCalled();
      expect(nativeXhr).not.toHaveBeenCalled();
    },
  );
  it.each([
    "http://",
    "https://",
    "ws://",
    "wss://",
    "wss://unapproved.example/probe",
  ])("blocks WebSocket before its native constructor: %s", (url) => {
    expect(() => new WebSocket(url)).toThrow();
    expect(nativeSocket).not.toHaveBeenCalled();
  });
});
