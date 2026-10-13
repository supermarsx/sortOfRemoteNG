// @ts-expect-error - jsdom has no bundled declarations
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PTISP_LOGIN_SELECTORS } from "../../src/utils/connection/ptispProfile";
const base = resolve("src-tauri/crates/sorng-browser-host/src");
const manifest = readFileSync(
  resolve(base, "native_login_profiles.rs"),
  "utf8",
);
const modules = [
  ...manifest.split(");")[0].matchAll(/include_str!\("([^"]+)"\)/g),
]
  .map(([, file]) => readFileSync(resolve(base, file), "utf8"))
  .join("");
const source = readFileSync(resolve(base, "native_login_client.js"), "utf8")
  .replace("/* REVIEWED_FORM_MODULES */", () => modules)
  .replace("/* REVIEWED_PTISP_TOUR */", () =>
    readFileSync(
      "src-tauri/crates/sorng-protocols/src/ptisp_tour_client.js",
      "utf8",
    ),
  )
  .replace("/* NATIVE_KEYBOARD_CLIENT */", () =>
    readFileSync(resolve(base, "native_login_typing.js"), "utf8"),
  );
const pages: any[] = [];
afterEach(async () => {
  for (const page of pages.splice(0)) {
    page.window.dispatchEvent(new page.window.Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    page.window.close();
  }
});
function mount(origin = "https://my.ptisp.pt", reviewed = true) {
  const dom = new JSDOM(
    '<!doctype html><button id="my-tour-close" type="button">Close tour</button>',
    { url: origin + "/login", runScripts: "outside-only" },
  );
  pages.push(dom);
  const win = dom.window;
  win.TextEncoder = TextEncoder;
  win.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 80, height: 24 }] : [];
  };
  const selectors: Record<string, string> = {
    username: PTISP_LOGIN_SELECTORS.usernameSelector,
    password: PTISP_LOGIN_SELECTORS.passwordSelector,
    submit: PTISP_LOGIN_SELECTORS.submitSelector,
  };
  if (!reviewed) selectors.username = "#custom-user";
  let closed = 0,
    confirmed = 0;
  win.document.querySelector("button").addEventListener("click", () => {
    closed++;
    const button = win.document.createElement("button");
    button.type = "submit";
    button.className = "btn btn-primary btn-md";
    button.textContent = "Não mostrar todas";
    button.addEventListener("click", () => confirmed++);
    win.document.body.append(button);
  });
  win.eval(source)(() => {}, { selectors }, "modular-form", false);
  return { closed: () => closed, confirmed: () => confirmed, win };
}
describe("native PTisp tour bridge", () => {
  it("dismisses the requested tour once on the reviewed first-party profile", async () => {
    const tour = mount();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(tour.closed()).toBe(1);
    expect(tour.confirmed()).toBe(1);
  });
  it.each([
    "https://example.test",
    "https://my.ptisp.pt.example.test",
    "http://my.ptisp.pt",
  ])("does not act on %s", async (origin) => {
    const tour = mount(origin);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(tour.closed()).toBe(0);
  });
  it("does not act for a custom form on PTisp", async () => {
    const tour = mount(undefined, false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(tour.closed()).toBe(0);
  });
});
