import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import AttachmentPreview from "../../src/components/documents/AttachmentPreview";
import MermaidBlock from "../../src/components/documents/MermaidBlock";
import {
  sanitizeDiagramSvg,
  validateDiagramSource,
} from "../../src/components/documents/diagramSafety";
import { createDocumentAttachment } from "../../src/utils/documents/documentAttachments";
import type { DocumentAttachment } from "../../src/types/documents/document";
const fixture = vi.hoisted(() => ({
  render: vi.fn(),
  initialize: vi.fn(),
  getDocument: vi.fn(),
  createWorker: vi.fn(),
  destroy: vi.fn(),
  cancel: vi.fn(),
  renderPage: vi.fn(),
}));
vi.mock("mermaid", () => ({
  default: { initialize: fixture.initialize, render: fixture.render },
}));
vi.mock("pdfjs-dist", () => ({
  PDFWorker: { create: fixture.createWorker },
  getDocument: fixture.getDocument,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("safe diagram preview", () => {
  it.each([
    "flowchart LR\n A-->B",
    "sequenceDiagram\n Alice->>Bob: Hello",
    "erDiagram\n USER ||--o{ ITEM : owns",
  ])("accepts bounded local syntax %s", (source) =>
    expect(() => validateDiagramSource(source)).not.toThrow(),
  );
  it.each([
    "%%{init:{securityLevel:'loose'}}%%\nflowchart LR\n A-->B",
    'flowchart LR\n click A href "https://evil.test"',
    "flowchart LR\n A[<img src=x>]",
    'flowchart LR\n A@{img: "//evil.test"}',
    "flowchart LR\n style A fill:url(//evil.test)",
    "flowchart LR\n" + "a".repeat(32768),
  ])("refuses active or unbounded diagram source", (source) =>
    expect(() => validateDiagramSource(source)).toThrow(),
  );
  it("sanitizes SVG scripts, HTML, style URLs, remote image/link/actions while retaining geometry", async () => {
    const result = await sanitizeDiagramSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><image href="https://evil.test"/><a href="javascript:alert(1)"><text>link</text></a><style>svg{background:url(https://evil.test)}</style><path d="M0 0 L10 10" onload="alert(1)" fill="url(https://evil.test)"/><marker id="arrow"/><path marker-end="url(#arrow)"/></svg>',
    );
    const doc = new DOMParser().parseFromString(result, "image/svg+xml");
    expect(doc.querySelector("script,foreignObject,image,a,style")).toBeNull();
    expect(result).not.toContain("evil.test");
    expect(result).not.toContain("onload");
    expect(doc.querySelector("path")?.getAttribute("d")).toBe("M0 0 L10 10");
    expect(result).toContain("url(#arrow)");
  });
  it("does not render on mount and drops stale preview after source change", async () => {
    let finish!: (value: { svg: string }) => void;
    fixture.render.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender, unmount } = render(
      <MermaidBlock source="flowchart LR\n A-->B" />,
    );
    expect(fixture.render).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview diagram" }));
    await waitFor(() => expect(fixture.render).toHaveBeenCalledOnce());
    expect(fixture.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        htmlLabels: false,
        startOnLoad: false,
      }),
    );
    rerender(<MermaidBlock source="flowchart LR\n C-->D" />);
    await act(async () =>
      finish({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Old secret label</text></svg>',
      }),
    );
    expect(screen.queryByText("Old secret label")).not.toBeInTheDocument();
    unmount();
    expect(
      document.querySelector('[aria-hidden="true"][style*="100000"]'),
    ).toBeNull();
  });
});
describe("attachment previews", () => {
  it("validates and displays text as text, never active HTML", async () => {
    const attachment = await createDocumentAttachment(
      new TextEncoder().encode('<img src="https://evil.test">'),
      "note.txt",
      "text/plain",
    );
    render(<AttachmentPreview attachment={attachment} />);
    expect(
      screen.queryByText('<img src="https://evil.test">'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview attachment" }));
    expect(
      await screen.findByText('<img src="https://evil.test">'),
    ).toBeInTheDocument();
    expect(document.querySelector("iframe,object,embed,img")).toBeNull();
  });
  it("creates image Blob URLs only after validation and revokes them on close", async () => {
    const create = vi.fn(() => "blob:fixture"),
      revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const attachment = await createDocumentAttachment(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "fixture.png",
      "image/png",
    );
    const { unmount } = render(<AttachmentPreview attachment={attachment} />);
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview attachment" }));
    expect(await screen.findByRole("img")).toHaveAttribute(
      "src",
      "blob:fixture",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close attachment preview" }),
    );
    expect(revoke).toHaveBeenCalledWith("blob:fixture");
    unmount();
  });
  it("refuses MIME spoofing and corrupted attachment hashes before rendering", async () => {
    const attachment = await createDocumentAttachment(
      new TextEncoder().encode("fixture"),
      "fixture.txt",
      "text/plain",
    );
    const { rerender } = render(
      <AttachmentPreview
        attachment={{
          ...attachment,
          mimeType: "image/svg+xml" as DocumentAttachment["mimeType"],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview attachment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "validation failed",
    );
    rerender(
      <AttachmentPreview
        attachment={{ ...attachment, sha256: "0".repeat(64) }}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "validation failed",
    );
    expect(document.querySelector("iframe,object,embed,img")).toBeNull();
  });
  it("uses a local worker and canvas-only PDF with external-resource factories disabled; tears down", async () => {
    const terminate = vi.fn();
    class FakeWorker {
      terminate = terminate;
    }
    vi.stubGlobal("Worker", FakeWorker);
    fixture.createWorker.mockReturnValue({ destroy: fixture.destroy });
    fixture.renderPage.mockReturnValue({
      promise: Promise.resolve(),
      cancel: fixture.cancel,
    });
    const loadingDestroy = vi.fn().mockResolvedValue(undefined),
      page = {
        getViewport: ({ scale }: { scale: number }) => ({
          width: 400 * scale,
          height: 600 * scale,
        }),
        render: fixture.renderPage,
        cleanup: vi.fn(),
      };
    fixture.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn().mockResolvedValue(page),
      }),
      destroy: loadingDestroy,
    });
    const attachment = await createDocumentAttachment(
      new TextEncoder().encode("%PDF-1.7\nfixture"),
      "fixture.pdf",
      "application/pdf",
    );
    const { unmount } = render(<AttachmentPreview attachment={attachment} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview attachment" }));
    await waitFor(() => expect(fixture.renderPage).toHaveBeenCalled());
    const options = fixture.getDocument.mock.calls.slice(-1)[0][0];
    expect(options).toMatchObject({
      useWorkerFetch: false,
      useWasm: false,
      enableXfa: false,
      disableFontFace: true,
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
    });
    expect(options.url).toBeUndefined();
    await expect(new options.BinaryDataFactory().fetch()).rejects.toThrow(
      "External PDF resources",
    );
    expect(fixture.renderPage).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationMode: 0,
        canvas: expect.any(HTMLCanvasElement),
      }),
    );
    expect(document.querySelector("iframe,embed,object,a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next PDF page" }));
    await screen.findByText("Page 2 of 2");
    unmount();
    expect(loadingDestroy).toHaveBeenCalled();
    expect(fixture.cancel).toHaveBeenCalled();
    expect(terminate).toHaveBeenCalled();
  });
});
