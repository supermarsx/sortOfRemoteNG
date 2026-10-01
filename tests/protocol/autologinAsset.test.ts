import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";

describe("native auto-login private module assembly", () => {
  it("assembles executable private fragments in native manifest order", () => {
    const source = loadAutologinClient();
    expect(source).not.toContain("/*__SORNG_AUTOLOGIN_MODULES__*/");
    expect(() => new Function(source)).not.toThrow();
    expect(source.indexOf("(function ()")).toBeLessThan(
      source.indexOf("function findLoginForm("),
    );
    expect(source.indexOf("function findLoginForm(")).toBeLessThan(
      source.indexOf("window.__sorng_autologin ="),
    );
    for (const name of [
      "openFreepbxAdmin",
      "porkbunTarget",
      "submitCpanelForm",
      "createCpanelLifecycle",
      "joomlaSubmissionTarget",
      "exchangeEcpTarget",
      "instagramTarget",
      "bootstrapFill",
    ])
      expect(source).toContain(`function ${name}(`);
    expect(source).not.toMatch(/^\s*(import|export) /m);
  });
  it("loads the manifest-declared Adobe client before the coordinator only when requested", () => {
    const source = loadAutologinClient(process.cwd(), ["ADOBE_CLIENT_JS"]);
    expect(() => new Function(source)).not.toThrow();
    expect(source.indexOf("window.__sorng_adobe_login =")).toBeGreaterThan(-1);
    expect(source.indexOf("window.__sorng_adobe_login =")).toBeLessThan(
      source.indexOf("window.__sorng_autologin ="),
    );
    expect(loadAutologinClient()).not.toContain("window.__sorng_adobe_login =");
    expect(() =>
      loadAutologinClient(process.cwd(), ["MISSING_CLIENT_JS"]),
    ).toThrow();
  });
  it("keeps the coordinator small and the application policies in private modules", () => {
    const root = "src-tauri/crates/sorng-protocols/src/";
    const coordinator = readFileSync(root + "autologin_client.js", "utf8");
    expect(coordinator.split("\n").length).toBeLessThan(320);
    expect(coordinator).not.toContain("function findLoginForm(");
    const scheduler = readFileSync(
      root + "autologin/forms/advanced.js",
      "utf8",
    );
    expect(scheduler).not.toContain("function waitForCpanelStability(");
    expect(scheduler).not.toContain("3000");
    expect(scheduler).not.toContain("12000");
  });
});
