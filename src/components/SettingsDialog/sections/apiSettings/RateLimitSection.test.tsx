import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../../../contexts/SettingsContext";
import type { GlobalSettings } from "../../../../types/settings/settings";
import { RateLimitSection } from "./RateLimitSection";
import type { Mgr } from "./types";

function makeSettings(
  rateLimiting: boolean,
  maxRequestsPerMinute: number,
): GlobalSettings {
  return {
    ...defaultSettings,
    restApi: {
      ...defaultSettings.restApi,
      rateLimiting,
      maxRequestsPerMinute,
    },
  };
}

function makeManager(updateRestApi: ReturnType<typeof vi.fn>): Mgr {
  return {
    t: (_key: string, fallback?: string) => fallback ?? _key,
    updateRestApi,
  } as unknown as Mgr;
}

describe("RateLimitSection", () => {
  it("renders an explicit off state and preserves a configured zero", () => {
    const updateRestApi = vi.fn();
    render(
      <RateLimitSection
        settings={makeSettings(false, 0)}
        mgr={makeManager(updateRestApi)}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /Enable rate limiting/i }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("spinbutton", { name: /Max Requests Per Minute/i }),
    ).toHaveValue(0);
    expect(
      screen.getByLabelText(
        /Turning this off only disables rate limiting for a loopback API server in a debug build/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        /A value of 0 disables the limit only for local debug use.*mandatory fallback of 120/i,
      ),
    ).toBeInTheDocument();
  });

  it("persists toggle and request-limit changes through updateRestApi", () => {
    const updateRestApi = vi.fn();
    render(
      <RateLimitSection
        settings={makeSettings(false, 0)}
        mgr={makeManager(updateRestApi)}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Enable rate limiting/i }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /Max Requests Per Minute/i }),
      { target: { value: "120" } },
    );

    expect(updateRestApi).toHaveBeenNthCalledWith(1, { rateLimiting: true });
    expect(updateRestApi).toHaveBeenNthCalledWith(2, {
      maxRequestsPerMinute: 120,
    });
  });

  it("uses the secure frontend defaults when the nested settings are absent", () => {
    const updateRestApi = vi.fn();
    const settings = {
      ...defaultSettings,
      restApi: undefined,
    } as unknown as GlobalSettings;
    render(
      <RateLimitSection settings={settings} mgr={makeManager(updateRestApi)} />,
    );

    expect(
      screen.getByRole("checkbox", { name: /Enable rate limiting/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("spinbutton", { name: /Max Requests Per Minute/i }),
    ).toHaveValue(60);
  });
});
