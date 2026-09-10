"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type {
  DocumentReference,
  DocumentRichTextNode,
} from "../../types/documents/document";
import { validateDocumentReference } from "../../utils/documents/validation";
import {
  fromEditorContent,
  safeDocumentLink,
  toEditorContent,
} from "./richTextAdapter";
import styles from "./documents.module.css";

export interface RichTextEditorProps {
  content: DocumentRichTextNode;
  onChange: (value: DocumentRichTextNode) => void;
  documentKey: string;
  readOnly?: boolean;
  onReference?: (reference: DocumentReference) => void;
  onChooseReference?: () => Promise<DocumentReference | null>;
}
const ReferenceNode = Node.create({
  name: "reference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { reference: { default: null, rendered: false } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    const ref = node.attrs.reference as DocumentReference;
    return [
      "button",
      {
        type: "button",
        class: "document-reference",
        contenteditable: "false",
        "aria-label": `Open ${ref.kind} reference`,
        "data-document-reference": JSON.stringify(ref),
      },
      `${ref.kind}: ${ref.id}${ref.kind === "cell" ? ` · ${ref.address}` : ""}`,
    ];
  },
});
export default function RichTextEditor(props: RichTextEditorProps) {
  const prepared = useMemo(() => {
    try {
      return { content: toEditorContent(props.content), error: false };
    } catch {
      return { content: null, error: true };
    }
  }, [props.content]);
  if (prepared.error || !prepared.content)
    return (
      <p role="alert">
        This rich-text block is invalid or unsupported. Its original data has
        not been replaced.
      </p>
    );
  return <RichTextSurface key={props.documentKey} {...props} />;
}
function RichTextSurface(props: RichTextEditorProps) {
  const latest = useRef(props);
  latest.current = props;
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [picking, setPicking] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          isAllowedUri: (url) => safeDocumentLink(url),
        },
        trailingNode: false,
      }),
      ReferenceNode,
    ],
    content: toEditorContent(props.content),
    editable: !props.readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Rich document text",
        "aria-multiline": "true",
      },
      handlePaste(view, event) {
        if (latest.current.readOnly) return true;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (text.length > 128 * 1024) {
          setError("Pasted text exceeds the block limit.");
          return true;
        }
        view.dispatch(view.state.tr.insertText(text));
        return true;
      },
      handleDrop() {
        return true;
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const referenceButton = (event.target as HTMLElement).closest(
            "button[data-document-reference]",
          );
          if (referenceButton) {
            event.preventDefault();
            try {
              const raw =
                referenceButton.getAttribute("data-document-reference") ?? "";
              if (raw.length > 1024) throw new Error();
              const ref: unknown = JSON.parse(raw);
              validateDocumentReference(ref);
              latest.current.onReference?.(ref);
            } catch {
              setError("This reference is unavailable.");
            }
            return true;
          }
          if ((event.target as HTMLElement).closest("a")) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
    },
    onUpdate({ editor: current }) {
      if (!alive.current || latest.current.readOnly) return;
      try {
        const value = fromEditorContent(current.getJSON());
        setError(null);
        latest.current.onChange(value);
      } catch {
        setError(
          "Unsupported or oversized rich text was not accepted. Undo the last change.",
        );
      }
    },
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    editor?.setEditable(!props.readOnly);
  }, [editor, props.readOnly]);
  useEffect(() => {
    if (!editor) return;
    try {
      const json = toEditorContent(props.content);
      if (
        JSON.stringify(fromEditorContent(editor.getJSON())) !==
        JSON.stringify(props.content)
      )
        editor.commands.setContent(json, { emitUpdate: false });
    } catch {
      setError("Rich text could not be loaded safely.");
    }
  }, [editor, props.content]);
  useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            selection: current.state.selection.from,
            doc: current.state.doc,
            marks: current.state.storedMarks,
          }
        : null,
  });
  const command = (label: string, run: () => void, active = false) => (
    <button
      key={label}
      type="button"
      className="sor-btn sor-btn-secondary"
      aria-label={label}
      aria-pressed={active}
      disabled={!editor || props.readOnly}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );
  return (
    <div className={styles.rich}>
      {!props.readOnly && (
        <div
          role="toolbar"
          aria-label="Text formatting"
          className={styles.toolbar}
        >
          {command(
            "Bold",
            () => editor?.chain().focus().toggleBold().run(),
            editor?.isActive("bold"),
          )}
          {command(
            "Italic",
            () => editor?.chain().focus().toggleItalic().run(),
            editor?.isActive("italic"),
          )}
          {command(
            "Underline",
            () => editor?.chain().focus().toggleUnderline().run(),
            editor?.isActive("underline"),
          )}
          {command(
            "Strike",
            () => editor?.chain().focus().toggleStrike().run(),
            editor?.isActive("strike"),
          )}
          {command(
            "Inline code",
            () => editor?.chain().focus().toggleCode().run(),
            editor?.isActive("code"),
          )}
          {[1, 2, 3].map((level) =>
            command(
              `Heading ${level}`,
              () =>
                editor
                  ?.chain()
                  .focus()
                  .toggleHeading({ level: level as 1 | 2 | 3 })
                  .run(),
              editor?.isActive("heading", { level }),
            ),
          )}
          {command("Paragraph", () =>
            editor?.chain().focus().setParagraph().run(),
          )}
          {command(
            "Bullet list",
            () => editor?.chain().focus().toggleBulletList().run(),
            editor?.isActive("bulletList"),
          )}
          {command(
            "Numbered list",
            () => editor?.chain().focus().toggleOrderedList().run(),
            editor?.isActive("orderedList"),
          )}
          {command(
            "Quote",
            () => editor?.chain().focus().toggleBlockquote().run(),
            editor?.isActive("blockquote"),
          )}
          {command(
            "Code block",
            () => editor?.chain().focus().toggleCodeBlock().run(),
            editor?.isActive("codeBlock"),
          )}
          {command("Divider", () =>
            editor?.chain().focus().setHorizontalRule().run(),
          )}
          {command("Undo", () => editor?.chain().focus().undo().run())}
          {command("Redo", () => editor?.chain().focus().redo().run())}
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!editor || !props.onChooseReference || picking}
            onClick={async () => {
              if (!editor || !props.onChooseReference) return;
              const captured = editor;
              setPicking(true);
              try {
                const ref = await props.onChooseReference();
                if (
                  !alive.current ||
                  latest.current.readOnly ||
                  captured.isDestroyed
                )
                  return;
                if (ref) {
                  validateDocumentReference(ref);
                  captured
                    .chain()
                    .focus()
                    .insertContent({
                      type: "reference",
                      attrs: { reference: ref },
                    })
                    .run();
                }
              } catch {
                if (alive.current)
                  setError("A reference could not be selected.");
              } finally {
                if (alive.current) setPicking(false);
              }
            }}
          >
            Insert reference
          </button>
        </div>
      )}
      {!props.readOnly && (
        <div className={styles.toolbar}>
          <label>
            Link URL{" "}
            <input
              className="sor-form-input"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https:// or mailto:"
              maxLength={2048}
            />
          </label>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!editor || !safeDocumentLink(link)}
            onClick={() => {
              editor
                ?.chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: link })
                .run();
              setLink("");
            }}
          >
            Apply link
          </button>
          {command("Remove link", () =>
            editor?.chain().focus().unsetLink().run(),
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <EditorContent editor={editor} />
      {!props.readOnly && (
        <p className={styles.help}>
          Paste inserts plain text. HTML, images, event attributes and
          unsupported URLs are not accepted. Links are stored as text
          formatting, not opened automatically.
        </p>
      )}
    </div>
  );
}
