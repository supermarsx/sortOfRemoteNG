import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MacroSettings from "../../src/components/SettingsDialog/sections/MacroSettings";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
vi.mock("../../src/utils/recording/macroService", () => ({
  loadMacros: async () => [],
}));
import { SessionQuickActionsSection } from "../../src/components/connectionEditor/SessionQuickActionsSection";
import type { Connection } from "../../src/types/connection/connection";

function Harness({
  initial = {},
  protocol = "http",
}: {
  initial?: Partial<Connection>;
  protocol?: "ssh" | "http";
}) {
  const [formData, setFormData] = useState(initial);
  return (
    <>
      <SessionQuickActionsSection
        formData={formData}
        setFormData={setFormData}
        protocol={protocol}
      />
      <output data-testid="saved-config">{JSON.stringify(formData)}</output>
    </>
  );
}
describe("connection quick-action settings", () => {
  it("wires all global controls independently without granting connection consent", async () => {
    const updateSettings = vi.fn();
    const settings = SettingsManager.getInstance().getSettings();
    render(
      <MacroSettings settings={settings} updateSettings={updateSettings} />,
    );
    await screen.findByText("0 macros saved");
    const controls = [
      ["SSH quick-action bar", "sshEnabled"],
      ["Website quick-action bar", "httpEnabled"],
      ["Allow website interaction macros", "allowWebMacros"],
      ["Allow website script injection", "allowWebScriptInjection"],
      ["Allow dark-mode extension", "allowWebForceDark"],
      ["Confirm before running scripts", "confirmBeforeScriptRun"],
    ];
    for (const [label, key] of controls) {
      fireEvent.click(
        screen.getByRole("checkbox", { name: new RegExp(`^${label}`) }),
      );
      expect(updateSettings).toHaveBeenLastCalledWith({
        sessionQuickActions: { ...settings.sessionQuickActions, [key]: false },
      });
    }
    expect(
      updateSettings.mock.calls.every(
        ([patch]) =>
          !Object.prototype.hasOwnProperty.call(patch, "httpAutomation"),
      ),
    ).toBe(true);
  });
  it("requires independent explicit website opt-ins and preserves unrelated connection fields", () => {
    render(<Harness initial={{ name: "Fixture" }} />);
    for (const box of screen.getAllByRole("checkbox", {
      name: /^(Allow |Enable )/,
    }))
      expect(box).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Allow manual JavaScript injection for this connection",
      }),
    );
    expect(
      JSON.parse(screen.getByTestId("saved-config").textContent!),
    ).toMatchObject({
      name: "Fixture",
      httpAutomation: {
        version: 1,
        items: [],
        scriptInjectionEnabled: true,
        interactionMacrosEnabled: false,
        forceDark: false,
      },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable dark-mode extension for this connection",
      }),
    );
    expect(
      JSON.parse(screen.getByTestId("saved-config").textContent!).httpAutomation
        .forceDark,
    ).toBe(true);
  });
  it("reorders and removes ID references without injecting bodies or enabling execution", () => {
    render(
      <Harness
        protocol="ssh"
        initial={{
          sshQuickActions: {
            version: 1,
            items: [
              { kind: "script", id: "first" },
              { kind: "macro", id: "second" },
            ],
          },
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move macro second up" }),
    );
    expect(
      JSON.parse(screen.getByTestId("saved-config").textContent!)
        .sshQuickActions.items,
    ).toEqual([
      { kind: "macro", id: "second" },
      { kind: "script", id: "first" },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove script first favorite" }),
    );
    expect(
      JSON.parse(screen.getByTestId("saved-config").textContent!)
        .sshQuickActions.items,
    ).toEqual([{ kind: "macro", id: "second" }]);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("shows malformed configuration honestly without silently replacing consent", () => {
    render(<Harness initial={{ httpAutomation: { version: 99 } as never }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "invalid quick-action settings",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      JSON.parse(screen.getByTestId("saved-config").textContent!).httpAutomation
        .version,
    ).toBe(99);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset quick-action settings" }),
    );
    expect(
      JSON.parse(screen.getByTestId("saved-config").textContent!).httpAutomation
        .version,
    ).toBe(99);
    fireEvent.click(screen.getByRole("button", { name: "Reset and disable" }));
    expect(
      JSON.parse(screen.getByTestId("saved-config").textContent!)
        .httpAutomation,
    ).toEqual({
      version: 1,
      items: [],
      interactionMacrosEnabled: false,
      scriptInjectionEnabled: false,
      forceDark: false,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
