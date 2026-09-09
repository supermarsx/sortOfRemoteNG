import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrustCenterRow } from "../../src/hooks/security/useTrustCenter";
import TrustIdentityInspector from "../../src/components/security/TrustIdentityInspector";

const row: TrustCenterRow = {
  id: "row-1",
  connectionId: "connection-7",
  record: {
    host: "gateway.test:443",
    type: "https",
    userApproved: true,
    identity: {
      fingerprint: "AA:BB:CC:EXACT",
      subject: "CN=gateway.test",
      issuer: "Example CA",
      firstSeen: "2026-01-01T12:00:00Z",
      lastSeen: "2026-09-01T12:00:00Z",
      validFrom: "2020-01-01T00:00:00Z",
      validTo: "2099-01-01T00:00:00Z",
      san: ["gateway.test", "192.0.2.4"],
      serial: "001122",
      keyAlgorithm: "RSA",
      keySize: 2048,
      chain: [
        {
          subject: "",
          issuer: "",
          fingerprint: "CHAIN-FP",
          validFrom: "",
          validTo: "",
        },
      ],
    },
  },
};
function mount(
  value = row,
  props: Partial<React.ComponentProps<typeof TrustIdentityInspector>> = {},
) {
  return render(
    <TrustIdentityInspector
      row={value}
      databaseName="Work collection"
      connectionName="Production gateway"
      inspection={{
        rowId: value.id,
        stats: {
          total_checks: 12,
          match_count: 10,
          mismatch_count: 2,
          trust_score: 91,
        },
        history: [
          {
            reason: "user_accepted",
            changed_at: "2026-09-01T12:00:00Z",
            identity: { fingerprint: "PREVIOUS-FP" },
            note: "Verified out of band",
          },
        ],
      }}
      loading={false}
      error={null}
      onClose={vi.fn()}
      {...props}
    >
      <button>Existing label and policy controls</button>
    </TrustIdentityInspector>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("readable Trust Center identity inspector", () => {
  it("puts identity scope and exact fingerprint before readable certificate details and history", () => {
    mount();
    const overview = screen.getByRole("region", { name: "Identity overview" });
    expect(overview).toHaveTextContent("Work collection");
    expect(overview).toHaveTextContent("Production gateway");
    expect(overview).toHaveTextContent("connection-7");
    expect(overview).toHaveTextContent("AA:BB:CC:EXACT");
    expect(
      screen.getByRole("region", { name: "Certificate details" }),
    ).toHaveTextContent("Within stored validity dates");
    expect(
      screen.getByRole("region", { name: "Certificate details" }),
    ).toHaveTextContent("Subject alternative names");
    expect(
      screen.getByRole("region", { name: "Certificate details" }),
    ).toHaveTextContent("2048 bits");
    expect(screen.getByRole("list")).toHaveTextContent("Verified out of band");
    expect(
      screen.getByRole("region", { name: "Verification activity" }),
    ).toHaveTextContent("Identity mismatches");
    expect(
      screen.getByRole("button", {
        name: "Existing label and policy controls",
      }),
    ).toBeVisible();
    const advanced = screen
      .getByText("Advanced raw identity and history")
      .closest("details")!;
    expect(advanced).not.toHaveAttribute("open");
    expect(advanced.querySelector("pre")).not.toBeVisible();
    expect(screen.getByRole("dialog")).toHaveClass(
      "!max-h-[calc(100dvh-5rem)]",
    );
    expect(
      screen
        .getByText("Advanced raw identity and history")
        .closest(".sor-modal-body"),
    ).toHaveClass("p-4");
  });
  it("copies only the public exact fingerprint and reports clipboard refusal honestly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mount();
    const copy = screen.getByRole("button", { name: "Copy fingerprint" });
    expect(copy).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("trusted channel"),
    );
    fireEvent.click(copy);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Fingerprint copied.",
      ),
    );
    expect(writeText).toHaveBeenCalledWith("AA:BB:CC:EXACT");
    writeText.mockRejectedValueOnce(new Error("Private host error"));
    fireEvent.click(copy);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Could not copy fingerprint",
      ),
    );
    expect(screen.queryByText("Private host error")).not.toBeInTheDocument();
  });
  it("shows missing lean/SAN-only metadata as unavailable without losing the identity", () => {
    mount({
      ...row,
      record: {
        ...row.record,
        identity: {
          fingerprint: "SAN-ONLY-FP",
          firstSeen: "",
          lastSeen: "",
          subject: "",
          issuer: "",
        },
      },
    });
    expect(
      screen.getByRole("region", { name: "Identity overview" }),
    ).toHaveTextContent("SAN-ONLY-FP");
    const certificate = screen.getByRole("region", {
      name: "Certificate details",
    });
    expect(certificate).toHaveTextContent("Validity dates unavailable");
    expect(certificate).toHaveTextContent(
      "Not supplied by certificate or extractor",
    );
    expect(certificate).not.toHaveTextContent("Invalid Date");
  });
  it("distinguishes revoked identity status and expired certificate dates", () => {
    mount({
      ...row,
      record: {
        ...row.record,
        revoked: true,
        identity: { ...row.record.identity, validTo: "2001-01-01T00:00:00Z" },
      },
    });
    expect(
      screen.getByRole("region", { name: "Identity overview" }),
    ).toHaveTextContent("Revoked / blocked");
    expect(
      screen.getByRole("region", { name: "Certificate details" }),
    ).toHaveTextContent("Expired");
  });
  it("renders SSH key facts without pretending it has X.509 validity", () => {
    mount({
      id: "ssh",
      record: {
        host: "ssh.test:22",
        type: "ssh",
        userApproved: false,
        identity: {
          fingerprint: "SHA256:SSH",
          keyType: "ssh-ed25519",
          keyBits: 256,
          firstSeen: "",
          lastSeen: "",
        },
      },
    });
    expect(
      screen.queryByRole("region", { name: "Certificate details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "SSH key details" }),
    ).toHaveTextContent("ssh-ed25519");
    expect(
      screen.getByRole("region", { name: "Identity overview" }),
    ).toHaveTextContent("All connections in this database");
  });
  it("keeps inspection errors readable inside the dialog and preserves Close", () => {
    const close = vi.fn();
    mount(row, {
      inspection: null,
      error: "The trust database is locked.",
      onClose: close,
    });
    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("The trust database is locked.");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
