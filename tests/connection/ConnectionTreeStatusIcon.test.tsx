import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ConnectionTreeRow } from "../../src/components/connection/connectionTree/ConnectionTreeItem";

vi.mock("../../src/components/connection/connectionTree/TreeItemMenu", () => ({
  default: () => null,
}));
vi.mock(
  "../../src/components/connection/connectionTree/MultiSelectMenu",
  () => ({ default: () => null }),
);

const props: ComponentProps<typeof ConnectionTreeRow> = {
  connection: {
    id: "server",
    name: "Mail server",
    protocol: "https",
    hostname: "mail.example.test",
    port: 443,
    isGroup: false,
    icon: "outlook",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  },
  level: 0,
  isSelected: false,
  isMultiSelected: false,
  dispatch: vi.fn(),
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onCopyHostname: vi.fn(),
  onRename: vi.fn(),
  onExport: vi.fn(),
  onConnectWithOptions: vi.fn(),
  onConnectWithoutCredentials: vi.fn(),
  onExecuteScripts: vi.fn(),
  onDuplicate: vi.fn(),
  enableReorder: false,
  isDragging: false,
  isDragOver: false,
  dropPosition: null,
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDragLeave: vi.fn(),
  onDragEnd: vi.fn(),
  onDrop: vi.fn(),
};

afterEach(cleanup);
describe("connection tree status presentation", () => {
  it("keeps the configured icon neutral through connection state changes; only the indicator changes", () => {
    const { container, rerender } = render(<ConnectionTreeRow {...props} />);
    const initialIcon = container.querySelector("svg[aria-label]")!;
    const initialMarkup = initialIcon.outerHTML;
    expect(initialIcon).toHaveClass("text-[var(--color-textSecondary)]");
    for (const [status, color] of [
      ["connecting", "bg-warning"],
      ["connected", "bg-success"],
      ["error", "bg-error"],
    ] as const) {
      rerender(
        <ConnectionTreeRow
          {...props}
          activeSession={{
            id: "session",
            connectionId: "server",
            name: "Mail server",
            protocol: "https",
            hostname: "mail.example.test",
            startTime: new Date("2026-10-01T00:00:00Z"),
            status,
          }}
        />,
      );
      expect(container.querySelector("svg[aria-label]")!.outerHTML).toBe(
        initialMarkup,
      );
      const dot = screen.getByRole("img", { name: status });
      expect(dot).toHaveClass(color);
      if (status === "connecting") expect(dot).toHaveClass("animate-pulse");
      else expect(dot).not.toHaveClass("animate-pulse");
    }
    rerender(<ConnectionTreeRow {...props} />);
    expect(container.querySelector("svg[aria-label]")!.outerHTML).toBe(
      initialMarkup,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("retains configured folder colors", () => {
    const { container } = render(
      <ConnectionTreeRow
        {...props}
        connection={{ ...props.connection, isGroup: true, icon: "folder" }}
        folderIconColor="#aa66cc"
      />,
    );
    expect(container.querySelector("svg[aria-label]")).toHaveStyle({
      color: "#aa66cc",
    });
  });
});
