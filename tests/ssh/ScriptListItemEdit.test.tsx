import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ScriptListItem from "../../src/components/recording/scriptManager/ScriptListItem";

const script = {
  id: "s1",
  name: "Disk usage",
  description: "df",
  script: "df -h",
  language: "bash",
  category: "Custom",
  osTags: ["agnostic"],
  createdAt: "",
  updatedAt: "",
};

describe("script list context menu", () => {
  it("Edit opens the script in the existing editor flow without selecting it", () => {
    const mgr = {
      selectedScript: null,
      snapshot: null,
      busy: false,
      handleSelectScript: vi.fn(),
      handleEditScript: vi.fn(),
    };
    render(<ScriptListItem script={script as never} mgr={mgr as never} />);
    fireEvent.contextMenu(screen.getByText("Disk usage"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(mgr.handleEditScript).toHaveBeenCalledWith(script);
    expect(mgr.handleSelectScript).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
