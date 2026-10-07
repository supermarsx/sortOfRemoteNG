import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionDomainPermissionsSection from "../../src/components/connectionEditor/httpOptions/ConnectionDomainPermissionsSection";
import type { Mgr } from "../../src/components/connectionEditor/httpOptions/types";

const shared = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  settingsReady: true,
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => shared,
}));
beforeEach(() => {
  shared.settings = {};
  shared.settingsReady = true;
});
describe("connection domain permission notices", () => {
  it("uses app colors and reduced-motion-aware loading without mutating the connection", () => {
    shared.settingsReady = false;
    const setFormData = vi.fn();
    render(
      <ConnectionDomainPermissionsSection
        mgr={{ formData: { id: "fixture" }, setFormData } as unknown as Mgr}
      />,
    );
    expect(screen.getByRole("status")).toHaveClass(
      "bg-[var(--color-surface)]",
      "text-[var(--color-textSecondary)]",
    );
    expect(screen.getByRole("status").querySelector("svg")).toHaveClass(
      "motion-reduce:animate-none",
    );
    expect(setFormData).not.toHaveBeenCalled();
  });
  it("uses a semantic error notice for invalid inherited settings", () => {
    shared.settings = { webBrowser: { engine: "invalid" } };
    const setFormData = vi.fn();
    render(
      <ConnectionDomainPermissionsSection
        mgr={{ formData: { id: "fixture" }, setFormData } as unknown as Mgr}
      />,
    );
    expect(screen.getByRole("alert")).toHaveClass(
      "sor-alert-error",
      "text-[var(--color-text)]",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(setFormData).not.toHaveBeenCalled();
  });
});
