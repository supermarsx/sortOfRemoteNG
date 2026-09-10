import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import DocumentBlockEditor from "../../src/components/documents/DocumentBlockEditor";
import type {
  DocumentBlock,
  DocumentReference,
} from "../../src/types/documents/document";
const qr = vi.hoisted(() =>
  vi.fn().mockResolvedValue("data:image/png;base64,fixture"),
);
vi.mock("qrcode", () => ({ toDataURL: qr }));
const note: DocumentBlock = { id: "note", type: "note", text: "Before" };
function Harness({ initial = [note] }: { initial?: DocumentBlock[] }) {
  const [blocks, setBlocks] = React.useState(initial);
  return (
    <>
      <DocumentBlockEditor
        documentKey="db-a:1:doc"
        blocks={blocks}
        attachments={[]}
        onChange={setBlocks}
      />
      <output data-testid="blocks">{JSON.stringify(blocks)}</output>
    </>
  );
}
const blocks = () =>
  JSON.parse(screen.getByTestId("blocks").textContent!) as DocumentBlock[];
function choose(label: string) {
  fireEvent.click(screen.getByLabelText("Block type"));
  fireEvent.mouseDown(screen.getByRole("option", { name: label }));
  fireEvent.click(screen.getByRole("button", { name: "Add block" }));
}
describe("document block draft editor", () => {
  it("edits, reorders and confirms removal without deleting attachments", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "After" },
    });
    expect(blocks()[0]).toMatchObject({ text: "After" });
    choose("Credential");
    expect(blocks()).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "fixture-user" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "fixture-secret" },
    });
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByRole("button", { name: "Move block 2 up" }));
    expect(blocks()[0].type).toBe("credential");
    fireEvent.click(screen.getByRole("button", { name: "Remove block 1" }));
    expect(blocks()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Keep block" }));
    expect(blocks()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove block 1" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm remove block" }),
    );
    expect(blocks()).toEqual([{ ...note, text: "After" }]);
  });
  it("never generates or exposes a Wi-Fi QR before explicit reveal; change and remount hide it", async () => {
    qr.mockClear();
    const wifi: DocumentBlock = {
      id: "wifi",
      type: "wifi",
      ssid: "team;net",
      password: "fixture-secret",
      authentication: "WPA",
      hidden: false,
    };
    const { rerender } = render(
      <DocumentBlockEditor
        documentKey="a"
        blocks={[wifi]}
        attachments={[]}
        onChange={vi.fn()}
      />,
    );
    expect(qr).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal Wi-Fi QR" }));
    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(qr).toHaveBeenCalledWith(
      expect.stringContaining("S:team\\;net"),
      expect.anything(),
    );
    rerender(
      <DocumentBlockEditor
        documentKey="b"
        blocks={[wifi]}
        attachments={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Wi-Fi password")).toHaveAttribute(
      "type",
      "password",
    );
  });
  it("reports invalid drafts instead of inventing a valid email account", async () => {
    const validity = vi.fn();
    const email: DocumentBlock = {
      id: "email",
      type: "email-account",
      address: "",
      username: "",
      password: "",
      tls: true,
    };
    render(
      <DocumentBlockEditor
        documentKey="a"
        blocks={[email]}
        attachments={[]}
        onChange={vi.fn()}
        onValidityChange={validity}
      />,
    );
    expect(validity).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "incomplete or invalid",
    );
  });
  it("adds a typed picked reference and opens the exact target", async () => {
    const reference: DocumentReference = {
      databaseId: "db-a",
      kind: "cell",
      id: "doc2",
      blockId: "sheet",
      sheetId: "main",
      address: "B2",
    };
    const change = vi.fn(),
      open = vi.fn();
    const { rerender } = render(
      <DocumentBlockEditor
        documentKey="a"
        blocks={[]}
        attachments={[]}
        onChange={change}
        onChooseReference={async () => reference}
      />,
    );
    choose("Reference");
    await waitFor(() => expect(change).toHaveBeenCalledOnce());
    const next = change.mock.calls[0][0] as DocumentBlock[];
    expect(next[0]).toMatchObject({ type: "reference", reference });
    rerender(
      <DocumentBlockEditor
        documentKey="a"
        blocks={next}
        attachments={[]}
        onChange={change}
        onReference={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open reference" }));
    expect(open).toHaveBeenCalledWith(reference);
  });
  it("does not apply an old reference picker after document/owner changes", async () => {
    let complete!: (value: DocumentReference) => void;
    const change = vi.fn();
    const { rerender } = render(
      <DocumentBlockEditor
        documentKey="old-owner"
        blocks={[]}
        attachments={[]}
        onChange={change}
        onChooseReference={() =>
          new Promise((resolve) => {
            complete = resolve;
          })
        }
      />,
    );
    choose("Reference");
    rerender(
      <DocumentBlockEditor
        documentKey="new-owner"
        blocks={[]}
        attachments={[]}
        onChange={change}
      />,
    );
    await act(async () =>
      complete({ databaseId: "old-owner", kind: "document", id: "old" }),
    );
    expect(change).not.toHaveBeenCalled();
  });
  it("delegates spreadsheet editing and does not pretend JSON text is a grid", () => {
    const spreadsheet: DocumentBlock = {
      id: "sheet",
      type: "spreadsheet",
      workbook: {
        version: 1,
        styles: {},
        validations: {},
        sheets: [
          {
            id: "main",
            name: "Sheet 1",
            rows: 10,
            columns: 10,
            cells: {},
            merges: [],
            rowMetadata: {},
            columnMetadata: {},
          },
        ],
      },
    };
    const renderSheet = vi.fn(() => (
      <div role="grid" aria-label="Fixture spreadsheet" />
    ));
    render(
      <DocumentBlockEditor
        documentKey="a"
        blocks={[spreadsheet]}
        attachments={[]}
        onChange={vi.fn()}
        renderSpreadsheet={renderSheet}
      />,
    );
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(renderSheet).toHaveBeenCalledWith(
      spreadsheet,
      expect.any(Function),
      false,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("keeps read-only fields immutable while permitting an explicit secret reveal", () => {
    const secret: DocumentBlock = {
      id: "secret",
      type: "secret",
      label: "Fixture",
      value: "private",
    };
    const change = vi.fn();
    render(
      <DocumentBlockEditor
        documentKey="a"
        blocks={[secret]}
        attachments={[]}
        onChange={change}
        readOnly
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Add block" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Secret value")).toHaveAttribute("readonly");
    fireEvent.click(
      screen.getByRole("button", { name: "Reveal Secret value" }),
    );
    expect(screen.getByLabelText("Secret value")).toHaveAttribute(
      "type",
      "text",
    );
    expect(change).not.toHaveBeenCalled();
  });
  it("shows safe text rather than interpreting Markdown HTML", () => {
    render(
      <Harness
        initial={[
          {
            id: "md",
            type: "markdown",
            text: '<img src="https://evil.test" onerror="alert(1)">',
          },
        ]}
      />,
    );
    const section = screen.getByRole("region", { name: "Markdown block 1" });
    expect(within(section).queryByRole("img")).not.toBeInTheDocument();
    expect(section.querySelector("iframe,script,img")).toBeNull();
  });
});
