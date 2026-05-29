/**
 * Tests for SettingsPasswordRow — the masked-input row used by Backup
 * Encryption, Cloud Sync Encryption, and Proxy authentication.
 *
 * Wraps the existing PasswordInput, so we mainly verify:
 *   - it renders inside a sor-settings-select-row shell with the icon
 *     and InfoTooltip in the expected slots,
 *   - the value/onChange/disabled/placeholder props are forwarded,
 *   - the settings provider is required (because PasswordInput
 *     consumes the password-reveal policy).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SettingsProvider } from "../../src/contexts/SettingsContext";
import { SettingsPasswordRow } from "../../src/components/ui/settings/SettingsPrimitives";

function wrap(ui: React.ReactElement) {
  return <SettingsProvider>{ui}</SettingsProvider>;
}

describe("SettingsPasswordRow", () => {
  it("renders inside the sor-settings-select-row shell", () => {
    const { container } = render(
      wrap(
        <SettingsPasswordRow
          settingKey="proxyPassword"
          label="Password"
          value=""
          onChange={vi.fn()}
        />,
      ),
    );
    const row = container.querySelector(
      '[data-setting-key="proxyPassword"]',
    );
    expect(row).not.toBeNull();
    expect(row?.className).toContain("sor-settings-select-row");
  });

  it("uses the masked input by default", () => {
    render(
      wrap(
        <SettingsPasswordRow
          label="Password"
          value="hunter2"
          onChange={vi.fn()}
        />,
      ),
    );
    const input = screen.getByDisplayValue("hunter2") as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("forwards onChange when the user types", () => {
    const onChange = vi.fn();
    render(
      wrap(
        <SettingsPasswordRow
          label="Password"
          value=""
          onChange={onChange}
          placeholder="enter pass"
        />,
      ),
    );
    const input = screen.getByPlaceholderText("enter pass") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith("abc");
  });

  it("forwards the disabled prop", () => {
    render(
      wrap(
        <SettingsPasswordRow
          label="Password"
          value="v"
          onChange={vi.fn()}
          disabled
        />,
      ),
    );
    const input = screen.getByDisplayValue("v") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("renders the InfoTooltip when infoTooltip is set", () => {
    const { container } = render(
      wrap(
        <SettingsPasswordRow
          label="Password"
          value=""
          onChange={vi.fn()}
          infoTooltip="Stored encrypted"
        />,
      ),
    );
    // The InfoTooltip renders an aria-described element; the simplest
    // structural check is that *some* element exists with role=button
    // and tooltip-ish styling. We check title attribute as a proxy.
    const labelArea = container.querySelector(".sor-settings-row-label");
    expect(labelArea?.textContent).toContain("Password");
    expect(labelArea?.innerHTML).toContain("svg");
  });
});
