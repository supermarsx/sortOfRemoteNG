import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProxyChainEditor } from "../src/components/ProxyChainEditor";

const mocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
}));

vi.mock("../src/utils/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    getProfiles: mocks.getProfiles,
  },
}));

describe("ProxyChainEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfiles.mockReturnValue([
      {
        id: "profile-1",
        name: "SOCKS Gateway",
        config: {
          type: "socks5",
          host: "127.0.0.1",
          port: 1080,
          enabled: true,
        },
      },
    ]);
  });

  it("does not render when closed", () => {
    render(
      <ProxyChainEditor
        isOpen={false}
        onClose={() => {}}
        onSave={() => {}}
        editingChain={null}
      />,
    );

    expect(screen.queryByText("New Proxy Chain")).not.toBeInTheDocument();
  });

  it("shows validation error when saving empty", () => {
    render(
      <ProxyChainEditor
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        editingChain={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Chain" }));
    expect(screen.getByText("Chain name is required")).toBeInTheDocument();
  });

  it("creates chain with selected proxy layer", async () => {
    const onSave = vi.fn();

    render(
      <ProxyChainEditor
        isOpen
        onClose={() => {}}
        onSave={onSave}
        editingChain={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("My Proxy Chain"), {
      target: { value: "Office Chain" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add Layer/i }));

    fireEvent.change(screen.getByDisplayValue("Select profile..."), {
      target: { value: "profile-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Chain" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Office Chain",
          layers: [
            expect.objectContaining({
              type: "proxy",
              proxyProfileId: "profile-1",
              position: 0,
            }),
          ],
        }),
      );
    });
  });
});
