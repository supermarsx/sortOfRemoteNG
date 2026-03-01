import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrustWarningDialog } from "../src/components/security/TrustWarningDialog";

describe("TrustWarningDialog", () => {
  const now = "2026-02-01T00:00:00.000Z";

  it("renders first-use warning and handles actions", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();

    render(
      <TrustWarningDialog
        type="tls"
        host="example.com"
        port={443}
        reason="first-use"
        receivedIdentity={{
          fingerprint: "AA:BB:CC",
          firstSeen: now,
          lastSeen: now,
        }}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );

    expect(screen.getByText("Unknown Certificate")).toBeInTheDocument();
    expect(screen.getAllByText(/example.com:443/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Accept & Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("renders mismatch details", () => {
    render(
      <TrustWarningDialog
        type="ssh"
        host="ssh.internal"
        port={22}
        reason="mismatch"
        receivedIdentity={{
          fingerprint: "NEW:FP:123",
          firstSeen: now,
          lastSeen: now,
        }}
        storedIdentity={{
          fingerprint: "OLD:FP:999",
          firstSeen: now,
          lastSeen: now,
        }}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByText("Host Key Has Changed!")).toBeInTheDocument();
    expect(screen.getByText("Previously Stored")).toBeInTheDocument();
    expect(screen.getByText("Received Now")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Trust New Key & Continue/i }),
    ).toBeInTheDocument();
  });

  it("does not close on backdrop click", () => {
    const onReject = vi.fn();
    const { container } = render(
      <TrustWarningDialog
        type="tls"
        host="example.com"
        port={443}
        reason="first-use"
        receivedIdentity={{
          fingerprint: "AA:BB:CC",
          firstSeen: now,
          lastSeen: now,
        }}
        onAccept={() => {}}
        onReject={onReject}
      />,
    );

    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onReject).not.toHaveBeenCalled();
  });
});
