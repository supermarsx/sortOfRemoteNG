import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The real i18n instance is not initialized under vitest, so react-i18next's
// fallback `t` returns the defaultValue without interpolating `{{count}}`.
// Mock it to mirror the `t(key, defaultValue, { count })` contract the editor
// uses so "{{count}} selected" renders as "2 selected".
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string, options?: Record<string, unknown>) => {
      let result = defaultValue ?? key;
      if (options) {
        for (const [name, value] of Object.entries(options)) {
          result = result.replace(
            new RegExp(`{{\\s*${name}\\s*}}`, "g"),
            String(value),
          );
        }
      }
      return result;
    },
  }),
}));
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
    isGroup: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "conn-2",
    name: "Beta",
    protocol: "rdp",
    hostname: "beta.local",
    port: 3389,
    username: "administrator",
    isGroup: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

  it("renders connection names in the table", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders hostnames in the table", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText("alpha.local")).toBeInTheDocument();
    expect(screen.getByText("beta.local")).toBeInTheDocument();
  });

  it("filters connections by search term", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );
    await screen.findByText("Alpha");

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "Alpha" } });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("selects all connections when select-all is clicked", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );
    await screen.findByText("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Select all visible connections" }));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("shows empty state when search matches nothing", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );
    await screen.findByText("Alpha");

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "nonexistent-xyz" } });

    expect(screen.getByText("No connections match your search")).toBeInTheDocument();
  });
});
