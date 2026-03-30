import React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BulkConnectionEditor } from "../../src/components/connection/BulkConnectionEditor";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";
import type { Connection } from "../../src/types/connection/connection";

const mockConnections: Connection[] = [
  {
    id: "conn-1",
    name: "Alpha",
    protocol: "ssh",
    hostname: "alpha.local",
    port: 22,
    username: "root",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "conn-2",
    name: "Beta",
    protocol: "rdp",
    hostname: "beta.local",
    port: 3389,
    username: "administrator",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function Harness() {
  const { dispatch } = useConnections();

  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: mockConnections });
  }, [dispatch]);

  return <BulkConnectionEditor isOpen onClose={() => {}} />;
}

describe("BulkConnectionEditor", () => {
  it("updates aria-sort state on sortable headers", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );

    const nameSortButton = await screen.findByRole("button", { name: /^Name$/i });
    const nameHeader = nameSortButton.closest("th");
    expect(nameHeader).not.toBeNull();
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(nameSortButton);

    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  });
});
