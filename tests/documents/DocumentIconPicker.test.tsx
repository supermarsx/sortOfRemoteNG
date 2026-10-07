import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentIconPicker } from "../../src/components/documents/DocumentIconPicker";
import { EMPTY_ICON_LIBRARY } from "../../src/utils/icons/iconLibrary";
import {
  getIconLibrarySnapshot,
  publishIconLibrary,
} from "../../src/utils/icons/iconLibraryRuntime";

afterEach(() => {
  cleanup();
  publishIconLibrary(EMPTY_ICON_LIBRARY, { ready: false });
  vi.restoreAllMocks();
});

function ControlledPicker({ onChange = vi.fn() } = {}) {
  const [value, setValue] = useState("file-text");
  return (
    <DocumentIconPicker
      value={value}
      variant="compact"
      onChange={(key) => {
        onChange(key);
        setValue(key);
      }}
    />
  );
}

const openPicker = () => {
  const trigger = screen.getByRole("button", { name: /^Document icon:/ });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};
const searchFor = (value: string) =>
  fireEvent.change(screen.getByLabelText("Search document icons"), {
    target: { value },
  });
const choices = () =>
  within(screen.getByRole("group", { name: "Document icons" }));
const nextFrame = () =>
  act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });

describe("DocumentIconPicker default variant", () => {
  it("keeps the creation-dialog trigger, native titles, and inline selection", () => {
    const onChange = vi.fn();
    render(<DocumentIconPicker value="file-text" onChange={onChange} />);
    const trigger = openPicker();
    expect(trigger).toHaveTextContent("Choose icon");
    expect(trigger).toHaveClass("sor-btn", "sor-btn-secondary");
    expect(trigger).toHaveAttribute("title", "Choose document icon");
    expect(trigger).not.toHaveAttribute("aria-haspopup");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger.parentElement).toContainElement(
      screen.getByLabelText("Search document icons"),
    );
    searchFor("Text file");
    const selected = choices().getByRole("button", { name: "Text file" });
    expect(selected).toHaveClass("sor-icon-btn", "sor-accent-choice");
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected).toHaveAttribute("title", "Text file");
    searchFor("Invoice");
    fireEvent.click(choices().getByRole("button", { name: "Invoice" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("invoice");
    expect(screen.queryByLabelText("Search document icons")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("disables search and selection in an already open inline picker", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DocumentIconPicker value="file-text" onChange={onChange} />,
    );
    openPicker();
    searchFor("Invoice");
    rerender(
      <DocumentIconPicker value="file-text" onChange={onChange} disabled />,
    );
    const search = screen.getByLabelText("Search document icons");
    const invoice = choices().getByRole("button", { name: "Invoice" });
    expect(search).toBeDisabled();
    expect(invoice).toBeDisabled();
    fireEvent.change(search, { target: { value: "server" } });
    fireEvent.click(invoice);
    expect(search).toHaveValue("Invoice");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DocumentIconPicker compact variant", () => {
  it("opens a named app modal, focuses search, and marks the selected vector icon", async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const trigger = openPicker();
    expect(trigger).toHaveAccessibleName("Document icon: Text file");
    expect(trigger).toHaveTextContent("");
    expect(trigger).toHaveClass("sor-btn", "sor-btn-secondary");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.querySelector("svg")).not.toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Choose document icon" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("sor-modal-panel", "max-w-md");
    expect(
      within(dialog).getByText("Choose document icon"),
    ).toBeInTheDocument();
    const search = screen.getByLabelText("Search document icons");
    expect(
      document.getElementById(trigger.getAttribute("aria-controls")!),
    ).toContainElement(search);
    await waitFor(() => expect(search).toHaveFocus());
    searchFor("Text file");
    const selected = choices().getByRole("button", { name: "Text file" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected.querySelector("svg.lucide-check")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("searches labels, keys, and keywords across categories, changes the value, and returns focus", async () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const trigger = openPicker();
    searchFor("server");
    expect(choices().getAllByRole("button").length).toBeGreaterThan(0);
    searchFor("file-text");
    expect(
      choices().getByRole("button", { name: "Text file" }),
    ).toBeInTheDocument();
    searchFor("  BiLLing  ");
    const invoice = choices().getByRole("button", { name: "Invoice" });
    expect(invoice).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(invoice);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("invoice");
    expect(trigger).toHaveAccessibleName("Document icon: Invoice");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Search document icons")).toHaveValue("");
    searchFor("Invoice");
    expect(choices().getByRole("button", { name: "Invoice" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("bounds broad searches to 60 results and recovers from an empty search", () => {
    render(<ControlledPicker />);
    openPicker();
    searchFor("a");
    expect(choices().getAllByRole("button")).toHaveLength(60);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 60 of");
    expect(screen.getByRole("status")).toHaveTextContent("Refine your search");
    searchFor("no-such-document-icon-xyz");
    expect(choices().queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("No matching icons.");
    searchFor("Invoice");
    expect(
      choices().getByRole("button", { name: "Invoice" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("matching icons.");
  });

  it("uses live runtime catalog labels and imported vectors", () => {
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    openPicker();
    const key = "custom:12345678-1234-4123-8123-123456789abc";
    act(() => {
      publishIconLibrary(
        {
          ...EMPTY_ICON_LIBRARY,
          builtInOverrides: {
            "file-text": { label: "Runbook", notes: "" },
          },
          customIcons: [
            {
              key,
              label: "Handover symbol",
              notes: "",
              svg: {
                tag: "svg",
                attrs: { viewBox: "0 0 24 24" },
                children: [
                  { tag: "path", attrs: { d: "M2 2L22 22" }, children: [] },
                ],
              },
            },
          ],
        },
        { ready: true },
      );
    });
    expect(getIconLibrarySnapshot().error).toBeNull();
    expect(
      screen.getByRole("button", { name: "Document icon: Runbook" }),
    ).toBeInTheDocument();
    searchFor("Handover symbol");
    const imported = choices().getByRole("button", { name: "Handover symbol" });
    expect(imported.querySelector("svg path")).not.toBeNull();
    fireEvent.click(imported);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(key);
  });

  it.each(["Close", "Escape", "backdrop"])(
    "closes via %s without changing the icon and restores trigger focus",
    async (method) => {
      const onChange = vi.fn();
      render(<ControlledPicker onChange={onChange} />);
      const trigger = openPicker();
      await waitFor(() =>
        expect(screen.getByLabelText("Search document icons")).toHaveFocus(),
      );
      if (method === "Close")
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
      else if (method === "Escape")
        fireEvent.keyDown(document, { key: "Escape" });
      else fireEvent.click(screen.getByRole("dialog").parentElement!);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );

  it("keeps keyboard focus inside the modal", async () => {
    render(<ControlledPicker />);
    openPicker();
    await waitFor(() =>
      expect(screen.getByLabelText("Search document icons")).toHaveFocus(),
    );
    const close = screen.getByRole("button", { name: "Close" });
    const icons = choices().getAllByRole("button");
    const last = icons[icons.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("cannot open while disabled and closes permanently when access is revoked", async () => {
    const onChange = vi.fn();
    const content = (disabled: boolean) => (
      <DocumentIconPicker
        variant="compact"
        value="file-text"
        onChange={onChange}
        disabled={disabled}
      />
    );
    const { rerender } = render(content(true));
    const trigger = screen.getByRole("button", {
      name: "Document icon: Text file",
    });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(content(false));
    openPicker();
    await waitFor(() =>
      expect(screen.getByLabelText("Search document icons")).toHaveFocus(),
    );
    searchFor("Invoice");
    const invoice = choices().getByRole("button", { name: "Invoice" });
    const focus = vi.spyOn(trigger, "focus");
    rerender(content(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(invoice);
    await nextFrame();
    expect(focus).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    rerender(content(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    openPicker();
    expect(screen.getByLabelText("Search document icons")).toHaveValue("");
  });

  it("does not restore focus when selecting an icon revokes access", async () => {
    function RevokeAfterSelection() {
      const [disabled, setDisabled] = useState(false);
      return (
        <DocumentIconPicker
          variant="compact"
          value="file-text"
          disabled={disabled}
          onChange={() => setDisabled(true)}
        />
      );
    }
    render(<RevokeAfterSelection />);
    const trigger = openPicker();
    const focus = vi.spyOn(trigger, "focus");
    searchFor("Invoice");
    fireEvent.click(choices().getByRole("button", { name: "Invoice" }));
    await nextFrame();
    expect(trigger).toBeDisabled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(focus).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "does not focus a detached trigger on owner replacement (close pending: %s)",
    async (closePending) => {
      const onChange = vi.fn();
      const { rerender } = render(
        <DocumentIconPicker
          key="document-a"
          variant="compact"
          value="file-text"
          onChange={onChange}
        />,
      );
      const trigger = openPicker();
      await waitFor(() =>
        expect(screen.getByLabelText("Search document icons")).toHaveFocus(),
      );
      searchFor("Invoice");
      const focus = vi.spyOn(trigger, "focus");
      if (closePending)
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
      rerender(
        <DocumentIconPicker
          key="document-b"
          variant="compact"
          value="invoice"
          onChange={onChange}
        />,
      );
      await nextFrame();
      expect(trigger.isConnected).toBe(false);
      expect(focus).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      openPicker();
      expect(screen.getByLabelText("Search document icons")).toHaveValue("");
    },
  );

  it("falls back to the text-file preview for an unavailable icon", () => {
    render(
      <DocumentIconPicker
        variant="compact"
        value="missing-icon"
        onChange={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Document icon: Text file" })
        .querySelector("svg"),
    ).not.toBeNull();
  });
});
