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

function cpanelPage() {
  const dom = new JSDOM(
    `<html><head><link rel="stylesheet" href="/cPanel_magic_revision_1/frontend/jupiter/css/app.css"><style id="${marker}">html{background:#181a1b}</style></head><body id="cpanel_body"><main id="content"><section class="panel"><header class="panel-heading">Files</header><div class="panel-body">Manager</div></section></main></body></html>`,
    {
      url: "http://pcpanel.localhost:42123/",
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

test("cPanel surfaces stay covered from bootstrap through dynamic takeover", async () => {
  const { dom, win, doc, controller } = cpanelPage();
  try {
    const pending = controller.set({ enabled: true });
    const bootstrap = doc.getElementById(marker);
    assert.match(bootstrap.textContent, /frontend\/jupiter/);
    assert.match(bootstrap.textContent, /\.panel-body/);
    assert.match(bootstrap.textContent, /rgb\(41,42,43\)/);
    assert.equal(
      win.getComputedStyle(doc.querySelector(".panel-body")).backgroundColor,
      "rgb(41, 42, 43)",
    );

    win.DarkReader = {
      setFetchMethod() {},
      disable() {},
      enable() {},
    };
    doc.querySelector("script").dispatchEvent(new win.Event("load"));
    assert.equal(await pending, "engine");
    assert.equal(doc.getElementById(marker), null);

    const runtime = doc.querySelector(".sorng-website-dark-mode");
    assert.ok(runtime);
    assert.match(runtime.textContent, /frontend\/meridian/);
    assert.match(runtime.textContent, /\.panel-heading/);
    assert.match(runtime.textContent, /rgb\(41,42,43\)/);

    const replacement = doc.createElement("section");
    replacement.className = "panel";
    replacement.innerHTML = '<div class="panel-body">Late panel</div>';
    doc.getElementById("content").replaceChildren(replacement);
    assert.ok(runtime.isConnected);
    assert.match(runtime.textContent, /\.panel-body/);
    assert.equal(
      win.getComputedStyle(replacement.firstElementChild).backgroundColor,
      "rgb(41, 42, 43)",
    );
  } finally {
    controller.dispose();
    dom.window.close();
  }
});

test("pure filter mode does not pre-darken cPanel panels before inversion", async () => {
  const { dom, doc, controller } = cpanelPage();
  try {
    await controller.set({
      enabled: true,
      theme: {
        mode: "filter",
        brightness: 100,
        contrast: 100,
        sepia: 0,
        grayscale: 0,
        backgroundColor: "#181a1b",
        textColor: "#e8e6e3",
        preserveMedia: true,
        customCss: "",
      },
    });
    assert.equal(doc.getElementById(marker), null);
    assert.doesNotMatch(
      doc.querySelector(".sorng-website-dark-mode").textContent,
      /frontend\/jupiter/,
    );
  } finally {
    controller.dispose();
    dom.window.close();
  }
});
