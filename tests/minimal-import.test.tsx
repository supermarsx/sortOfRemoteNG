import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

import { ProxyProfileEditor } from "../src/components/network/ProxyProfileEditor";

describe("minimal render test", () => {
  it("renders open ProxyProfileEditor (Textarea fix)", () => {
    render(
      <ProxyProfileEditor
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        editingProfile={null}
      />,
    );
    expect(screen.getByTestId("proxy-profile-editor-modal")).toBeInTheDocument();
  });
});
