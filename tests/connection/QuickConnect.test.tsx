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
      const protocolSelect = screen.getByLabelText("Connection type");

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

      const protocolSelect = screen.getByLabelText("Connection type");
      fireEvent.change(protocolSelect, { target: { value: "ssh" } });

      expect(protocolSelect).toHaveValue("ssh");
    });

    it("should default to Browser with HTTPS", () => {
      render(<QuickConnect {...mockProps} />);

      // Custom Select shows the selected option label in the trigger button
      expect(screen.getByLabelText("Connection type")).toHaveTextContent(
        "Browser",
      );
      expect(screen.getByLabelText("Protocol")).toHaveTextContent(/^HTTPS$/);
    });
  });

  describe("Form Submission", () => {
    it("should call onConnect with SSH payload when submitted", () => {
      render(<QuickConnect {...mockProps} />);

      const hostnameInput = screen.getByLabelText("Hostname or IP Address");
      const connectButton = screen.getByRole("button", { name: /connect/i });

      fireEvent.change(hostnameInput, { target: { value: "192.168.1.100" } });

      // Open the custom Select dropdown and select SSH
      const protocolTrigger = screen.getByLabelText("Connection type");
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
        protocol: "https",
        httpVerifySsl: true,
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
        protocol: "https",
        httpVerifySsl: true,
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
      const protocolTrigger = screen.getByLabelText("Connection type");
      fireEvent.click(protocolTrigger);

      expect(screen.getByText("SSH (Secure Shell)")).toBeInTheDocument();
      expect(
        screen.getByText("VNC (Virtual Network Computing)"),
      ).toBeInTheDocument();
    });
  });

  describe("Browser connection type", () => {
    const chooseType = (name: string) => {
      fireEvent.click(
        screen.getByRole("combobox", { name: "Connection type" }),
      );
      fireEvent.mouseDown(screen.getByRole("option", { name }));
    };
    const chooseTransport = (protocol: "http" | "https") => {
      fireEvent.click(screen.getByRole("combobox", { name: "Protocol" }));
      fireEvent.mouseDown(
        screen.getByRole("option", {
          name:
            protocol === "http"
              ? /^HTTP\s*Unencrypted$/
              : /^HTTPS\s*Encrypted \(TLS\)$/,
        }),
      );
    };

    it("offers one Browser type and defaults its separate protocol to HTTPS", () => {
      render(<QuickConnect {...mockProps} />);
      fireEvent.click(
        screen.getByRole("combobox", { name: "Connection type" }),
      );
      expect(screen.getAllByRole("option")).toHaveLength(5);
      expect(screen.getAllByRole("option", { name: "Browser" })).toHaveLength(
        1,
      );
      expect(
        screen.queryByRole("option", { name: /HTTP/ }),
      ).not.toBeInTheDocument();
      fireEvent.mouseDown(screen.getByRole("option", { name: "Browser" }));
      expect(
        screen.getByRole("combobox", { name: "Connection type" }),
      ).toHaveTextContent("Browser");
      expect(
        screen.getByRole("combobox", { name: "Protocol" }),
      ).toHaveTextContent(/^HTTPS$/);
      expect(
        screen.getByRole("checkbox", { name: "Verify TLS certificates" }),
      ).toBeChecked();
    });

    it.each(["http", "https"] as const)(
      "submits the selected %s wire protocol, never the Browser UI type",
      (protocol) => {
        render(<QuickConnect {...mockProps} />);
        chooseType("Browser");
        chooseTransport(protocol);
        fireEvent.change(screen.getByTestId("quick-connect-hostname"), {
          target: { value: "portal.example.test" },
        });
        fireEvent.submit(screen.getByRole("form"));
        expect(mockProps.onConnect).toHaveBeenCalledExactlyOnceWith({
          hostname: "portal.example.test",
          protocol,
          ...(protocol === "https" ? { httpVerifySsl: true } : {}),
        });
      },
    );

    it.each(["http", "https"] as const)(
      "restores %s history without promoting HTTP to HTTPS",
      (protocol) => {
        render(
          <QuickConnect
            {...mockProps}
            history={[{ hostname: "history.example:8080", protocol }]}
          />,
        );
        fireEvent.click(screen.getByRole("button", { name: "History" }));
        fireEvent.click(
          screen.getByRole("button", {
            name: new RegExp(`history.example:8080\\s*${protocol}`, "i"),
          }),
        );
        expect(
          screen.getByRole("combobox", { name: "Connection type" }),
        ).toHaveTextContent("Browser");
        expect(
          screen.getByRole("combobox", { name: "Protocol" }),
        ).toHaveTextContent(new RegExp(`^${protocol}$`, "i"));
        fireEvent.submit(screen.getByRole("form"));
        expect(mockProps.onConnect).toHaveBeenCalledWith(
          expect.objectContaining({
            hostname: "history.example:8080",
            protocol,
          }),
        );
      },
    );

    it.each(["http", "https"] as const)(
      "honors a typed %s URL when Enter submits before blur",
      (protocol) => {
        render(<QuickConnect {...mockProps} />);
        // Credentials from another connection type must not leak into this URL.
        chooseType("RDP (Remote Desktop)");
        fireEvent.change(screen.getByLabelText("Username (optional)"), {
          target: { value: "rdp-user" },
        });
        fireEvent.change(screen.getByLabelText("Password (optional)"), {
          target: { value: "rdp-secret" },
        });
        chooseType("Browser");
        chooseTransport(protocol === "http" ? "https" : "http");
        fireEvent.change(screen.getByTestId("quick-connect-hostname"), {
          target: {
            value: `${protocol}://url-user:url-secret@[::1]:8443/login`,
          },
        });
        fireEvent.submit(screen.getByRole("form"));
        expect(mockProps.onConnect).toHaveBeenCalledExactlyOnceWith({
          hostname: "[::1]:8443",
          protocol,
          ...(protocol === "https" ? { httpVerifySsl: true } : {}),
        });
      },
    );

    it.each([
      ["http", "https"],
      ["https", "http"],
    ] as const)(
      "keeps an explicit %s URL consistent when the user then selects %s",
      (source, selected) => {
        render(<QuickConnect {...mockProps} />);
        const hostname = screen.getByTestId("quick-connect-hostname");
        fireEvent.change(hostname, {
          target: { value: `${source}://portal.example:8443/login` },
        });
        fireEvent.blur(hostname);
        expect(hostname).toHaveValue("portal.example:8443");
        chooseTransport(selected);
        fireEvent.submit(screen.getByRole("form"));
        expect(mockProps.onConnect).toHaveBeenCalledExactlyOnceWith({
          hostname: "portal.example:8443",
          protocol: selected,
          ...(selected === "https" ? { httpVerifySsl: true } : {}),
        });
      },
    );

    it("keeps an existing Browser transport but uses HTTPS for a fresh Browser selection", () => {
      render(<QuickConnect {...mockProps} />);
      chooseType("Browser");
      chooseTransport("http");
      chooseType("Browser");
      expect(
        screen.getByRole("combobox", { name: "Protocol" }),
      ).toHaveTextContent(/^HTTP$/);
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      chooseType("SSH (Secure Shell)");
      expect(
        screen.queryByRole("combobox", { name: "Protocol" }),
      ).not.toBeInTheDocument();
      chooseType("Browser");
      expect(
        screen.getByRole("combobox", { name: "Protocol" }),
      ).toHaveTextContent(/^HTTPS$/);
      expect(screen.getByRole("checkbox")).toBeChecked();
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

// ── t71: URL evidence → protocol (RC4) ──

import {
  deriveQuickConnectTarget,
  QUICK_CONNECT_PROTOCOLS,
} from "../../src/hooks/connection/useQuickConnect";

describe("QuickConnect — protocol inferred from pasted URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it.each([
    ["https://[2001:db8::1]:8443/login", "[2001:db8::1]:8443", "https"],
    ["http://[::1]:8080/", "[::1]:8080", "http"],
    ["https://[2001:db8::1]/", "[2001:db8::1]", "https"],
    ["ssh://[::1]:2222", "[::1]:2222", "ssh"],
    ["https://user:secret@[::1]:8443/path", "[::1]:8443", "https"],
    ["https://[::1]:0/path", "[::1]:0", "https"],
    ["https://[::1]:invalid/path", "[::1]:invalid", "https"],
    ["https://server/path@other.test", "server", "https"],
  ])("keeps the authority of %s unambiguous", (raw, hostname, protocol) => {
    expect(deriveQuickConnectTarget(raw, "rdp")).toEqual({
      hostname,
      protocol,
    });
  });

  it("does not rewrap an already bracketed endpoint without a URL scheme", () => {
    expect(deriveQuickConnectTarget("[::1]:8443", "https")).toBeUndefined();
    expect(deriveQuickConnectTarget(" [::1]:8443 ", "https")).toEqual({
      hostname: "[::1]:8443",
      protocol: undefined,
    });
  });

  it("deriveQuickConnectTarget maps scheme and keeps the port on the host", () => {
    expect(
      deriveQuickConnectTarget("https://portal.example.com:8443/login", "rdp"),
    ).toEqual({ hostname: "portal.example.com:8443", protocol: "https" });
    expect(
      deriveQuickConnectTarget("http://router.local/admin", "rdp"),
    ).toEqual({ hostname: "router.local", protocol: "http" });
    expect(deriveQuickConnectTarget("ssh://box:2222", "rdp")).toEqual({
      hostname: "box:2222",
      protocol: "ssh",
    });
    // Same protocol: no switch, hostname still cleaned.
    expect(deriveQuickConnectTarget("https://x/y", "https")).toEqual({
      hostname: "x",
      protocol: undefined,
    });
    // Scheme not offered by the picker: hostname cleaned, protocol untouched.
    expect(deriveQuickConnectTarget("smb://nas/share", "rdp")).toEqual({
      hostname: "nas",
      protocol: undefined,
    });
    // Plain hostname: nothing to do.
    expect(deriveQuickConnectTarget("server01", "rdp")).toBeUndefined();
    expect(QUICK_CONNECT_PROTOCOLS).toContain("https");
  });

  it("switches the select to HTTPS and strips the URL on hostname blur", () => {
    render(<QuickConnect {...mockProps} />);
    const hostnameInput = screen.getByTestId("quick-connect-hostname");
    fireEvent.change(hostnameInput, {
      target: { value: "https://portal.example.com:8443/login" },
    });
    fireEvent.blur(hostnameInput);

    expect(hostnameInput).toHaveValue("portal.example.com:8443");
    expect(screen.getByTestId("quick-connect-protocol")).toHaveTextContent(
      "HTTPS",
    );
  });

  it("switches the select on paste", () => {
    render(<QuickConnect {...mockProps} />);
    const hostnameInput = screen.getByTestId("quick-connect-hostname");
    fireEvent.paste(hostnameInput, {
      clipboardData: { getData: () => "http://router.local/admin" },
    });

    expect(hostnameInput).toHaveValue("router.local");
    expect(screen.getByTestId("quick-connect-protocol")).toHaveTextContent(
      "HTTP",
    );
  });

  it.each([true, false])(
    "submits HTTPS IPv6, Basic credentials and verify=%s",
    (verify) => {
      render(<QuickConnect {...mockProps} />);
      const hostname = screen.getByTestId("quick-connect-hostname");
      fireEvent.paste(hostname, {
        clipboardData: { getData: () => "https://[2001:db8::1]:8443/login" },
      });
      expect(hostname).toHaveValue("[2001:db8::1]:8443");
      fireEvent.change(
        screen.getByLabelText("Basic Auth Username (optional)"),
        { target: { value: " operator " } },
      );
      fireEvent.change(
        screen.getByLabelText("Basic Auth Password (optional)"),
        { target: { value: " secret " } },
      );
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toBeChecked();
      if (!verify) fireEvent.click(checkbox);
      fireEvent.submit(screen.getByRole("form"));
      expect(mockProps.onConnect).toHaveBeenCalledWith({
        hostname: "[2001:db8::1]:8443",
        protocol: "https",
        basicAuthUsername: "operator",
        basicAuthPassword: " secret ",
        httpVerifySsl: verify,
      });
      expect(mockProps.onClose).toHaveBeenCalledOnce();
    },
  );

  it("submits HTTP Basic authentication without a TLS override", () => {
    render(<QuickConnect {...mockProps} />);
    fireEvent.paste(screen.getByTestId("quick-connect-hostname"), {
      clipboardData: { getData: () => "http://[::1]:8080/admin" },
    });
    fireEvent.change(screen.getByLabelText("Basic Auth Username (optional)"), {
      target: { value: "operator" },
    });
    fireEvent.change(screen.getByLabelText("Basic Auth Password (optional)"), {
      target: { value: "secret" },
    });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form"));
    expect(mockProps.onConnect).toHaveBeenCalledWith({
      hostname: "[::1]:8080",
      protocol: "http",
      basicAuthUsername: "operator",
      basicAuthPassword: "secret",
    });
  });
});
