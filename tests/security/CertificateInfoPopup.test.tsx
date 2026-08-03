import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CertificateInfoPopup } from "../../src/components/security/CertificateInfoPopup";
import type {
  CertIdentity,
  SshHostKeyIdentity,
  TrustRecord,
  TrustRecordType,
} from "../../src/utils/auth/trustStore";

const trustStoreMocks = vi.hoisted(() => ({
  updateTrustRecordNickname: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/auth/trustStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/auth/trustStore")>()),
  updateTrustRecordNickname: trustStoreMocks.updateTrustRecordNickname,
}));

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
    trustStoreMocks.updateTrustRecordNickname.mockClear();
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
      screen.getByText("Show PEM Certificate").closest("button")!,
    );
    expect(screen.getByText("Hide PEM Certificate")).toBeInTheDocument();
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

    fireEvent.click(screen.getByText("Show Public Key").closest("button")!);
    expect(screen.getByText("Hide Public Key")).toBeInTheDocument();
  });

  it("updates nicknames using the native general certificate trust record type", async () => {
    const trustRecord: TrustRecord = {
      host: "cert.internal:443",
      type: "certificate",
      identity: certIdentity,
      userApproved: true,
    };

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

    await waitFor(() =>
      expect(trustStoreMocks.updateTrustRecordNickname).toHaveBeenCalledWith(
        "cert.internal",
        443,
        "certificate",
        "Prod Certificate",
        undefined,
      ),
    );
    expect(localStorage.getItem("trustStore")).toBeNull();
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
