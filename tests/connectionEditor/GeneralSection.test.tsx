import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import GeneralSection from "../../src/components/connectionEditor/GeneralSection";

// ── Mocks ──

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
  });

  // ── Name validation ──

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

    expect(screen.getByText("Port must be between 1 and 65535")).toBeInTheDocument();
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

    expect(screen.queryByText("Port must be between 1 and 65535")).not.toBeInTheDocument();
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

    expect(screen.queryByText("Port must be between 1 and 65535")).not.toBeInTheDocument();
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

    expect(screen.queryByText("Port must be between 1 and 65535")).not.toBeInTheDocument();
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
    expect(document.getElementById("name-error")).toHaveTextContent("Name is required");
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
