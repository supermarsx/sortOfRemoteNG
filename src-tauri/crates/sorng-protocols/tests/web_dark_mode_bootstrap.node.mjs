import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const source = readFileSync(
  new URL("../src/web_dark_mode_client.js", import.meta.url),
  "utf8",
);
const marker = "__sorng_dark_bootstrap_v1";
function page() {
  const dom = new JSDOM(
    `<html><head><style id="${marker}">html{background:#181a1b}</style></head><body></body></html>`,
    {
      url: "http://pfixture.localhost:42123/",
      runScripts: "outside-only",
    },
  );
  dom.window.TextEncoder = TextEncoder;
  const controller = dom.window.eval(
    `(function(){${source}\nreturn window.__sorngWebDarkModeDocument_v1;})()`,
  );
  return { dom, win: dom.window, doc: dom.window.document, controller };
}

test("first-paint palette remains while the engine loads and is released on takeover", async () => {
  const { dom, win, doc, controller } = page();
  try {
    const original = doc.getElementById(marker);
    assert.ok(original);
    const pending = controller.set({ enabled: true });
    assert.equal(doc.getElementById(marker), original);
    assert.match(
      original.textContent,
      /html:root body.*background-color:#181a1b!important/,
    );
    let enabled = false;
    win.DarkReader = {
      setFetchMethod() {},
      disable() {},
      enable() {
        assert.equal(doc.getElementById(marker), original);
        enabled = true;
      },
    };
    doc.querySelector("script").dispatchEvent(new win.Event("load"));
    assert.equal(await pending, "engine");
    assert.ok(enabled);
    assert.equal(doc.getElementById(marker), null);
  } finally {
    controller.dispose();
    dom.window.close();
  }
});

test("a refused engine replaces the bootstrap with CSS and disable removes both", async () => {
  const { dom, win, doc, controller } = page();
  try {
    const pending = controller.set({ enabled: true });
    assert.ok(doc.getElementById(marker));
    doc.querySelector("script").dispatchEvent(new win.Event("error"));
    assert.equal(await pending, "cssOnly");
    assert.equal(doc.getElementById(marker), null);
    assert.match(
      doc.querySelector(".sorng-website-dark-mode").textContent,
      /background-color:#181a1b/,
    );
    await controller.set({ enabled: false });
    assert.equal(doc.querySelector("style"), null);
  } finally {
    controller.dispose();
    dom.window.close();
  }
});

test("disable during loading cannot resurrect the bootstrap or the engine", async () => {
  const { dom, win, doc, controller } = page();
  try {
    const pending = controller.set({ enabled: true });
    const script = doc.querySelector("script");
    await controller.set({ enabled: false });
    assert.equal(doc.getElementById(marker), null);
    win.DarkReader = {
      setFetchMethod() {},
      disable() {},
      enable() {
        assert.fail("late enable");
      },
    };
    script.dispatchEvent(new win.Event("load"));
    await pending;
    assert.equal(doc.querySelector("style"), null);
  } finally {
    controller.dispose();
    dom.window.close();
  }
});

test("an engine error keeps the explicit dark background until disable", async () => {
  const { dom, win, doc, controller } = page();
  try {
    win.DarkReader = {
      setFetchMethod() {},
      disable() {},
      enable() {
        throw new Error("fixture failure");
      },
    };
    await assert.rejects(controller.set({ enabled: true }), /fixture failure/);
    assert.ok(doc.getElementById(marker));
    await controller.set({ enabled: false });
    assert.equal(doc.getElementById(marker), null);
  } finally {
    controller.dispose();
    dom.window.close();
  }
});
