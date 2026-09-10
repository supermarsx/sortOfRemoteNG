import type {
  DatabaseDocument,
  DocumentRichTextNode,
} from "../../types/documents/document";

const masked = "[REDACTED]";
function richText(node: DocumentRichTextNode): string {
  if (node.type === "reference")
    return `[${node.reference?.kind ?? "record"} link]`;
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "horizontalRule") return "\n---\n";
  const content = (node.content ?? []).map(richText).join("");
  return (
    content +
    (["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(
      node.type,
    )
      ? "\n"
      : "")
  );
}

/** Deliberately inert text, not HTML; secrets require a separate explicit opt-in. */
export function documentTextExport(
  document: DatabaseDocument,
  includeSensitive = false,
): string {
  const secret = (value: string) => (includeSensitive ? value : masked);
  const parts = document.blocks.map((block): string => {
    switch (block.type) {
      case "rich-text":
        return richText(block.content);
      case "note":
      case "markdown":
        return block.text;
      case "mermaid":
        return `Diagram source:\n\n${block.text}`;
      case "secret":
        return `${block.label}: ${secret(block.value)}`;
      case "credential":
        return `${block.label}\nUsername: ${secret(block.username)}\nPassword: ${secret(block.password)}\nWebsite: ${secret(block.url)}\nNotes: ${secret(block.notes)}`;
      case "wifi":
        return `Wi-Fi: ${secret(block.ssid)}\nAuthentication: ${block.authentication}\nPassword: ${secret(block.password)}`;
      case "email-account":
        return `Email account: ${secret(block.address)}\nUsername: ${secret(block.username)}\nPassword: ${secret(block.password)}`;
      case "identity":
        return `Personal identity: ${secret(block.documentType)}\nHolder: ${secret(block.holderName)}\nIdentifier: ${secret(block.idNumber)}\nCountry: ${secret(block.country)}\nIssued: ${secret(block.issueDate)}\nExpires: ${secret(block.expiryDate)}\nAttachments omitted.`;
      case "email":
        return `${block.label}: ${block.address}`;
      case "attachment":
        return `Attachment: ${block.caption || "unnamed"} (file content omitted)`;
      case "reference":
        return `[${block.reference.kind} link${block.reference.kind === "cell" ? ` ${block.reference.address}` : ""}]`;
      case "spreadsheet":
        return block.workbook.sheets
          .map((sheet) => {
            const cells = Object.entries(sheet.cells);
            return `Spreadsheet: ${sheet.name}\n${cells
              .slice(0, 500)
              .map(
                ([address, cell]) =>
                  `${address}: ${cell.formula ?? cell.value ?? ""}`,
              )
              .join(
                "\n",
              )}${cells.length > 500 ? "\nRemaining cells omitted; use spreadsheet export for all cells." : ""}`;
          })
          .join("\n\n");
    }
  });
  return `# ${document.name}\n\n${includeSensitive ? "Sensitive fields included. Protect this copy." : "Structured secret and identity fields are redacted. Ordinary text and spreadsheet cells may still contain private information."}\n\n${parts.join("\n\n---\n\n")}\n`;
}

export function documentPrintHtml(text: string): string {
  const escaped = text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Document print</title><style>body{font:12pt system-ui;color:#111;background:white;margin:20mm}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}@page{margin:12mm}</style></head><body><pre>${escaped}</pre></body></html>`;
}

/** Returns immediate cleanup so owner lock/unmount can discard private print content. */
export function printDocumentText(
  text: string,
  onError: (message: string) => void,
): () => void {
  const frame = document.createElement("iframe");
  frame.title = "Document print preview";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText =
    "position:fixed;width:1px;height:1px;left:-10000px;border:0";
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    active = false;
    clearTimeout(timer);
    frame.remove();
  };
  frame.onload = () => {
    if (!active) return;
    try {
      const target = frame.contentWindow;
      if (!target) throw new Error("Print unavailable");
      target.addEventListener("afterprint", cleanup, { once: true });
      target.focus();
      target.print();
      if (active) timer = setTimeout(cleanup, 60_000);
    } catch {
      cleanup();
      onError(
        "The system print dialog could not open. Export the text to print it from another application.",
      );
    }
  };
  frame.srcdoc = documentPrintHtml(text);
  document.body.append(frame);
  return cleanup;
}
