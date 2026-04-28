import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import GeneralSection from "../../src/components/connectionEditor/GeneralSection";
import SSHOptions from "../../src/components/connectionEditor/SSHOptions";
import HTTPOptions from "../../src/components/connectionEditor/HTTPOptions";
import CloudProviderOptions from "../../src/components/connectionEditor/CloudProviderOptions";
import { Connection } from "../../src/types/connection/connection";
import type { ManagedSshSecretsController } from "../../src/hooks/connection/useConnectionEditor";

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

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: {},
    updateSettings: vi.fn(),
    reloadSettings: vi.fn(),
  }),
}));

vi.mock("../../src/utils/settings/themeManager", () => ({
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
    expect(container.querySelector('[role="combobox"]')?.className).toContain(
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
    expect(container.querySelector('[role="combobox"]')?.className).toContain(
      "sor-form-select",
    );
  });

  it("keeps the SSH password field controlled when managed secrets take over", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const sshSecretManager: ManagedSshSecretsController = {
      passwordInputRef: { current: null },
      passphraseInputRef: { current: null },
      privateKeyInputRef: { current: null },
      hasPassword: true,
      hasPassphrase: false,
      hasPrivateKey: false,
      handlePasswordChange: vi.fn(),
      handlePassphraseChange: vi.fn(),
      handlePrivateKeyChange: vi.fn(),
      getPassword: () => "stored-password",
      getPassphrase: () => "",
      getPrivateKey: () => "",
      clearAll: vi.fn(),
    };

    try {
      const { rerender } = render(
        <SSHOptions
          formData={{
            ...baseData,
            protocol: "rdp",
            authType: "password",
            password: "plain-password",
          }}
          setFormData={() => {}}
          sshSecretManager={sshSecretManager}
        />,
      );

      rerender(
        <SSHOptions
          formData={{
            ...baseData,
            protocol: "ssh",
            authType: "password",
            password: "",
          }}
          setFormData={() => {}}
          sshSecretManager={sshSecretManager}
        />,
      );

      expect(screen.getByTestId("editor-password")).toHaveValue("stored-password");
      expect(
        consoleErrorSpy.mock.calls.some((call) =>
          call.some(
            (arg) =>
              typeof arg === "string" &&
              arg.includes(
                "A component is changing a controlled input to be uncontrolled",
              ),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
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
    expect(container.querySelector('[role="combobox"]')?.className).toContain(
      "sor-form-select",
    );
  });

  it("uses centralized input classes in CloudProviderOptions", () => {
    const { container } = render(
      <CloudProviderOptions
        formData={{ ...baseData, protocol: "gcp", cloudProvider: { provider: "gcp" as const } }}
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
