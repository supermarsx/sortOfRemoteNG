import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SSHTunnelDialog } from "../src/components/ssh/SSHTunnelDialog";

describe("SSHTunnelDialog", () => {
  const sshConnections = [
    {
      id: "conn-1",
      name: "SSH Prod",
      hostname: "prod.example.com",
      port: 22,
      protocol: "ssh",
      isGroup: false,
    } as any,
  ];

  it("does not render when closed", () => {
    render(
      <SSHTunnelDialog
        isOpen={false}
        onClose={() => {}}
        onSave={() => {}}
        sshConnections={sshConnections}
      />,
    );

    expect(screen.queryByText("Create SSH Tunnel")).not.toBeInTheDocument();
  });

  it("closes on backdrop and escape", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <SSHTunnelDialog
        isOpen
        onClose={onClose}
        onSave={() => {}}
        sshConnections={sshConnections}
      />,
    );

    await screen.findByText("Create SSH Tunnel");
    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("submits valid tunnel form", async () => {
    const onSave = vi.fn();

    render(
      <SSHTunnelDialog
        isOpen
        onClose={() => {}}
        onSave={onSave}
        sshConnections={sshConnections}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("My SSH Tunnel"), {
      target: { value: "My Tunnel" },
    });
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "conn-1" },
    });
    fireEvent.change(screen.getByPlaceholderText("0 = auto"), {
      target: { value: "1080" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Tunnel" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Tunnel",
          sshConnectionId: "conn-1",
          localPort: 1080,
          type: "local",
        }),
      );
    });
  });
});
