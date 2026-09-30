import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTooltipSystem } from "../../src/hooks/window/useTooltipSystem";

function Fixture({ label }: { label?: string }) {
  useTooltipSystem();
  return <button data-tooltip={label} aria-label="Page action" />;
}

describe("application tooltips", () => {
  it.each(["hover", "focus"])(
    "updates a visible %s tooltip when the action changes without a duplicate label",
    async (mode) => {
      const view = render(<Fixture label="Refresh" />);
      const button = screen.getByRole("button", { name: "Page action" });
      if (mode === "hover") fireEvent.mouseOver(button);
      else fireEvent.focusIn(button);

      const tooltip = document.querySelector(".app-tooltip");
      expect(tooltip).toBeVisible();
      expect(tooltip).toHaveTextContent("Refresh");
      await act(async () => view.rerender(<Fixture label="Stop loading" />));
      expect(tooltip).toHaveTextContent("Stop loading");
      expect(document.querySelectorAll(".app-tooltip")).toHaveLength(1);
      expect(button).not.toHaveAttribute("title");

      await act(async () => view.rerender(<Fixture label="Refresh" />));
      expect(tooltip).toHaveTextContent("Refresh");
      await act(async () => view.rerender(<Fixture />));
      expect(tooltip).not.toBeVisible();
      view.unmount();
      expect(document.querySelector(".app-tooltip")).toBeNull();
    },
  );

  it("does not reopen a tooltip when an inactive control changes", async () => {
    const view = render(<Fixture label="Refresh" />);
    const button = screen.getByRole("button", { name: "Page action" });
    fireEvent.mouseOver(button);
    fireEvent.mouseOut(button);
    await act(async () => view.rerender(<Fixture label="Stop loading" />));
    expect(document.querySelector(".app-tooltip")).not.toBeVisible();
  });
});
