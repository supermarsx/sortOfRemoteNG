import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BulkEditEntriesDialog from "../../src/components/documents/BulkEditEntriesDialog";

afterEach(cleanup);
const select = (name: string, option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};
const show = (section: "documents" | "people" | "tickets" = "tickets") => {
  const props = {
    section,
    count: 2,
    folders: [{ id: "folder", name: "Team" }],
    tagSuggestions: ["Network"],
    onClose: vi.fn(),
    onApply: vi.fn(),
  };
  return { ...render(<BulkEditEntriesDialog {...props} />), props };
};
describe("bulk entry review dialog", () => {
  it.each(["documents", "people", "tickets"] as const)(
    "starts %s unchanged, never applies on open/cancel",
    (section) => {
      const view = show(section);
      for (const control of screen.getAllByRole("combobox"))
        expect(control).toHaveTextContent("Keep unchanged");
      fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Choose at least one field",
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(view.props.onClose).toHaveBeenCalledOnce();
      expect(view.props.onApply).not.toHaveBeenCalled();
    },
  );
  it("reviews the exact ticket changes before one apply, preserves explicit Keep and themed controls", async () => {
    const view = show();
    select("Bulk ticket status", "Resolved");
    select("Bulk tags", "Add tags (keep existing)");
    fireEvent.click(screen.getByRole("button", { name: "Use tag Network" }));
    const review = screen.getByRole("button", { name: "Review changes" });
    expect(review).toHaveClass("sor-btn", "sor-btn-primary");
    fireEvent.click(review);
    expect(view.props.onApply).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Review bulk changes" }),
    ).toHaveTextContent("Add: Network");
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
    await waitFor(() => expect(view.props.onClose).toHaveBeenCalledOnce());
    expect(view.props.onApply).toHaveBeenCalledExactlyOnceWith({
      section: "tickets",
      status: { mode: "set", value: "resolved" },
      priority: { mode: "keep" },
      tags: { mode: "add", values: ["Network"] },
    });
  });
  it("supports explicit organization/tag clear and cancelable review", async () => {
    const view = show("people");
    select("Bulk organization", "Clear organization");
    select("Bulk tags", "Clear all tags");
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(
      screen.getByRole("region", { name: "Review bulk changes" }),
    ).toHaveTextContent("Clear organization");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("combobox", { name: "Bulk organization" }),
    ).toHaveTextContent("Clear organization");
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
    await waitFor(() =>
      expect(view.props.onApply).toHaveBeenCalledWith({
        section: "people",
        organization: { mode: "set", value: "" },
        tags: { mode: "clear" },
      }),
    );
  });
  it("reviews folder and vector icon selection without constructing content or altering Keep fields", async () => {
    const view = show("documents");
    select("Bulk document folder", "Team");
    select("Bulk document icon", "Change document icon");
    fireEvent.click(
      screen.getByRole("button", { name: "Document icon: Text file" }),
    );
    fireEvent.change(screen.getByLabelText("Search document icons"), {
      target: { value: "Text file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Text file" }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(
      screen.getByRole("region", { name: "Review bulk changes" }),
    ).toHaveTextContent("Move to Team");
    expect(view.props.onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
    await waitFor(() =>
      expect(view.props.onApply).toHaveBeenCalledExactlyOnceWith({
        section: "documents",
        folder: { mode: "set", value: "folder" },
        icon: { mode: "set", value: "file-text" },
      }),
    );
  });
  it("coalesces repeated submission and keeps a failed review without raw failure details", async () => {
    const view = show("documents");
    select("Bulk document folder", "Move to database root");
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    let reject!: (reason: unknown) => void;
    view.props.onApply.mockImplementation(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    const form = screen.getByRole("form", { name: "Bulk entry changes" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(view.props.onApply).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => {
      reject(new Error("SECRET_PATH"));
    });
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET_PATH");
    expect(screen.getByRole("alert")).toHaveTextContent("No partial batch");
    expect(view.props.onClose).not.toHaveBeenCalled();
  });
  it("blocks a previously opened portal and retained review when access becomes unavailable", () => {
    const view = show();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Bulk ticket status" }),
    );
    view.rerender(<BulkEditEntriesDialog {...view.props} disabled />);
    fireEvent.mouseDown(screen.getByRole("option", { name: "Closed" }));
    expect(
      screen.getByRole("combobox", { name: "Bulk ticket status" }),
    ).toHaveTextContent("Keep unchanged");
    fireEvent.submit(screen.getByRole("form", { name: "Bulk entry changes" }));
    expect(view.props.onApply).not.toHaveBeenCalled();
  });
});
