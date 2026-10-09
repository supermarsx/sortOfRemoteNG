import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserXsltSettings } from "../../src/components/SettingsDialog/sections/webBrowser/BrowserXsltSettings";
import type { WebBrowserSettingsConfig } from "../../src/types/settings/webBrowser";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";

afterEach(cleanup);

function setup(xsltEnabled?: boolean) {
  const onChange = vi.fn();
  function Harness() {
    const [config, setConfig] = useState<WebBrowserSettingsConfig>({
      ...normalizeWebBrowserSettings(undefined),
      xsltEnabled,
    });
    return (
      <BrowserXsltSettings
        config={config}
        onChange={(patch) => {
          onChange(patch);
          setConfig((previous) => ({ ...previous, ...patch }));
        }}
      />
    );
  }
  return { ...render(<Harness />), onChange };
}

describe("BrowserXsltSettings", () => {
  it.each([
    ["missing preference defaults to enabled", undefined, true],
    ["explicit true stays enabled", true, true],
    ["explicit false stays disabled", false, false],
  ] as const)("%s and toggles both ways", (_, initial, checked) => {
    const { onChange } = setup(initial);
    const toggle = screen.getByRole("checkbox", { name: /^Enable XSLT/ });
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveClass("sor-settings-checkbox");
    expect(toggle.closest("[data-setting-key]")).toHaveAttribute(
      "data-setting-key",
      "webBrowser.xsltEnabled",
    );
    expect((toggle as HTMLInputElement).checked).toBe(checked);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(!checked);
    expect(onChange).toHaveBeenNthCalledWith(1, { xsltEnabled: !checked });
    fireEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(checked);
    expect(onChange).toHaveBeenNthCalledWith(2, { xsltEnabled: checked });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("explains native scope, restart timing, legacy compatibility and unchanged network checks", () => {
    setup();
    const description = screen.getByText(
      /Allow XML stylesheet transformations in the native browser/,
    );
    expect(description).toBeVisible();
    expect(description).toHaveTextContent(
      /legacy portals, including RD Web Access/i,
    );
    expect(description).toHaveTextContent(
      /all native browser connections after restarting the app/i,
    );
    expect(description).toHaveTextContent(
      /legacy engine is controlled by its system WebView/i,
    );
    expect(description).toHaveTextContent(
      /network permissions and certificate checks are unchanged/i,
    );
  });
});
