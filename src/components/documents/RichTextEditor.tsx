"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Node, type Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import {
  Type,
  Table2,
  Paperclip,
  KeyRound,
  Mail,
  FileText,
  Code,
  StickyNote,
  GitBranch,
  Wifi,
  IdCard,
  AtSign,
  Link,
  UserRound,
} from "lucide-react";
import type {
  DocumentBlock,
  DocumentReference,
  DocumentRichTextNode,
} from "../../types/documents/document";
import type { RichTextBlockInsertion } from "../../utils/documents/documentInlineInsert";
import { validateDocumentReference } from "../../utils/documents/validation";
import {
  fromEditorContent,
  safeDocumentLink,
  toEditorContent,
} from "./richTextAdapter";
import styles from "./documents.module.css";
import writing from "./richTextWriting.module.css";
import { scrollElementWithinContainer } from "../connection/editor/scrollWithinContainer";

export interface RichTextEditorProps {
  content: DocumentRichTextNode;
  onChange: (value: DocumentRichTextNode) => void;
  documentKey: string;
  readOnly?: boolean;
  onReference?: (reference: DocumentReference) => void;
  onChooseReference?: () => Promise<DocumentReference | null>;
  presentation?: "full" | "inline";
  insertableBlocks?: readonly DocumentBlock["type"][];
  onInsertBlock?: (
    request: RichTextBlockInsertion,
  ) => boolean | Promise<boolean>;
}

const INSERTIONS = [
  {
    type: "rich-text",
    label: "Rich text",
    keywords: "paragraph prose writing",
    icon: FileText,
  },
  {
    type: "markdown",
    label: "Markdown",
    keywords: "md source text",
    icon: Code,
  },
  { type: "note", label: "Note", keywords: "memo callout", icon: StickyNote },
  {
    type: "spreadsheet",
    label: "Spreadsheet",
    keywords: "table rows columns workbook cells",
    icon: Table2,
  },
  {
    type: "mermaid",
    label: "Diagram",
    keywords: "mermaid flowchart graph",
    icon: GitBranch,
  },
  {
    type: "wifi",
    label: "Wi-Fi",
    keywords: "network ssid password",
    icon: Wifi,
  },
  {
    type: "secret",
    label: "Secret",
    keywords: "password token key",
    icon: KeyRound,
  },
  {
    type: "credential",
    label: "Credential",
    keywords: "login username password",
    icon: UserRound,
  },
  {
    type: "email-account",
    label: "Email account",
    keywords: "mailbox imap smtp",
    icon: Mail,
  },
  {
    type: "identity",
    label: "Personal identity",
    keywords: "id passport document",
    icon: IdCard,
  },
  {
    type: "email",
    label: "Email address",
    keywords: "contact mail",
    icon: AtSign,
  },
  {
    type: "attachment",
    label: "Attachment",
    keywords: "image photo picture file pdf upload",
    icon: Paperclip,
  },
  {
    type: "reference",
    label: "Reference",
    keywords: "link document connection person ticket cell",
    icon: Link,
  },
] as const satisfies readonly {
  type: DocumentBlock["type"];
  label: string;
  keywords: string;
  icon: typeof Type;
}[];

/** A slash must start a top-level paragraph. Leaf nodes cannot masquerade as text. */
function slashAtCaret(editor: Editor) {
  const { selection } = editor.state;
  const { $from } = selection;
  if (
    !selection.empty ||
    $from.depth !== 1 ||
    $from.parent.type.name !== "paragraph" ||
    $from.parentOffset > 65 ||
    editor.isActive("code")
  )
    return null;
  const prefix = $from.parent.textBetween(
    0,
    $from.parentOffset,
    "\n",
    "\ufffc",
  );
  if (!/^\/[\p{L}\p{N} -]{0,64}$/u.test(prefix)) return null;
  let code = false;
  $from.parent.nodesBetween(0, $from.parentOffset, (node) => {
    if (node.marks.some((mark) => mark.type.name === "code")) code = true;
  });
  return code
    ? null
    : {
        query: prefix.slice(1).toLowerCase().trim(),
        from: $from.before(1),
        to: selection.from,
      };
}

