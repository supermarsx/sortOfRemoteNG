import React from "react";
import { beforeEach, describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CertificateInfoPopup } from "../../src/components/security/CertificateInfoPopup";
import type { CertIdentity, SshHostKeyIdentity, TrustRecord, TrustRecordType } from "../../src/utils/auth/trustStore";

const sshIdentity: SshHostKeyIdentity = {
  fingerprint: "SHA256:test-fingerprint",
  keyType: "ssh-ed25519",
  keyBits: 256,
  firstSeen: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  lastSeen: new Date("2026-01-02T00:00:00.000Z").toISOString(),
};

const certIdentity: CertIdentity = {
  fingerprint: "SHA256:test-certificate",
  subject: "CN=example.com",
  issuer: "CN=Example CA",
  firstSeen: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  lastSeen: new Date("2026-01-02T00:00:00.000Z").toISOString(),
};

const renderPopup = ({
  type = "ssh",
  host = "example.com",
  port = 22,
  currentIdentity = sshIdentity,
  trustRecord,
}: {
  type?: TrustRecordType;
  host?: string;
  port?: number;
  currentIdentity?: CertIdentity | SshHostKeyIdentity;
  trustRecord?: TrustRecord;
} = {}) => {
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
            type={type}
            host={host}
            port={port}
            currentIdentity={currentIdentity}
            trustRecord={trustRecord}
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
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders popover content", () => {
    renderPopup();

    expect(screen.getByTestId("certificate-info-popover")).toBeInTheDocument();
    expect(screen.getByText("Host Key Information")).toBeInTheDocument();
    expect(screen.getByText("example.com:22")).toBeInTheDocument();
  });

  it.each([
    ["certificate", "General Certificate Information", 443],
    ["https", "HTTPS Certificate Information", 443],
    ["rdp", "RDP Certificate Information", 3389],
    ["tls", "Legacy TLS Certificate Information", 443],
  ] as const)("renders explicit %s information title", (type, title, port) => {
    renderPopup({ type, port, currentIdentity: certIdentity });

    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it("renders certificate detail English fallbacks and toggle states", () => {
    const detailedIdentity: CertIdentity = {
      ...certIdentity,
      subjectCn: "example.com",
      issuerCn: "Example CA",
      validFrom: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      validTo: new Date("2036-01-01T00:00:00.000Z").toISOString(),
      version: 3,
      keyAlgorithm: "RSA",
      keySize: 2048,
      signatureAlgorithm: "SHA256withRSA",
      serial: "01:23",
      san: ["example.com"],
      pem: "-----BEGIN CERTIFICATE-----",
    };

    renderPopup({
      type: "https",
      port: 443,
      currentIdentity: detailedIdentity,
    });

    expect(screen.getByText("Fingerprint (SHA-256)")).toBeInTheDocument();
    expect(screen.getByText("Subject")).toBeInTheDocument();
    expect(screen.getByText("Issuer")).toBeInTheDocument();
    expect(screen.getByText("Validity Period")).toBeInTheDocument();
    expect(screen.getByText("Key & Algorithm")).toBeInTheDocument();
    expect(screen.getByText("Subject Alternative Names")).toBeInTheDocument();
    expect(screen.getByText("PEM Certificate")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Show PEM Certificate" }),
    );
    expect(
      screen.getByRole("button", { name: "Hide PEM Certificate" }),
    ).toBeInTheDocument();
  });

  it("renders SSH detail English fallbacks and toggle states", () => {
    renderPopup({
      currentIdentity: {
        ...sshIdentity,
        publicKey: "ssh-ed25519 AAAA-test",
      },
    });

    expect(screen.getByText("Key Type")).toBeInTheDocument();
    expect(screen.getByText("Key Bits")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show Public Key" }));
    expect(
      screen.getByRole("button", { name: "Hide Public Key" }),
    ).toBeInTheDocument();
  });

  it("updates nicknames using the general certificate trust record type", () => {
    const trustRecord: TrustRecord = {
      host: "cert.internal:443",
      type: "certificate",
      identity: certIdentity,
      userApproved: true,
    };

    localStorage.setItem(
      "trustStore",
      JSON.stringify({
        "certificate:cert.internal:443": trustRecord,
        "tls:cert.internal:443": {
          ...trustRecord,
          type: "tls",
          identity: { ...certIdentity, fingerprint: "SHA256:legacy" },
        },
      }),
    );

    renderPopup({
      type: "certificate",
      host: "cert.internal",
      port: 443,
      currentIdentity: certIdentity,
      trustRecord,
    });

    fireEvent.click(screen.getByTitle("Edit nickname"));
    fireEvent.change(screen.getByPlaceholderText("Add a nickname…"), {
      target: { value: "Prod Certificate" },
    });
    fireEvent.click(screen.getByTitle("Save"));

    const store = JSON.parse(localStorage.getItem("trustStore") ?? "{}");
    expect(store["certificate:cert.internal:443"].nickname).toBe("Prod Certificate");
    expect(store["tls:cert.internal:443"].nickname).toBeUndefined();
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
