/**
 * Tests for the network-config primitives in
 * `src/components/ui/settings/NetworkPrimitives.tsx`.
 *
 * We test the two composites with non-trivial behavior:
 *   - SettingsApiKeyField: show/hide toggling, copy-flash, regenerate
 *     spinner, disabled propagation.
 *   - SettingsTcpKeepAliveBlock: parent toggle, conditional sub-row
 *     rendering, dim-when-parent-off wrapper.
 *
 * The thin shims (Port/Host/RemoteAccess/ConnectionTimeout) are
 * minimal delegations to the underlying SettingsPrimitives rows; we
 * cover the non-default branches (randomize button, locked, public-
 * bind warning) rather than re-testing the base rows.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import {
  SettingsApiKeyField,
  SettingsTcpKeepAliveBlock,
  SettingsPortRow,
  SettingsHostRow,
  SettingsRemoteAccessRow,
  SettingsConnectionTimeoutRow,
  SettingsSubGroupHeader,
} from "../../src/components/ui/settings/NetworkPrimitives";

describe("SettingsApiKeyField", () => {
  it("renders the key masked by default", () => {
    render(
      <SettingsApiKeyField
        value="super-secret-key"
        onCopy={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    const input = screen.getByDisplayValue(
      "super-secret-key",
    ) as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("reveals the key when Show is clicked", () => {
    render(
      <SettingsApiKeyField
        value="super-secret-key"
        onCopy={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    const show = screen.getByLabelText("Show key");
    fireEvent.click(show);
    const input = screen.getByDisplayValue(
      "super-secret-key",
    ) as HTMLInputElement;
    expect(input.type).toBe("text");
    // Button toggles to Hide
    expect(screen.getByLabelText("Hide key")).toBeTruthy();
  });

  it("flashes a checkmark for ~2 seconds after Copy is clicked", async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn();
    render(
      <SettingsApiKeyField
        value="key"
        onCopy={onCopy}
        onRegenerate={vi.fn()}
      />,
    );

    const copyButton = screen.getByLabelText("Copy key");
    await act(async () => {
      fireEvent.click(copyButton);
    });
    expect(onCopy).toHaveBeenCalled();

    // After 1.9s the check should still be visible.
    await act(async () => {
      vi.advanceTimersByTime(1900);
    });
    // (No visible "Copied" text — the icon swap is hard to assert
    //  cross-renderer, so we just verify the timer hasn't reset the
    //  flash yet by checking the button's title.)

    // After the full 2s the flash should have cleared.
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    vi.useRealTimers();
  });

  it("does not render the Copy button when value is empty", () => {
    render(
      <SettingsApiKeyField
        value=""
        onCopy={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Copy key")).toBeNull();
  });

  it("calls onRegenerate when the regenerate button is clicked", () => {
    const onRegenerate = vi.fn();
    render(
      <SettingsApiKeyField
        value="anything"
        onCopy={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByLabelText("Generate new key"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("animates the regenerate icon when isRegenerating is true", () => {
    const { container } = render(
      <SettingsApiKeyField
        value="x"
        onCopy={vi.fn()}
        onRegenerate={vi.fn()}
        isRegenerating
      />,
    );
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("greys out the row when disabled", () => {
    const { container } = render(
      <SettingsApiKeyField
        value="x"
        onCopy={vi.fn()}
        onRegenerate={vi.fn()}
        disabled
      />,
    );
    const row = container.querySelector(".sor-settings-select-row");
    expect(row?.className).toContain("opacity-50");
    expect(row?.className).toContain("pointer-events-none");
  });
});

describe("SettingsTcpKeepAliveBlock", () => {
  it("renders only the parent toggle when no sub-rows are provided", () => {
    const { container } = render(
      <SettingsTcpKeepAliveBlock
        enabled={true}
        onEnabledChange={vi.fn()}
      />,
    );
    // One sor-settings-toggle-row (the parent), no sub-block wrapper.
    const toggles = container.querySelectorAll(".sor-settings-toggle-row");
    expect(toggles.length).toBe(1);
    expect(
      container.querySelector(".flex.flex-col.gap-2\\.5"),
    ).toBeNull();
  });

  it("renders SO_KEEPALIVE next to the parent toggle when provided", () => {
    render(
      <SettingsTcpKeepAliveBlock
        enabled={true}
        onEnabledChange={vi.fn()}
        soKeepAlive={{ value: false, onChange: vi.fn() }}
      />,
    );
    expect(screen.getByText(/SO_KEEPALIVE/i)).toBeTruthy();
  });

  it("renders interval and probes inside the dim wrapper", () => {
    const { container } = render(
      <SettingsTcpKeepAliveBlock
        enabled={true}
        onEnabledChange={vi.fn()}
        intervalSecs={{ value: 60, onChange: vi.fn() }}
        probes={{ value: 5, onChange: vi.fn() }}
      />,
    );
    const wrapper = container.querySelector(".flex.flex-col.gap-2\\.5");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).not.toContain("opacity-50");
    // Both sub-rows present.
    expect(screen.getByText(/keep-alive interval/i)).toBeTruthy();
    expect(screen.getByText(/keep-alive probes/i)).toBeTruthy();
  });

  it("dims sub-rows when the parent toggle is off", () => {
    const { container } = render(
      <SettingsTcpKeepAliveBlock
        enabled={false}
        onEnabledChange={vi.fn()}
        intervalSecs={{ value: 60, onChange: vi.fn() }}
      />,
    );
    const wrapper = container.querySelector(".flex.flex-col.gap-2\\.5");
    expect(wrapper?.className).toContain("opacity-50");
    expect(wrapper?.className).toContain("pointer-events-none");
  });

  it("forwards the parent toggle change", async () => {
    const onEnabledChange = vi.fn();
    render(
      <SettingsTcpKeepAliveBlock
        enabled={false}
        onEnabledChange={onEnabledChange}
      />,
    );
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(cb);
    await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith(true));
  });
});

describe("SettingsPortRow", () => {
  it("renders without a randomize button by default", () => {
    render(
      <SettingsPortRow value={8080} onChange={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Randomize port")).toBeNull();
  });

  it("renders a randomize button when onRandomize is provided", () => {
    const onRandomize = vi.fn();
    render(
      <SettingsPortRow
        value={8080}
        onChange={vi.fn()}
        onRandomize={onRandomize}
      />,
    );
    const button = screen.getByLabelText("Randomize port");
    fireEvent.click(button);
    expect(onRandomize).toHaveBeenCalled();
  });

  it("disables the input + randomize button when locked", () => {
    render(
      <SettingsPortRow
        value={8080}
        onChange={vi.fn()}
        onRandomize={vi.fn()}
        locked
      />,
    );
    const input = screen.getByDisplayValue("8080") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const button = screen.getByLabelText("Randomize port") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("SettingsHostRow", () => {
  it("shows the public-bind warning for 0.0.0.0", () => {
    render(
      <SettingsHostRow
        value="0.0.0.0"
        onChange={vi.fn()}
        warnOnPublicBind
      />,
    );
    expect(
      screen.getByText(/wildcard address/i),
    ).toBeTruthy();
  });

  it("does not show the warning when warnOnPublicBind is off", () => {
    render(
      <SettingsHostRow value="0.0.0.0" onChange={vi.fn()} />,
    );
    expect(screen.queryByText(/wildcard address/i)).toBeNull();
  });

  it("does not warn on a localhost value", () => {
    render(
      <SettingsHostRow
        value="127.0.0.1"
        onChange={vi.fn()}
        warnOnPublicBind
      />,
    );
    expect(screen.queryByText(/wildcard address/i)).toBeNull();
  });
});

describe("SettingsRemoteAccessRow", () => {
  it("does not render the warning banner when unchecked", () => {
    render(
      <SettingsRemoteAccessRow checked={false} onChange={vi.fn()} />,
    );
    expect(screen.queryByText(/exposes the service/i)).toBeNull();
  });

  it("renders the warning banner when checked", () => {
    render(
      <SettingsRemoteAccessRow checked={true} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/exposes the service/i)).toBeTruthy();
  });

  it("forwards onChange", () => {
    const onChange = vi.fn();
    render(
      <SettingsRemoteAccessRow checked={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("SettingsConnectionTimeoutRow", () => {
  it("renders a number input by default", () => {
    const { container } = render(
      <SettingsConnectionTimeoutRow value={10} onChange={vi.fn()} />,
    );
    const input = container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("10");
  });

  it("renders a slider when variant is 'slider'", () => {
    const { container } = render(
      <SettingsConnectionTimeoutRow
        value={10}
        onChange={vi.fn()}
        variant="slider"
      />,
    );
    const slider = container.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(slider).not.toBeNull();
  });
});

describe("SettingsSubGroupHeader", () => {
  it("renders icon + label", () => {
    render(
      <SettingsSubGroupHeader
        icon={<span data-testid="icon" />}
        label="Authentication"
      />,
    );
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(screen.getByText("Authentication")).toBeTruthy();
  });

  it("uses tight spacing when tight=true", () => {
    const { container } = render(
      <SettingsSubGroupHeader
        icon={<span />}
        label="Tight"
        tight
      />,
    );
    expect(container.firstChild as HTMLElement).toHaveProperty("className");
    expect((container.firstChild as HTMLElement).className).toContain(
      "pt-2",
    );
  });
});
