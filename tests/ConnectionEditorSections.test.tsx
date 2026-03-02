import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import GeneralSection from "../src/components/connectionEditor/GeneralSection";
import SSHOptions from "../src/components/connectionEditor/SSHOptions";
import HTTPOptions from "../src/components/connectionEditor/HTTPOptions";
import CloudProviderOptions from "../src/components/connectionEditor/CloudProviderOptions";
import { Connection } from "../src/types/connection";

// ── Mocks to prevent OOM from transitive dependency graph ──

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../src/utils/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: {},
    updateSettings: vi.fn(),
    reloadSettings: vi.fn(),
  }),
}));

vi.mock("../src/utils/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

describe("ConnectionEditor subcomponents", () => {
  const baseData: Partial<Connection> = {
    name: "test",
    protocol: "ssh",
    hostname: "host",
    port: 22,
    isGroup: false,
  };

  it("shows SSH library selector in GeneralSection when protocol is ssh", () => {
    const { container } = render(
      <GeneralSection
        formData={{ ...baseData, protocol: "ssh" }}
        setFormData={() => {}}
        availableGroups={[]}
      />,
    );
    expect(screen.getAllByText(/SSH Library/i).length).toBeGreaterThan(0);
    expect(container.querySelector('input[type="text"]')?.className).toContain(
      "sor-form-input",
    );
    expect(container.querySelector("select")?.className).toContain(
      "sor-form-select",
    );
  });

  it("shows private key textarea in SSHOptions when authType is key", () => {
    const { container } = render(
      <SSHOptions
        formData={{ ...baseData, authType: "key", protocol: "ssh" }}
        setFormData={() => {}}
      />,
    );
    expect(
      screen.getByPlaceholderText(/BEGIN PRIVATE KEY/),
    ).toBeInTheDocument();
    expect(container.querySelector('input[type="text"]')?.className).toContain(
      "sor-form-input",
    );
    expect(container.querySelector("select")?.className).toContain(
      "sor-form-select",
    );
  });

  it("shows basic auth fields in HTTPOptions", () => {
    const { container } = render(
      <HTTPOptions
        formData={{ ...baseData, protocol: "http", authType: "basic" }}
        setFormData={() => {}}
      />,
    );
    expect(screen.getByText(/Basic Auth Username/i)).toBeInTheDocument();
    expect(container.querySelector('input[type="text"]')?.className).toContain(
      "sor-form-input",
    );
    expect(container.querySelector("select")?.className).toContain(
      "sor-form-select",
    );
  });

  it("uses centralized input classes in CloudProviderOptions", () => {
    const { container } = render(
      <CloudProviderOptions
        formData={{ ...baseData, protocol: "gcp", cloudProvider: {} }}
        setFormData={() => {}}
      />,
    );

    expect(screen.getByText(/Google Cloud Platform/i)).toBeInTheDocument();
    expect(container.querySelector('input[type="text"]')?.className).toContain(
      "sor-form-input",
    );
    expect(container.querySelector("textarea")?.className).toContain(
      "sor-form-textarea",
    );
  });
});
