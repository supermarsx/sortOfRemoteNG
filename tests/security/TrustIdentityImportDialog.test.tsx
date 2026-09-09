import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TrustIdentityImportDialog,
  type TrustIdentityImportReview,
} from "../../src/components/security/TrustIdentityImportDialog";

function review(count = 1): TrustIdentityImportReview {
  return {
    databaseId: "fixture",
    databaseName: "Team database",
    expectedRecords: [
      {
        host: "host-0.example.test:443",
        record_type: "https",
        identity: { fingerprint: "OLD-FINGERPRINT" },
        user_approved: true,
        revoked: true,
      },
    ],
    document: {
      version: 1,
      records: Array.from({ length: count }, (_, i) => ({
        host: `host-${i}.example.test:443`,
        record_type: "https",
        identity: { fingerprint: `NEW-FINGERPRINT-${i}` },
        user_approved: false,
      })),
    },
    warnings: ["Only supported entries were parsed; review their origin."],
    skipped: 2,
  };
}
describe("reviewed trust import layout and safeguards", () => {
  it("keeps padded review content separate from the persistent confirmation footer", async () => {
    const onConfirm = vi.fn();
    render(
      <TrustIdentityImportDialog
        review={review()}
        busy={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("dialog", {
      name: "Review trust identity import",
    });
    expect(dialog).toHaveClass("max-w-5xl", "!max-h-[calc(100dvh-5rem)]");
    expect(dialog.querySelector(".sor-modal-body")).toHaveClass("px-4", "py-4");
    const confirm = within(dialog).getByRole("button", {
      name: "Merge reviewed identities",
    });
    expect(confirm.closest(".sor-modal-footer")).toHaveClass("shrink-0");
    expect(confirm.closest(".sor-modal-body")).toBeNull();
    expect(confirm).toBeDisabled();
    expect(
      screen.getByText(
        "Imported scopes are preserved within this database. No connection is opened or moved.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Existing revocation preserved"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Different fingerprint — possible replacement"),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(confirm).toBeEnabled());
    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it("renders at most 100 review records but confirms the complete import", () => {
    render(
      <TrustIdentityImportDialog
        review={review(10000)}
        busy={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    expect(
      screen.getByText(/confirmation covers all 10000 identities/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next review page" }));
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    expect(screen.getByText("host-100.example.test:443")).toBeInTheDocument();
    expect(
      screen.queryByText("host-0.example.test:443"),
    ).not.toBeInTheDocument();
  });
  it("clears acknowledgment on a new review and blocks duplicate busy submission", () => {
    const props = {
      review: review(),
      busy: false,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<TrustIdentityImportDialog {...props} />);
    fireEvent.click(screen.getByRole("checkbox"));
    rerender(
      <TrustIdentityImportDialog
        {...props}
        review={{
          ...review(),
          databaseId: "other",
          databaseName: "Other database",
        }}
      />,
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Merge reviewed identities" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    rerender(<TrustIdentityImportDialog {...props} busy />);
    const confirm = screen.getByRole("button", {
      name: "Merge reviewed identities",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it("preserves mixed native scopes and displays canonical endpoints with connection names", () => {
    const mixed = review(2);
    mixed.document.records[1].host =
      "@sorng/connection/v1/connection-7/server.example.test/443";
    render(
      <TrustIdentityImportDialog
        review={mixed}
        busy={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        connectionName={() => "Production dashboard"}
      />,
    );
    expect(
      screen.getByText("1 database-wide · 1 connection-scoped"),
    ).toBeInTheDocument();
    expect(screen.getByText("server.example.test:443")).toBeInTheDocument();
    expect(
      screen.getByText("https · Connection: Production dashboard"),
    ).toBeInTheDocument();
    expect(screen.getByText("Connection ID: connection-7")).toBeInTheDocument();
    expect(screen.getByText("https · Database-wide")).toBeInTheDocument();
  });
  it("does not mislabel an unrecognized scope as database-wide or allow import", () => {
    const invalid = review();
    invalid.document.records[0].host = "@sorng/connection/v1/malformed";
    const onConfirm = vi.fn();
    render(
      <TrustIdentityImportDialog
        review={invalid}
        busy={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Import is unavailable",
    );
    expect(
      screen.getByText("https · Unrecognized scope / endpoint"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    const confirm = screen.getByRole("button", {
      name: "Merge reviewed identities",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