/** Split by model positions so marks, references and text to the right survive. */
function insertionAtCaret(
  editor: Editor,
  type: DocumentBlock["type"],
): RichTextBlockInsertion {
  const slash = slashAtCaret(editor);
  if (!slash) throw Error("The insertion position changed.");
  const {
    doc,
    selection: { $from },
  } = editor.state;
  const left = doc.content.cut(0, slash.from);
  const trailing = doc.content.cut(slash.from + $from.parent.nodeSize);
  const rightParagraph = $from.parent.content.cut($from.parentOffset);
  const right = rightParagraph.size
    ? Fragment.from($from.parent.copy(rightParagraph)).append(trailing)
    : trailing;
  const portable = (fragment: Fragment) =>
    fragment.childCount
      ? fromEditorContent({ type: "doc", content: fragment.toJSON() })
      : null;
  return {
    type,
    original: fromEditorContent(doc.toJSON()),
    before: portable(left),
    after: portable(right),
  };
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
  const accessEpoch = useRef(0);
  if (latest.current.readOnly !== props.readOnly) accessEpoch.current++;
  latest.current = props;
  const alive = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const formatId = useId();
  const menuEpoch = useRef(0);
  const menuState = useRef<{
    doc: ProseMirrorNode;
    from: number;
    to: number;
  } | null>(null);
  const composing = useRef(false);
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const [focused, setFocused] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [insertNotice, setInsertNotice] = useState("");
  const pending = useRef<{
    doc: ProseMirrorNode;
    from: number;
    to: number;
    cancelled: boolean;
  } | null>(null);
  const cancelInsertion = () => {
    if (pending.current && !pending.current.cancelled) {
      pending.current.cancelled = true;
      if (alive.current)
        setInsertNotice("Insertion canceled; waiting for the picker to close.");
    }
  };
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
      handleKeyDown: (_view, event) => keyHandler.current(event),
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
        compositionstart: () => {
          composing.current = true;
          setIsComposing(true);
          cancelInsertion();
          return false;
        },
        compositionend: () => {
          composing.current = false;
          setIsComposing(false);
          return false;
        },
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
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onTransaction({ editor: current }) {
      const next = {
        doc: current.state.doc,
        from: current.state.selection.from,
        to: current.state.selection.to,
      };
      const previous = menuState.current;
      menuState.current = next;
      if (
        !previous ||
        previous.doc !== next.doc ||
        previous.from !== next.from ||
        previous.to !== next.to
      ) {
        menuEpoch.current++;
        const pick = pending.current;
        if (
          pick &&
          (pick.doc !== current.state.doc ||
            pick.from !== current.state.selection.from ||
            pick.to !== current.state.selection.to)
        )
          cancelInsertion();
      }
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
      if (pending.current) pending.current.cancelled = true;
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
            selectionTo: current.state.selection.to,
            doc: current.state.doc,
            marks: current.state.storedMarks,
          }
        : null,
  });
  const candidate =
    editor && focused && !props.readOnly && !isComposing && props.onInsertBlock
      ? slashAtCaret(editor)
      : null;
  const menuKey = candidate
    ? `${menuEpoch.current}:${candidate.from}:${candidate.to}:${candidate.query}`
    : "";
  const query = candidate?.query;
  const choices = useMemo(
    () =>
      query !== undefined
        ? INSERTIONS.filter(
            (choice) =>
              (!props.insertableBlocks ||
                props.insertableBlocks.includes(choice.type)) &&
              query
                .split(/\s+/)
                .every((word) =>
                  `${choice.label} ${choice.type} ${choice.keywords}`
                    .toLowerCase()
                    .includes(word),
                ),
          )
        : [],
    [query, props.insertableBlocks],
  );
  const showMenu =
    !!candidate &&
    menuKey !== dismissed &&
    !pending.current &&
    (!props.insertableBlocks || props.insertableBlocks.length > 0);
  const selected = Math.min(
    highlight.key === menuKey ? highlight.index : 0,
    Math.max(0, choices.length - 1),
  );

  const pickBlock = async (
    type: DocumentBlock["type"],
    expectedKey: string,
  ) => {
    if (
      !editor ||
      pending.current ||
      !alive.current ||
      latest.current.readOnly ||
      !latest.current.onInsertBlock ||
      composing.current ||
      editor.view.composing ||
      expectedKey !== menuKey ||
      !showMenu ||
      (latest.current.insertableBlocks &&
        !latest.current.insertableBlocks.includes(type))
    )
      return;
    const live = slashAtCaret(editor);
    if (
      !live ||
      `${menuEpoch.current}:${live.from}:${live.to}:${live.query}` !==
        expectedKey
    )
      return;
    const captured = editor;
    const epoch = accessEpoch.current;
    const ticket = {
      doc: editor.state.doc,
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      cancelled: false,
    };
    const key = props.documentKey;
    let request: RichTextBlockInsertion & { isCurrent: () => boolean };
    try {
      const split = insertionAtCaret(editor, type);
      const original = JSON.stringify(split.original);
      request = {
        ...split,
        isCurrent: () => {
          if (
            !alive.current ||
            ticket.cancelled ||
            pending.current !== ticket ||
            latest.current.readOnly ||
            accessEpoch.current !== epoch ||
            captured.isDestroyed ||
            latest.current.documentKey !== key ||
            composing.current ||
            captured.state.doc !== ticket.doc ||
            captured.state.selection.from !== ticket.from ||
            captured.state.selection.to !== ticket.to ||
            !slashAtCaret(captured) ||
            (latest.current.insertableBlocks &&
              !latest.current.insertableBlocks.includes(type))
          )
            return false;
          try {
            return (
              JSON.stringify(
                fromEditorContent(toEditorContent(latest.current.content)),
              ) === original
            );
          } catch {
            return false;
          }
        },
      };
    } catch {
      setError("This text could not be split safely. Your text is unchanged.");
      return;
    }
    pending.current = ticket;
    setInsertNotice(
      `Choosing ${INSERTIONS.find((choice) => choice.type === type)!.label.toLowerCase()}…`,
    );
    setError(null);
    try {
      // The parent alone commits the split, and must recheck isCurrent/original.
      // No editor transaction removes the slash, including on false/rejection.
      if (!request.isCurrent()) return;
      const accepted = await latest.current.onInsertBlock(request);
      if (accepted && request.isCurrent()) setDismissed(expectedKey);
    } catch {
      if (request.isCurrent())
        setError("The block could not be inserted. Your text is unchanged.");
    } finally {
      if (pending.current === ticket) {
        pending.current = null;
        if (alive.current) {
          setInsertNotice("");
          setDismissed(expectedKey);
        }
      }
    }
  };
  keyHandler.current = (event) => {
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      composing.current ||
      editor?.view.composing ||
      latest.current.readOnly ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return false;
    if (pending.current && ["Enter", "Escape"].includes(event.key)) {
      if (event.key === "Escape") cancelInsertion();
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (!showMenu) return false;
    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") setDismissed(menuKey);
      else if (event.key === "Enter") {
        if (choices[selected]) void pickBlock(choices[selected].type, menuKey);
      } else if (choices.length)
        setHighlight({
          key: menuKey,
          index:
            (selected + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
            choices.length,
        });
      return true;
    }
    return false;
  };
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    if (showMenu) {
      dom.setAttribute("aria-autocomplete", "list");
      dom.setAttribute("aria-controls", menuId);
      dom.setAttribute("aria-expanded", "true");
      if (choices[selected])
        dom.setAttribute(
          "aria-activedescendant",
          `${menuId}-${choices[selected].type}`,
        );
      else dom.removeAttribute("aria-activedescendant");
    } else {
      [
        "aria-autocomplete",
        "aria-controls",
        "aria-expanded",
        "aria-activedescendant",
      ].forEach((attribute) => dom.removeAttribute(attribute));
    }
  }, [editor, showMenu, menuId, choices, selected]);
  useEffect(() => {
    if (!editor || !showMenu) return;
    const reposition = () => {
      if (!root.current || editor.isDestroyed) return;
      try {
        const caret = editor.view.coordsAtPos(editor.state.selection.from);
        const bounds = root.current.getBoundingClientRect();
        const height =
          document.getElementById(menuId)?.getBoundingClientRect().height ||
          260;
        const next = {
          left: Math.max(
            0,
            Math.min(caret.left - bounds.left, bounds.width - 272),
          ),
          top:
            (window.innerHeight - caret.bottom < height + 8 &&
            caret.top > height
              ? caret.top - height - 4
              : caret.bottom + 4) - bounds.top,
        };
        setPosition((previous) =>
          previous.left === next.left && previous.top === next.top
            ? previous
            : next,
        );
      } catch {
        /* Layout may be unavailable while mounting; use the surface origin. */
      }
    };
    reposition();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [editor, showMenu, menuKey, menuId]);
  useEffect(() => {
    if (!showMenu || !choices[selected]) return;
    const container = document.getElementById(menuId);
    const option = document.getElementById(
      `${menuId}-${choices[selected].type}`,
    );
    if (container && option)
      scrollElementWithinContainer(container, option, {
        axis: "vertical",
        padding: 4,
      });
  }, [showMenu, menuId, choices, selected]);
  const inline = props.presentation === "inline";
  const showFormatting = !props.readOnly && (!inline || formatOpen);
  const command = (label: string, run: () => void, active = false) => (
    <button
      key={label}
      type="button"
      className="sor-btn sor-btn-secondary"
      aria-label={label}
      aria-pressed={active}
      disabled={!editor || props.readOnly}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (alive.current && !latest.current.readOnly) run();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={root}
      className={`${styles.rich} ${writing.surface} ${inline ? writing.inline : ""}`}
      data-readonly={props.readOnly || undefined}
    >
      {inline && !props.readOnly && (
        <button
          type="button"
          className={`sor-icon-btn ${writing.formatToggle}`}
          aria-label={
            formatOpen ? "Hide text formatting" : "Show text formatting"
          }
          aria-expanded={formatOpen}
          aria-controls={formatId}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setFormatOpen(!formatOpen)}
        >
          <Type size={14} aria-hidden="true" />
        </button>
      )}
      <div id={formatId} className={inline ? writing.formatPanel : undefined}>
        {showFormatting && (
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
        {showFormatting && (
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
      </div>
      {error && <p role="alert">{error}</p>}
      {insertNotice && (
        <p role="status" className={writing.notice}>
          {insertNotice}
        </p>
      )}
      <EditorContent
        editor={editor}
        className={inline ? writing.prose : undefined}
        data-empty={!props.readOnly && editor?.isEmpty ? true : undefined}
        data-placeholder={
          props.onInsertBlock
            ? "Write, use Markdown, or / to insert"
            : "Write here…"
        }
      />
      {showMenu && (
        <div className={writing.menu} style={position}>
          <div className={writing.menuHeading}>
            Insert block <span>↑↓ · Enter · Esc</span>
          </div>
          <div
            id={menuId}
            role="listbox"
            aria-label="Insert document block"
            className={writing.options}
          >
            {choices.map((choice, index) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                id={`${menuId}-${choice.type}`}
                key={choice.type}
                aria-selected={index === selected}
                className={writing.option}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight({ key: menuKey, index })}
                onClick={() => void pickBlock(choice.type, menuKey)}
              >
                <choice.icon size={15} aria-hidden="true" />
                {choice.label}
              </button>
            ))}
          </div>
          {choices.length === 0 && (
            <p role="status" className={writing.noMatches}>
              No matching enabled blocks
            </p>
          )}
        </div>
      )}
      {!props.readOnly && !inline && (
        <p className={styles.help}>
          Paste inserts plain text. HTML, images, event attributes and
          unsupported URLs are not accepted. Links are stored as text
          formatting, not opened automatically.
        </p>
      )}
    </div>
  );
}
