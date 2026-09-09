import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import GeneralSection from "../../src/components/connectionEditor/GeneralSection";
import type { RuntimeCapabilities } from "../../src/utils/runtime/runtimeCapabilities";

// ── Mocks ──

const runtimeCapabilityState = vi.hoisted(
  (): { value: RuntimeCapabilities } => ({
    value: {
      cloud: true,
      ops: true,
      rdp: true,
      serial: true,
      mysql: true,
      postgresql: true,
      mongodb: true,
      source: "native" as const,
    },
  }),
);

vi.mock("../../src/hooks/runtime/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => runtimeCapabilityState.value,
}));

vi.mock("../../src/utils/discovery/defaultPorts", () => ({
  getDefaultPort: () => 22,
}));

vi.mock("../../src/utils/window/dragDropManager", () => ({
  getConnectionDepth: () => 0,
  getMaxDescendantDepth: () => 0,
  MAX_NESTING_DEPTH: 5,
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual };
});

// GeneralSection now reads tabGroups from useConnections() to power its
// "Default Tab Group" picker. The tests don't care about that picker, so
// stub the hook with an empty state instead of wrapping every test in a
// ConnectionProvider.
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { tabGroups: [] } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe("GeneralSection validation", () => {
  const mockSetFormData = vi.fn();

  const defaultProps = {
    formData: { name: "", hostname: "", port: 22, protocol: "ssh" as const },
    setFormData: mockSetFormData,
    availableGroups: [],
    allConnections: [],
  };

  beforeEach(() => {
    mockSetFormData.mockReset();
    runtimeCapabilityState.value = {
      cloud: true,
      ops: true,
      rdp: true,
      serial: true,
      mysql: true,
      postgresql: true,
      mongodb: true,
      source: "native",
    };
  });

  it("uses the canonical grouped built-in and integration protocol options", () => {
    render(<GeneralSection {...defaultProps} />);

    fireEvent.click(screen.getByTestId("editor-protocol"));

    expect(
      screen.getByRole("option", { name: "Consoles & Terminals" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: /NetBox/i })).toBeInTheDocument();
  });

  it("keeps a saved protocol visible but disabled when this build omits it", () => {
    runtimeCapabilityState.value = {
      cloud: false,
      ops: false,
      rdp: false,
      serial: true,
      mysql: false,
      postgresql: false,
      mongodb: false,
      source: "native",
    };

    render(
      <GeneralSection
        {...defaultProps}
        formData={{ ...defaultProps.formData, protocol: "rdp" }}
      />,
    );

    expect(screen.getByTestId("editor-protocol")).toHaveTextContent(
      "RDP (Unavailable in this build)",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      'Use the full build or rebuild with the "rdp" feature.',
    );

    fireEvent.click(screen.getByTestId("editor-protocol"));
    expect(
      screen.getByRole("option", {
        name: "RDP (Unavailable in this build)",
      }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByRole("option", { name: /Microsoft Azure/i }),
    ).not.toBeInTheDocument();
  });

  // ── Name validation ──

  it.each(["integration:proxmox", "integration:mssql"] as const)(
    "preserves unavailable saved %s without allowing selection or rewriting it",
    (protocol) => {
      runtimeCapabilityState.value = {
        ...runtimeCapabilityState.value,
        ops: false,
        mssql: false,
      };
      render(
        <GeneralSection
          {...defaultProps}
          formData={{ ...defaultProps.formData, protocol }}
        />,
      );
      expect(screen.getByTestId("editor-protocol")).toHaveTextContent(
        "Unavailable in this build",
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "unavailable in this build",
      );
      fireEvent.click(screen.getByTestId("editor-protocol"));
      const saved = screen.getByRole("option", {
        name: /Unavailable in this build/,
      });
      expect(saved).toHaveAttribute("aria-disabled", "true");
      fireEvent.mouseDown(saved);
      expect(mockSetFormData).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("option", { name: /^NetBox$/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("omits unsupported integrations for new choices and permits them only when native capabilities enable them", () => {
    runtimeCapabilityState.value = {
      ...runtimeCapabilityState.value,
      ops: false,
      mssql: false,
    };
    const view = render(<GeneralSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("editor-protocol"));
    expect(
      screen.queryByRole("option", { name: /Proxmox/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /SQL Server/ }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("editor-protocol"), { key: "Escape" });
    runtimeCapabilityState.value = {
      ...runtimeCapabilityState.value,
      ops: true,
      mssql: true,
    };
    view.rerender(<GeneralSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("editor-protocol"));
    const proxmox = screen.getByRole("option", { name: /Proxmox/ });
    expect(proxmox).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.mouseDown(proxmox);
    expect(mockSetFormData).toHaveBeenCalled();
    const updater =
      mockSetFormData.mock.calls[mockSetFormData.mock.calls.length - 1]?.[0];
    expect(updater(defaultProps.formData).protocol).toBe("integration:proxmox");
  });

  it("shows error on blur when name is empty", () => {
    render(<GeneralSection {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("Connection name");

    fireEvent.blur(nameInput);

    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("clears name error when user types", () => {
    // Use a stateful wrapper so formData actually updates
    const Wrapper = () => {
      const [formData, setFormData] = React.useState(defaultProps.formData);
      return (
        <GeneralSection
          formData={formData}
          setFormData={setFormData as any}
          availableGroups={[]}
          allConnections={[]}
        />
      );
    };

    render(<Wrapper />);
    const nameInput = screen.getByPlaceholderText("Connection name");

    // Trigger error first
    fireEvent.blur(nameInput);
    expect(screen.getByText("Name is required")).toBeInTheDocument();

    // Type to clear
    fireEvent.change(nameInput, { target: { value: "My Server" } });
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });

  it("does not show name error when name has a value on blur", () => {
    render(
      <GeneralSection
        {...defaultProps}
        formData={{ ...defaultProps.formData, name: "Server1" }}
      />,
    );
    const nameInput = screen.getByPlaceholderText("Connection name");

    fireEvent.blur(nameInput);

    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });

  // ── Port validation ──

  it("shows error for port 0 on blur", () => {
    render(
      <GeneralSection
        {...defaultProps}
        formData={{ ...defaultProps.formData, name: "S", port: 0 }}
      />,
    );
    const portInput = screen.getByDisplayValue("0");

    fireEvent.blur(portInput);

    expect(
      screen.getByText("Port must be between 1 and 65535"),
    ).toBeInTheDocument();
  });

  it("shows no error for valid port 22", () => {
    render(
      <GeneralSection
        {...defaultProps}
        formData={{ ...defaultProps.formData, name: "S", port: 22 }}
      />,
    );
    const portInput = screen.getByDisplayValue("22");

    fireEvent.blur(portInput);

    expect(
      screen.queryByText("Port must be between 1 and 65535"),
    ).not.toBeInTheDocument();
  });

  it("shows no error for valid port 3389", () => {
    render(
      <GeneralSection
        {...defaultProps}
        formData={{ ...defaultProps.formData, name: "S", port: 3389 }}
      />,
    );
    const portInput = screen.getByDisplayValue("3389");

    fireEvent.blur(portInput);

    expect(
      screen.queryByText("Port must be between 1 and 65535"),
    ).not.toBeInTheDocument();
  });

  it("shows no error for valid port 65535", () => {
    render(
      <GeneralSection
        {...defaultProps}
        formData={{ ...defaultProps.formData, name: "S", port: 65535 }}
      />,
    );
    const portInput = screen.getByDisplayValue("65535");

    fireEvent.blur(portInput);

    expect(
      screen.queryByText("Port must be between 1 and 65535"),
    ).not.toBeInTheDocument();
  });

  // ── Aria attributes ──

  it("sets aria-invalid and aria-describedby on name input when error present", () => {
    render(<GeneralSection {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("Connection name");

    // Before error
    expect(nameInput).not.toHaveAttribute("aria-invalid");

    fireEvent.blur(nameInput);

    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveAttribute("aria-describedby", "name-error");
    expect(document.getElementById("name-error")).toHaveTextContent(
      "Name is required",
    );
  });

  it("sets aria-invalid and aria-describedby on port input when error present", () => {
    render(
      <GeneralSection
        {...defaultProps}
        formData={{ ...defaultProps.formData, name: "S", port: 0 }}
      />,
    );
    const portInput = screen.getByDisplayValue("0");

    expect(portInput).not.toHaveAttribute("aria-invalid");

    fireEvent.blur(portInput);

    expect(portInput).toHaveAttribute("aria-invalid", "true");
    expect(portInput).toHaveAttribute("aria-describedby", "port-error");
    expect(document.getElementById("port-error")).toHaveTextContent(
      "Port must be between 1 and 65535",
    );
  });
});
