import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TrustIdentityScopeDialog,
  type TrustScopeReview,
} from "../../src/components/security/TrustIdentityScopeDialog";
import type { Connection } from "../../src/types/connection/connection";
const connection: Connection = {
  id: "conn-1",
  name: "Application dashboard",
  protocol: "https",
  hostname: "different.example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
function review(count = 1): TrustScopeReview {
  return {
    databaseId: "db-a",
    databaseName: "Operations",
    rows: Array.from({ length: count }, (_, index) => ({
      id: `row-${index}`,
      connectionId: "conn-1",
      record: {
        host: `endpoint-${index}.example.test:443`,
        type: "https",
        userApproved: false,
        revoked: true,
        scopeDecision: {
          userApproved: false,
          revoked: true,
          trustExpires: null,
          hostPolicy: null,
          hostPolicyConfig: null,
        },
        identity: {
          fingerprint: `FP-${index}`,
          firstSeen: "2026-01-01",
          lastSeen: "2026-01-01",
        },
      },
    })),
  };
}
describe("reviewed trust scope dialog", () => {
  it("requires an explicit destination and separate broadening acknowledgment", () => {
    const confirm = vi.fn();
    render(
      <TrustIdentityScopeDialog
        review={review()}
        connections={[connection]}
        busy={false}
        onClose={vi.fn()}
        onConfirm={confirm}
      />,
    );
    const apply = screen.getByRole("button", { name: "Apply reviewed scope" });
    expect(
      screen.getByRole("combobox", { name: "New identity scope" }),
    ).toHaveTextContent("Choose a scope to review");
    expect(apply).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByRole("option", { name: /Database-wide/ }));
    expect(
      screen.getByText(/This broadens 1 connection-specific decisions/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Revoked \(retained\)/)).toBeInTheDocument();
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(apply);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(null);
  });
  it("identifies saved connections by name, protocol and host without rebinding the stored identity", () => {
    const confirm = vi.fn();
    render(
      <TrustIdentityScopeDialog
        review={review()}
        connections={[connection]}
        busy={false}
        onClose={vi.fn()}
        onConfirm={confirm}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(
      screen.getByPlaceholderText(
        "Search saved connection name, host, protocol or ID",
      ),
      { target: { value: "different.example" } },
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: /Application dashboard — HTTPS · different.example.test:443/,
      }),
    );
    expect(
      screen.getByText(/does not rebind this certificate/),
    ).toBeInTheDocument();
    expect(screen.getByText("endpoint-0.example.test:443")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Apply reviewed scope" }),
    );
    expect(confirm).toHaveBeenCalledExactlyOnceWith("conn-1");
  });
  it("bounds large reviews to100 rows while retaining the complete reviewed scope", () => {
    render(
      <TrustIdentityScopeDialog
        review={review(10000)}
        connections={[connection]}
        busy={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      101,
    );
    expect(
      screen.getByText(/all 10000 identities are included/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next review page" }));
    expect(
      screen.getByText("endpoint-100.example.test:443"),
    ).toBeInTheDocument();
  });
  it("clears approval for another review and disallows a deleted destination or busy dismissal", () => {
    const close = vi.fn();
    const props = {
      review: review(),
      connections: [connection],
      busy: false,
      onClose: close,
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<TrustIdentityScopeDialog {...props} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: /Application dashboard/ }),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    rerender(<TrustIdentityScopeDialog {...props} connections={[]} />);
    expect(
      screen.getByRole("button", { name: "Apply reviewed scope" }),
    ).toBeDisabled();
    rerender(<TrustIdentityScopeDialog {...props} review={review(2)} busy />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });
});
