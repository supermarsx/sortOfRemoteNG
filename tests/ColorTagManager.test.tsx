import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ColorTagManager } from "../src/components/ColorTagManager";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

describe("ColorTagManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });

  it("does not render when closed", () => {
    render(
      <ColorTagManager
        isOpen={false}
        onClose={() => {}}
        colorTags={{}}
        onUpdateColorTags={() => {}}
      />,
    );

    expect(screen.queryByText("Color Tag Manager")).not.toBeInTheDocument();
  });

  it("adds a new tag", async () => {
    const onUpdateColorTags = vi.fn();
    render(
      <ColorTagManager
        isOpen
        onClose={() => {}}
        colorTags={{}}
        onUpdateColorTags={onUpdateColorTags}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Add Tag/i }));
    fireEvent.change(screen.getByPlaceholderText("Enter tag name"), {
      target: { value: "Production" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: /^Add Tag$/i })[1]);

    await waitFor(() => {
      expect(onUpdateColorTags).toHaveBeenCalled();
    });

    const payload = onUpdateColorTags.mock.calls[0][0] as Record<
      string,
      { name: string; color: string; global: boolean }
    >;
    const created = Object.values(payload)[0];
    expect(created.name).toBe("Production");
    expect(created.color).toBe("#3b82f6");
  });

  it("edits and deletes existing tag", async () => {
    const onUpdateColorTags = vi.fn();
    const initial = {
      tag1: {
        id: "tag1",
        name: "Old Name",
        color: "#ef4444",
        global: true,
      },
    };

    render(
      <ColorTagManager
        isOpen
        onClose={() => {}}
        colorTags={initial}
        onUpdateColorTags={onUpdateColorTags}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit"));
    const editInput = screen.getByDisplayValue("Old Name");
    fireEvent.change(editInput, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(onUpdateColorTags).toHaveBeenCalledWith(
        expect.objectContaining({
          tag1: expect.objectContaining({ name: "New Name" }),
        }),
      );
    });

    fireEvent.click(screen.getByTitle("Delete"));

    await waitFor(() => {
      expect(onUpdateColorTags).toHaveBeenCalledWith({});
    });
  });
});
