import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProxyProfileEditor } from "../src/components/ProxyProfileEditor";

describe("ProxyProfileEditor", () => {
  it("does not render when closed", () => {
    render(
      <ProxyProfileEditor
        isOpen={false}
        onClose={() => {}}
        onSave={() => {}}
        editingProfile={null}
      />,
    );

    expect(screen.queryByText("New Proxy Profile")).not.toBeInTheDocument();
  });

  it("closes on backdrop click", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <ProxyProfileEditor
        isOpen
        onClose={onClose}
        onSave={() => {}}
        editingProfile={null}
      />,
    );

    await screen.findByText("New Proxy Profile");
    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("saves profile with required fields", async () => {
    const onSave = vi.fn();

    render(
      <ProxyProfileEditor
        isOpen
        onClose={() => {}}
        onSave={onSave}
        editingProfile={null}
      />,
    );

    const nameInput = screen.getByPlaceholderText("My SOCKS5 Proxy");
    const hostInput = screen.getByPlaceholderText("proxy.example.com");
    const portInput = screen.getByPlaceholderText("1080");
    const defaultCheckbox = screen.getByRole("checkbox");

    expect(nameInput.className).toContain("sor-form-input");
    expect(hostInput.className).toContain("sor-form-input");
    expect(defaultCheckbox.className).toContain("sor-form-checkbox");

    fireEvent.change(nameInput, {
      target: { value: "Office Proxy" },
    });
    fireEvent.change(hostInput, {
      target: { value: "proxy.local" },
    });
    fireEvent.change(portInput, {
      target: { value: "3128" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Profile" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Office Proxy",
          config: expect.objectContaining({
            host: "proxy.local",
            port: 3128,
          }),
        }),
      );
    });
  });
});
