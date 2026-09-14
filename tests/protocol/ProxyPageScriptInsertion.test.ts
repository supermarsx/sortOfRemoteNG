import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

// jsdom is the existing test environment dependency; no browser or network is used.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: Record<string, unknown>,
  ) => {
    window: Window & {
      __sorng_synology_login?: {
        getStatus(): { phase: string; reason: string };
        cancel(): void;
      };
      __sorng_autologin?: { cancel(): void };
    };
  };
};
const fixtures = JSON.parse(
  readFileSync("tests/fixtures/proxy-page-script-insertion.json", "utf8"),
) as Array<{ name: string; input: string; expected: string }>;
const base = "src-tauri/crates/sorng-protocols/src/";
const assets = `<script>${["bitwarden_autologin_client.js", "synology_autologin_client.js", "autologin_client.js"].map((path) => readFileSync(base + path, "utf8")).join("")}</script>`;
const native = readFileSync(base + "themed_autologin.rs", "utf8");
const template = native.match(
  /r#"(<script>\(function\(\)\{\{\n'use strict';\nvar NONCE=[\s\S]*?<\/script>)"#/u,
)?.[1];
if (!template)
  throw new Error("Native automatic-login bootstrap fixture is unavailable");
const bootstrap = template
  .replace("{nonce:?}", JSON.stringify("a".repeat(32)))
  .replace("{selectors_json}", "null")
  .replace("{flow_hint}", ", 'synology'")
  .replaceAll("{{", "{")
  .replaceAll("}}", "}");
const scripts = assets + bootstrap;
async function parse(html: string) {
  const request = vi.fn(() =>
    Promise.reject(new Error("No network in this fixture")),
  );
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://127.0.0.1:43210/",
    beforeParse: (window: Window) => {
      window.fetch = request;
    },
  });
  if (dom.window.document.readyState !== "complete")
    await new Promise<void>((resolve) =>
      dom.window.addEventListener("load", () => resolve(), { once: true }),
    );
  return { dom, request };
}
function close(dom: InstanceType<typeof JSDOM>) {
  dom.window.__sorng_autologin?.cancel();
  dom.window.__sorng_synology_login?.cancel();
  dom.window.close();
}
describe("executable page-login injection fixtures shared with the native inserter", () => {
  it("reproduces the old literal-closing-body bug: username input exists but login assets never execute", async () => {
    const fixture = fixtures.find(
      (value) => value.name === "commented closing body",
    )!;
    const { dom, request } = await parse(
      fixture.input.replace("</body>", scripts + "</body>"),
    );
    try {
      expect(
        dom.window.document.querySelector("input[name=username]"),
      ).not.toBeNull();
      expect(dom.window.__sorng_synology_login).toBeUndefined();
      expect(dom.window.__sorng_autologin).toBeUndefined();
      expect(request).not.toHaveBeenCalled();
    } finally {
      close(dom);
    }
  });
  it.each(fixtures)(
    "$name keeps assets executable only outside inert context",
    async (fixture) => {
      // Native tests compare its actual output to this exact shared golden document.
      const inserted = fixture.expected.includes("__SORNG_PAGE_SCRIPTS__");
      const { dom, request } = await parse(
        fixture.expected.replace("__SORNG_PAGE_SCRIPTS__", scripts),
      );
      try {
        expect(
          dom.window.document.querySelector("input[name=username]"),
        ).not.toBeNull();
        if (inserted) {
          expect(dom.window.__sorng_autologin).toBeDefined();
          expect(dom.window.__sorng_synology_login?.getStatus()).toEqual({
            phase: "waiting_root",
            reason: "root-missing",
          });
        } else expect(dom.window.__sorng_synology_login).toBeUndefined();
        // The synthetic field is deliberately not a reviewed DSM form: no credentials.
        expect(request).not.toHaveBeenCalled();
      } finally {
        close(dom);
      }
    },
  );
});
