import React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CertificateInfoPopup } from "../src/components/security/CertificateInfoPopup";

const identity = {
  fingerprint: "SHA256:test-fingerprint",
  keyType: "ssh-ed25519",
  keyBits: 256,
  firstSeen: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  lastSeen: new Date("2026-01-02T00:00:00.000Z").toISOString(),
};

const renderPopup = () => {
  const TestHarness: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(true);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);

    return (
      <div>
        <button ref={triggerRef} data-testid="cert-trigger">
          Cert
        </button>
        {isOpen && (
          <CertificateInfoPopup
            type="ssh"
            host="example.com"
            port={22}
            currentIdentity={identity}
            triggerRef={triggerRef}
            onClose={() => setIsOpen(false)}
          />
        )}
      </div>
    );
  };

  return render(<TestHarness />);
};

describe("CertificateInfoPopup", () => {
  it("renders popover content", () => {
    renderPopup();

    expect(screen.getByTestId("certificate-info-popover")).toBeInTheDocument();
    expect(screen.getByText("Host Key Information")).toBeInTheDocument();
    expect(screen.getByText("example.com:22")).toBeInTheDocument();
  });

  it("closes on outside click and ignores trigger clicks", () => {
    renderPopup();

    expect(screen.getByTestId("certificate-info-popover")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("cert-trigger"));
    expect(screen.getByTestId("certificate-info-popover")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByTestId("certificate-info-popover"),
    ).not.toBeInTheDocument();
  });
});
