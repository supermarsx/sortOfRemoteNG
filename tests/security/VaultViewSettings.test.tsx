import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SettingsContext, {
  defaultSettings,
} from "../../src/contexts/SettingsContext";
import VaultViewSettings from "../../src/components/SettingsDialog/sections/security/VaultViewSettings";
import type { GlobalSettings } from "../../src/types/settings/settings";

afterEach(cleanup);
it("exposes persisted visible columns, width, page size and infinite scrolling in Settings", () => {
  const save = vi.fn();
  function Fixture() {
    const [settings, setSettings] = useState(defaultSettings);
    return (
      <SettingsContext.Provider
        value={{
          settings,
          reloadSettings: async () => {},
          updateSettings: async (patch: Partial<GlobalSettings>) => {
            save(patch);
            setSettings((old) => ({ ...old, ...patch }));
          },
        }}
      >
        <VaultViewSettings />
      </SettingsContext.Provider>
    );
  }
  render(<Fixture />);
  expect(screen.getByLabelText("Assigned to column width")).toHaveValue(160);
  fireEvent.change(screen.getByLabelText("Assigned to column width"), {
    target: { value: "120" },
  });
  fireEvent.blur(screen.getByLabelText("Assigned to column width"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Source" }));
  fireEvent.click(
    screen.getByRole("combobox", { name: "Credentials per page" }),
  );
  fireEvent.mouseDown(screen.getByRole("option", { name: "250" }));
  fireEvent.click(
    screen.getByRole("combobox", { name: "Credential list navigation" }),
  );
  fireEvent.mouseDown(screen.getByRole("option", { name: "Infinite scroll" }));
  expect(save.mock.lastCall?.[0].credentialVaultView).toMatchObject({
    columns: ["name", "categories", "assigned", "actions"],
    widths: { assigned: 120 },
    pageSize: 250,
    mode: "infinite",
  });
  expect(screen.getByRole("checkbox", { name: "Name" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Reset credential list layout" }),
  );
  expect(
    screen.getByRole("combobox", { name: "Credentials per page" }),
  ).toHaveTextContent("100");
  expect(
    screen.getByRole("combobox", { name: "Credential list navigation" }),
  ).toHaveTextContent("Pages");
});
