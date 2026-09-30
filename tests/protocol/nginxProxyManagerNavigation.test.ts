import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_network_client.js",
  "utf8",
);
const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
const upstream = "https://npm.example.test";
const generation = "0123456789abcdef0123456789abcdef";
let controller: { dispose(): void } | undefined;
let report: ReturnType<typeof vi.fn>;
let nativeFetch: ReturnType<typeof vi.fn>;
let base: HTMLBaseElement;
const cleanups: Array<() => void> = [];

function listen(target: EventTarget, handler: EventListener) {
  target.addEventListener("click", handler);
  cleanups.push(() => target.removeEventListener("click", handler));
}

function start(requestGeneration: string | null = generation) {
  const install = window.eval(
    `(function(){${source}\nreturn installWebNetworkClient;})()`,
  );
  controller = install(
    {
      version: 1,
      sessionId: "npm-navigation-fixture",
      documentSequence: 3,
      requestGeneration,
      sourceOrigin: upstream,
      proxyOrigin: proxy,
      mappings: [],
    },
    report,
  );
}

function mount(href = "/nginx/proxy", assignment = "parser") {
  // Exercise both parser-created EJS links and dynamic assignment through the
  // separate attribute/property interception paths.
  document.body.innerHTML = `<a${assignment === "parser" ? ` href="${href}"` : ""}><span>Proxy Hosts</span></a>`;
  const anchor = document.querySelector("a")!;
  if (assignment === "attribute") anchor.setAttribute("href", href);
  if (assignment === "property") anchor.href = href;
  return anchor;
}

