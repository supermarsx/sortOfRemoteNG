import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocumentReferencePicker from "../../src/components/documents/DocumentReferencePicker";
import type { Connection } from "../../src/types/connection/connection";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";

const connection: Connection = {
  id: "connection-a",
  name: "Development server",
  protocol: "ssh",
  hostname: "dev.example.test",
  port: 22,
  isGroup: false,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
};

function renderPicker() {
  const onClose = vi.fn();
  render(
    <DocumentReferencePicker
      data={emptyDatabaseDocuments()}
      connections={[connection]}
      databaseId="database-a"
      onClose={onClose}
    />,
  );
  return onClose;
}

afterEach(cleanup);

describe("record link picker", () => {
  it("uses standard modal body padding without changing section spacing", () => {
    renderPicker();
    const dialog = screen.getByRole("dialog", { name: "Link to a record" });
    expect(dialog).toHaveClass("sor-modal-panel", "mx-4");
    expect(dialog.querySelector(".sor-modal-body")).toHaveClass(
      "space-y-3",
      "px-5",
      "py-4",
    );
    expect(dialog.querySelector(".sor-modal-header")).toBeInTheDocument();
    expect(dialog.querySelector(".sor-modal-footer")).toBeInTheDocument();
  });

  it("returns the selected record with its owning database only on confirmation", () => {
    const onClose = renderPicker();
    const add = screen.getByRole("button", { name: "Add link" });
    expect(add).toBeDisabled();
    const record = screen.getByRole("option", {
      name: /Development server\s*SSH/,
    });
    fireEvent.click(record);
    expect(record).toHaveAttribute("aria-selected", "true");
    expect(add).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(add);
    expect(onClose).toHaveBeenCalledExactlyOnceWith({
      databaseId: "database-a",
      kind: "connection",
      id: "connection-a",
    });
  });

  it("cancels without returning the selected record", () => {
    const onClose = renderPicker();
    fireEvent.click(
      screen.getByRole("option", { name: /Development server\s*SSH/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith(null);
  });
});
