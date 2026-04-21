import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProxyProfileEditor } from "../../src/components/network/ProxyProfileEditor";

// ── Mocks to prevent OOM from transitive dependency graph ──

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

describe("ProxyProfileEditor", () => {
  it("does not render when closed", () => {
    render(
      <ProxyProfileEditor
        isOpen={false}
        onClose={() => {}}
        onSave={() => {}}
        editingProfile={null}
      />,
    );

    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });

  it("renders when open with Create Profile button", async () => {
    render(
      <ProxyProfileEditor
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        editingProfile={null}
      />,
    );

    expect(screen.getByText("Create Profile")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("saves profile with required fields", async () => {
    const onSave = vi.fn();

    render(
      <ProxyProfileEditor
        isOpen
        onClose={() => {}}
        onSave={onSave}
        editingProfile={null}
      />,
    );

    const nameInput = screen.getByPlaceholderText("My SOCKS5 Proxy");
    const hostInput = screen.getByPlaceholderText("proxy.example.com");
    const portInput = screen.getByPlaceholderText("1080");
    const defaultCheckbox = screen.getByRole("checkbox");

    expect(nameInput.className).toContain("sor-form-input");
    expect(hostInput.className).toContain("sor-form-input");
    expect(defaultCheckbox.className).toContain("sor-form-checkbox");

    fireEvent.change(nameInput, {
      target: { value: "Office Proxy" },
    });
    fireEvent.change(hostInput, {
      target: { value: "proxy.local" },
    });
    fireEvent.change(portInput, {
      target: { value: "3128" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Profile" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Office Proxy",
          config: expect.objectContaining({
            host: "proxy.local",
            port: 3128,
          }),
        }),
      );
    });
  });
});