function activate(anchor: HTMLAnchorElement) {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  anchor.querySelector("span")!.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.stubGlobal("location", new URL(`${proxy}/portal/page`));
  // jsdom's anchor.href uses the internal document base, not a baseURI getter
  // spy or the stubbed location. Keep native relative resolution realistic.
  base = document.createElement("base");
  base.href = `${proxy}/portal/page`;
  document.head.prepend(base);
  report = vi.fn();
  nativeFetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", nativeFetch);
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  controller?.dispose();
  controller = undefined;
  base.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("legacy Nginx Proxy Manager SPA anchor compatibility", () => {
  // Upstream v2.11.3 semantics confirmed by the coordinating investigation:
  // frontend/js/app/ui/header/main.js:28-39 prevents default and switches on
  // $(e.currentTarget).attr('href') for '/' and '/logout'; dashboard/main.js:17-21
  // prevents default and passes that raw attribute to Controller.navigate.
  // Model delegation with closest(), since native currentTarget is document.
  // This executes our real client, not a duplicate interception implementation.
  describe.each([
    { proof: null, assignment: "parser" },
    { proof: generation, assignment: "parser" },
    { proof: null, assignment: "attribute" },
    { proof: generation, assignment: "attribute" },
    { proof: null, assignment: "property" },
    { proof: generation, assignment: "property" },
  ])(
    "$assignment link with request generation $proof",
    ({ proof, assignment }) => {
      it.each(["/", "/logout"])(
        "preserves the header route switch for %s",
        (href) => {
          start(proof);
          const anchor = mount(href, assignment);
          const home = vi.fn();
          const logout = vi.fn();
          listen(document, (event) => {
            const link = (event.target as Element).closest("a[href]");
            if (!link) return;
            event.preventDefault();
            switch (link.getAttribute("href")) {
              case "/":
                home();
                break;
              case "/logout":
                logout();
                break;
            }
          });

          activate(anchor);

          expect(
            href === "/" ? home : logout,
          ).toHaveBeenCalledExactlyOnceWith();
          expect(href === "/" ? logout : home).not.toHaveBeenCalled();
          expect(nativeFetch).not.toHaveBeenCalled();
          expect(report).not.toHaveBeenCalled();
        },
      );

      it.each(["/nginx/proxy", "/nginx/proxy?filter=a%2Fb+host#details"])(
        "passes the dashboard route %s unchanged to Controller.navigate",
        (href) => {
          start(proof);
          const anchor = mount(href, assignment);
          const navigate = vi.fn();
          listen(document, (event) => {
            const link = (event.target as Element).closest("a[href]");
            if (!link) return;
            event.preventDefault();
            navigate(link.getAttribute("href"));
          });

          activate(anchor);

          expect(navigate).toHaveBeenCalledExactlyOnceWith(href);
          expect(nativeFetch).not.toHaveBeenCalled();
          expect(report).not.toHaveBeenCalled();
        },
      );
    },
  );

  describe.each(["parser", "attribute", "property"])(
    "application handlers on a %s link",
    (assignment) => {
      it.each(["attribute", "property"])(
        "revalidates a foreign href assigned through the %s setter during bubbling",
        (mutation) => {
          start();
          const anchor = mount("/nginx/proxy", assignment);
          const destination =
            "https://foreign.example.test/private?fixture=hidden";
          let atHandler: { canceled: boolean; href: string | null } | undefined;
          listen(document, (event) => {
            atHandler = {
              canceled: event.defaultPrevented,
              href: anchor.getAttribute("href"),
            };
            if (mutation === "property") anchor.href = destination;
            else anchor.setAttribute("href", destination);
            // No cancellation here: window finalization must reject this new
            // destination after capture validated the original local route.
          });
          const reachedWindow = vi.fn();
          listen(window, (event) => reachedWindow(event.defaultPrevented));

          expect(activate(anchor).defaultPrevented).toBe(true);

          expect(atHandler).toEqual({ canceled: false, href: "/nginx/proxy" });
          expect(reachedWindow).toHaveBeenCalledExactlyOnceWith(true);
          expect(anchor.getAttribute("href")).toBe(destination);
          expect(report).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              kind: "navigation",
              reason: "origin-not-approved",
              origin: "https://foreign.example.test",
            }),
          );
          expect(nativeFetch).not.toHaveBeenCalled();
          expect(JSON.stringify(report.mock.calls)).not.toMatch(
            /private|hidden/,
          );
        },
      );

      it("does not restore or stamp an href removed by the application", () => {
        start();
        const anchor = mount("/nginx/proxy", assignment);
        const removeHref = vi.fn(() => anchor.removeAttribute("href"));
        listen(document, removeHref);
        const reachedWindow = vi.fn();
        listen(window, (event) => {
          reachedWindow(anchor.getAttribute("href"));
          // Observe after finalization, then suppress jsdom's activation:
          // it can still schedule navigation when href was removed mid-click.
          event.preventDefault();
        });

        activate(anchor);

        expect(removeHref).toHaveBeenCalledOnce();
        expect(reachedWindow).toHaveBeenCalledExactlyOnceWith(null);
        // Without href there is no anchor navigation default; the finalizer
        // must not revive the pre-handler URL from its deferred entry.
        expect(anchor.hasAttribute("href")).toBe(false);
        expect(anchor.href).toBe("");
        expect(nativeFetch).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
      });

      it("preserves the relative route when the application cancels and stops propagation", () => {
        start();
        const href = "/nginx/proxy?filter=a%2Fb+host#details";
        const anchor = mount(href, assignment);
        const navigate = vi.fn();
        listen(document, (event) => {
          // jQuery return false has these two event effects.
          event.preventDefault();
          event.stopPropagation();
          navigate(anchor.getAttribute("href"));
        });
        const reachedWindow = vi.fn();
        listen(window, reachedWindow);

        expect(activate(anchor).defaultPrevented).toBe(true);

        expect(navigate).toHaveBeenCalledExactlyOnceWith(href);
        expect(reachedWindow).not.toHaveBeenCalled();
        expect(anchor.getAttribute("href")).toBe(href);
        expect(anchor.href).toBe(`${proxy}${href}`);
        expect(nativeFetch).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
      });
    },
  );

  it.each(["/nginx/proxy", `${upstream}/nginx/proxy`])(
    "still prepares the unhandled document link %s with its proxy generation proof",
    (href) => {
      const anchor = mount(href);
      start();
      let observed: { canceled: boolean; href: string } | undefined;
      listen(window, (event) => {
        observed = { canceled: event.defaultPrevented, href: anchor.href };
        // Observe the prepared browser default, then suppress jsdom navigation.
        event.preventDefault();
      });

      activate(anchor);

      expect(observed).toEqual({
        canceled: false,
        href: `${proxy}/nginx/proxy?__sorng_generation_v1=${generation}`,
      });
      expect(nativeFetch).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    },
  );

  it("blocks an unapproved external document link without a native fetch fallback", async () => {
    const destination = "https://foreign.example.test/private?fixture=hidden";
    const anchor = mount(destination);
    start();

    // No fixture listener prevents this click: cancellation must come from
    // the installed compatibility guard, with native policy as the backstop.
    expect(activate(anchor).defaultPrevented).toBe(true);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "navigation",
        reason: "origin-not-approved",
        origin: "https://foreign.example.test",
      }),
    );
    await expect(window.fetch(destination)).rejects.toThrow(
      "origin-not-approved",
    );
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|hidden/);
  });
});
