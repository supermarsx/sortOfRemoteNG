import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppBottomBars } from "../../src/components/app/AppBottomBars";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const props: React.ComponentProps<typeof AppBottomBars> = {
  showStatusBar: true,
  showErrorLog: true,
  onToggleErrorLog: vi.fn(),
  connections: [],
  sessions: [],
  databaseManager: {
    getCurrentDatabase: () => ({ name: "Layout regression collection" }),
  } as unknown as React.ComponentProps<typeof AppBottomBars>["databaseManager"],
  isInitialized: true,
};

describe("app bottom bar stacking", () => {
  it("keeps the real collapsed and expanded log above the normal status bar in flow", () => {
    render(<AppBottomBars {...props} />);
    const stack = screen.getByTestId("app-bottom-bars");
    const log = screen.getByTestId("error-log-bar");
    const status = screen
      .getByText("Layout regression collection")
      .closest(".app-status-bar");
    expect(stack).toHaveClass("flex", "flex-col", "shrink-0");
    expect(log).toHaveClass("relative", "shrink-0");
    expect(log.className).not.toMatch(
      /(?:^|\s)(?:fixed|absolute|bottom-0)(?:\s|$)/,
    );
    expect(log.parentElement).toBe(stack);
    expect(log.nextElementSibling).toBe(status);
    expect(stack.lastElementChild).toBe(status);

    fireEvent.click(screen.getByRole("button", { name: "Expand error log" }));
    const list = screen.getByText("No errors recorded").parentElement;
    expect(list).toHaveClass("max-h-64", "overflow-y-auto");
    expect(log.nextElementSibling).toBe(status);
    expect(
      screen.getByRole("button", { name: "Collapse error log" }),
    ).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Collapse error log" }));
    expect(screen.queryByText("No errors recorded")).not.toBeInTheDocument();
    expect(log.nextElementSibling).toBe(status);
  });

  it("keeps collecting while hidden and retains history across visibility and fullscreen changes", async () => {
    const view = render(<AppBottomBars {...props} showErrorLog={false} />);
    expect(screen.queryByTestId("error-log-bar")).not.toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "Hidden captured layout error" }),
      );
      await Promise.resolve();
    });
    view.rerender(<AppBottomBars {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand error log" }));
    expect(
      screen.getByText("Hidden captured layout error"),
    ).toBeInTheDocument();

    view.rerender(<AppBottomBars {...props} showStatusBar={false} />);
    expect(
      screen.queryByText("Layout regression collection"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Hidden captured layout error"),
    ).toBeInTheDocument();
    view.rerender(<AppBottomBars {...props} />);
    expect(
      screen.getByText("Layout regression collection"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Hidden captured layout error"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Hide error log"));
    expect(props.onToggleErrorLog).toHaveBeenCalledOnce();
  });

  it("has one bottom-bar mount before dialogs and no duplicate dialog log mount", () => {
    const tagsIn = (path: string) => {
      const source = ts.createSourceFile(
        path,
        readFileSync(resolve(process.cwd(), path), "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const tags: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
          tags.push(node.tagName.getText(source));
        ts.forEachChild(node, visit);
      };
      visit(source);
      return tags;
    };
    const app = tagsIn("src/App.tsx");
    expect(app.filter((tag) => tag === "AppBottomBars")).toHaveLength(1);
    expect(app.indexOf("AppBottomBars")).toBeLessThan(
      app.indexOf("AppDialogs"),
    );
    expect(app).not.toContain("ErrorLogBar");
    expect(app).not.toContain("AppStatusBar");
    expect(tagsIn("src/components/app/AppDialogs.tsx")).not.toContain(
      "ErrorLogBar",
    );
  });
});
