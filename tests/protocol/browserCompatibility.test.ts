import { describe, expect, it } from "vitest";
import {
  browserCompatibilityOptions,
  browserFormAutomation,
  browserIdentityHeaders,
} from "../../src/utils/protocol/browserCompatibility";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";
import {
  DEFAULT_HTTP_FORM_AUTOMATION,
  normalizeHttpFormAutomation,
} from "../../src/utils/connection/httpFormAutomation";

describe("browser compatibility restrictions", () => {
  it("removes every case-insensitive saved UA override, preserving other validated fields", () => {
    const saved = Object.freeze({
      "User-Agent": "stale-override",
      "uSeR-aGeNt": "other-override",
      "X-Requested-With": "XMLHttpRequest",
      "X-App-Setting": "kept",
    });
    expect(browserIdentityHeaders(saved, true)).toEqual({
      "X-Requested-With": "XMLHttpRequest",
      "X-App-Setting": "kept",
    });
    expect(saved["User-Agent"]).toBe("stale-override");
    expect(browserIdentityHeaders(saved, false)).toEqual(saved);
    expect(browserIdentityHeaders(saved, false)).not.toBe(saved);
  });

  it("defaults to native identity without adding a synthetic UA, hint or login grant", () => {
    const settings = normalizeWebBrowserSettings(undefined);
    expect(
      browserCompatibilityOptions(
        settings,
        { "User-Agent": "saved" },
        undefined,
      ),
    ).toEqual({
      headers: {},
      form: undefined,
    });
    expect(settings.defaultPolicy.allowCrossOriginRedirects).toBe(false);
  });

  it("uses native language without fabricating a locale or losing unrelated headers", () => {
    const saved = {
      "aCcEpT-LaNgUaGe": "fr-FR",
      "User-Agent": "saved",
      "X-App": "kept",
    };
    expect(browserIdentityHeaders(saved, false, true)).toEqual({
      "User-Agent": "saved",
      "X-App": "kept",
    });
    expect(browserIdentityHeaders(saved, true, false)).toEqual({
      "aCcEpT-LaNgUaGe": "fr-FR",
      "X-App": "kept",
    });
    expect(browserIdentityHeaders(saved, true, true)).toEqual({
      "X-App": "kept",
    });
    expect(saved["aCcEpT-LaNgUaGe"]).toBe("fr-FR");
  });

  it("does not apply generic timing overrides to reviewed staged application flows", () => {
    const settings = normalizeWebBrowserSettings({
      minimumFormFillDelayMs: 1000,
      minimumFormSubmitDelayMs: 2000,
    });
    expect(
      browserCompatibilityOptions(settings, {}, undefined, true).form,
    ).toBeUndefined();
    const saved = { ...DEFAULT_HTTP_FORM_AUTOMATION, fields: [] };
    expect(browserCompatibilityOptions(settings, {}, saved, true).form).toBe(
      saved,
    );
  });

  it("minimum delays retain longer per-connection delays and never enable disabled submission", () => {
    const saved = {
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      fillDelayMs: 4000,
      submitDelayMs: 100,
      submit: false,
      fields: [],
    };
    const adjusted = browserFormAutomation(saved, false, 1000, 2000)!;
    expect(adjusted).toMatchObject({
      fillDelayMs: 4000,
      submitDelayMs: 2000,
      submit: false,
    });
    expect(saved.submitDelayMs).toBe(100);
    expect(browserFormAutomation(saved, false, 0, 0)).toBe(saved);
  });

  it("extends the detection window within supported bounds for delayed forms", () => {
    const adjusted = browserFormAutomation(undefined, false, 30000, 22000)!;
    expect(adjusted).toMatchObject({
      fillDelayMs: 30000,
      submitDelayMs: 22000,
      detectionTimeoutMs: 60000,
      submit: true,
    });
    expect(normalizeHttpFormAutomation(adjusted)).toEqual(adjusted);
  });

  it("rejects delay combinations that would consume the entire native lifetime", () => {
    expect(() => browserFormAutomation(undefined, false, 30000, 30000)).toThrow(
      /52,000 ms/,
    );
    const saved = {
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      fillDelayMs: 30000,
      submitDelayMs: 0,
      detectionTimeoutMs: 40000,
      fields: [],
    };
    expect(() => browserFormAutomation(saved, false, 0, 30000)).toThrow(
      /52,000 ms/,
    );
  });

  it("manual mode fills only and preserves connection-specific timing and fields without mutation", () => {
    const saved = {
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      submit: true,
      fillDelayMs: 500,
      fields: [{ selector: "#realm", value: "local" }],
    };
    const result = browserFormAutomation(saved, true)!;
    expect(result).toEqual({ ...saved, submit: false });
    expect(saved.submit).toBe(true);
    expect(result.fields).not.toBe(saved.fields);
    expect(result.fields[0]).not.toBe(saved.fields[0]);
    expect(browserFormAutomation(undefined, true)).toEqual({
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      fields: [],
      submit: false,
    });
  });

  it("turning manual mode off never overrides a connection's fill-only choice", () => {
    const saved = {
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      fields: [],
      submit: false,
    };
    expect(browserFormAutomation(saved, false)?.submit).toBe(false);
    expect(browserFormAutomation(undefined, false)).toBeUndefined();
  });
});
