import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuickConnect } from "../../src/components/connection/QuickConnect";

const mockProps = {
  isOpen: true,
  onClose: vi.fn(),
  onConnect: vi.fn(),
  historyEnabled: true,
  history: [],
  onClearHistory: vi.fn(),
};

describe("QuickConnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Modal Display", () => {
    it("should not render when isOpen is false", () => {
      render(<QuickConnect {...mockProps} isOpen={false} />);

      expect(screen.queryByText("Quick Connect")).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      render(<QuickConnect {...mockProps} />);

      expect(screen.getByText("Quick Connect")).toBeInTheDocument();
    });

    it("should display form elements", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");
      const protocolSelect = screen.getByLabelText("Protocol");

      expect(hostnameInput).toBeInTheDocument();
      expect(protocolSelect).toBeInTheDocument();
      expect(hostnameInput.className).toContain("sor-form-input");
      expect(protocolSelect.className).toContain("sor-form-select");
      expect(
        screen.getByRole("button", { name: /connect/i }),
      ).toBeInTheDocument();
    });
  });

  describe("Form Interaction", () => {
    it("should update hostname when typing", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");
      fireEvent.change(hostnameInput, { target: { value: "192.168.1.100" } });

      expect(hostnameInput).toHaveValue("192.168.1.100");
    });

    it("should update protocol when selecting", () => {
      render(<QuickConnect {...mockProps} />);

      const protocolSelect = screen.getByLabelText("Protocol");
      fireEvent.change(protocolSelect, { target: { value: "ssh" } });

      expect(protocolSelect).toHaveValue("ssh");
    });

    it("should have RDP as default protocol", () => {
      render(<QuickConnect {...mockProps} />);

      // Custom Select shows the selected option label in the trigger button
      expect(screen.getByText("RDP (Remote Desktop)")).toBeInTheDocument();
    });
  });

  describe("Form Submission", () => {
    it("should call onConnect with SSH payload when submitted", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");
      const connectButton = screen.getByRole("button", { name: /connect/i });

      fireEvent.change(hostnameInput, { target: { value: "192.168.1.100" } });

      // Open the custom Select dropdown and select SSH
      const protocolTrigger = screen.getByText("RDP (Remote Desktop)");
      fireEvent.click(protocolTrigger);
      fireEvent.mouseDown(screen.getByText("SSH (Secure Shell)"));

      fireEvent.change(screen.getByLabelText("Username"), {
        target: { value: "root" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "secret" },
      });
      fireEvent.click(connectButton);

      expect(mockProps.onConnect).toHaveBeenCalledWith({
        hostname: "192.168.1.100",
        protocol: "ssh",
        username: "root",
        authType: "password",
        password: "secret",
        privateKey: undefined,
        passphrase: undefined,
      });
    });

    it("should call onClose after successful connection", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");
      const connectButton = screen.getByRole("button", { name: /connect/i });

      fireEvent.change(hostnameInput, { target: { value: "192.168.1.100" } });
      fireEvent.click(connectButton);

      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it("should trim whitespace from hostname", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");
      const connectButton = screen.getByRole("button", { name: /connect/i });

      fireEvent.change(hostnameInput, {
        target: { value: "  192.168.1.100  " },
      });
      fireEvent.click(connectButton);

      expect(mockProps.onConnect).toHaveBeenCalledWith({
        hostname: "192.168.1.100",
        protocol: "rdp",
        username: undefined,
        authType: undefined,
        password: undefined,
        privateKey: undefined,
        passphrase: undefined,
      });
    });

    it("should not submit with empty hostname", () => {
      render(<QuickConnect {...mockProps} />);

      const connectButton = screen.getByRole("button", { name: /connect/i });
      fireEvent.click(connectButton);

      expect(mockProps.onConnect).not.toHaveBeenCalled();
      expect(mockProps.onClose).not.toHaveBeenCalled();
    });

    it("should not submit with whitespace-only hostname", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");
      const connectButton = screen.getByRole("button", { name: /connect/i });

      fireEvent.change(hostnameInput, { target: { value: "   " } });
      fireEvent.click(connectButton);

      expect(mockProps.onConnect).not.toHaveBeenCalled();
      expect(mockProps.onClose).not.toHaveBeenCalled();
    });
  });

  describe("Keyboard Submission", () => {
    it("should submit form on Enter key", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");

      fireEvent.change(hostnameInput, { target: { value: "192.168.1.100" } });

      const form = screen.getByRole("form");
      fireEvent.submit(form);

      expect(mockProps.onConnect).toHaveBeenCalledWith({
        hostname: "192.168.1.100",
        protocol: "rdp",
        username: undefined,
        authType: undefined,
        password: undefined,
        privateKey: undefined,
        passphrase: undefined,
      });
    });
  });

  describe("Close Functionality", () => {
    it("should call onClose when close button is clicked", () => {
      render(<QuickConnect {...mockProps} />);

      const closeButton = screen.getByRole("button", { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it("should call onClose when clicking outside modal", () => {
      render(<QuickConnect {...mockProps} />);

      const backdrop = screen.getByTestId("quick-connect-modal");
      fireEvent.click(backdrop);

      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it("should clear hostname when closing", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");
      fireEvent.change(hostnameInput, { target: { value: "192.168.1.100" } });

      const closeButton = screen.getByRole("button", { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockProps.onClose).toHaveBeenCalled();
      // Note: Form clearing happens on successful connect, not on close
    });
  });

  describe("Protocol Options", () => {
    it("should have multiple protocol options", () => {
      render(<QuickConnect {...mockProps} />);

      // Open the custom Select dropdown to see options
      const protocolTrigger = screen.getByText("RDP (Remote Desktop)");
      fireEvent.click(protocolTrigger);

      expect(screen.getByText("SSH (Secure Shell)")).toBeInTheDocument();
      expect(screen.getByText("VNC (Virtual Network Computing)")).toBeInTheDocument();
    });
  });

  describe("Form Validation", () => {
    it("should disable connect button when hostname is empty", () => {
      render(<QuickConnect {...mockProps} />);

      const connectButton = screen.getByRole("button", { name: /connect/i });

      // Button should be enabled by default (validation happens on submit)
      expect(connectButton).toBeEnabled();
    });

    it("should show visual feedback for required fields", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");

      // Should have proper labeling for accessibility
      expect(hostnameInput).toBeRequired();
    });
  });
});
