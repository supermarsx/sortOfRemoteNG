import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, FileText, Search } from "lucide-react";
import {
  getIconLibrarySnapshot,
  getRuntimeIconEntry,
  useIconLibraryRevision,
} from "../../utils/icons/iconLibraryRuntime";
import { Modal, ModalBody, ModalHeader } from "../ui/overlays/Modal";
import styles from "./documentIconPicker.module.css";

/** Document-focused selection from the existing passive vector catalog. */
export function DocumentIconPicker({
  value,
  onChange,
  disabled = false,
  variant = "default",
}: {
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  variant?: "default" | "compact";
}) {
  useIconLibraryRevision();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusReturnFrame = useRef<number | null>(null);
  const compact = variant === "compact";
  const expanded = open && (!compact || !disabled);
  const id = useId();
  const current = getRuntimeIconEntry(value);
  const Icon = current?.icon ?? FileText;
  const search = query.trim().toLowerCase();
  const entries = getIconLibrarySnapshot().entries.filter((entry) =>
    search
      ? [entry.label, entry.key, ...entry.keywords].some((text) =>
          text.toLowerCase().includes(search),
        )
      : entry.category === "files" || entry.category === "folders",
  );
  const visible = entries.slice(0, 60);

  useEffect(() => {
    if (compact && disabled) {
      setOpen(false);
      setQuery("");
    }
  }, [compact, disabled]);

  useEffect(
    () => () => {
      if (focusReturnFrame.current !== null)
        cancelAnimationFrame(focusReturnFrame.current);
    },
    [],
  );

  const close = () => {
    setOpen(false);
    if (!compact) return;
    if (focusReturnFrame.current !== null)
      cancelAnimationFrame(focusReturnFrame.current);
    // Wait for Modal's cleanup, then check the current DOM: the owning header
    // may have been removed or editing access revoked by onChange.
    focusReturnFrame.current = requestAnimationFrame(() => {
      focusReturnFrame.current = null;
      const trigger = triggerRef.current;
      if (
        trigger?.isConnected &&
        !trigger.matches(":disabled") &&
        trigger.getAttribute("aria-expanded") === "false"
      )
        trigger.focus({ preventScroll: true });
    });
  };

  const picker = (
    <div
      id={id}
      className={
        compact
          ? styles.picker
          : "mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3"
      }
    >
      {compact && (
        <div className={styles.current}>
          <span className={styles.currentIcon}>
            <Icon size={20} aria-hidden="true" />
          </span>
          <span>
            <span className={styles.currentCaption}>Current icon</span>
            <span className={styles.currentLabel}>
              {current?.label ?? "Text file"}
            </span>
          </span>
        </div>
      )}
      <label
        className="mb-2 flex items-center gap-2 text-xs text-[var(--color-textSecondary)]"
        htmlFor={`${id}-search`}
      >
        <Search size={14} aria-hidden="true" /> Search document icons
      </label>
      <input
        ref={searchRef}
        id={`${id}-search`}
        className="sor-form-input w-full"
        value={query}
        disabled={disabled}
        onChange={(event) => {
          if (!disabled) setQuery(event.target.value);
        }}
        placeholder="Search the icon library…"
        autoComplete="off"
        aria-describedby={`${id}-status`}
      />
      <div
        className={
          compact
            ? styles.grid
            : "mt-3 grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1"
        }
        role="group"
        aria-label="Document icons"
      >
        {visible.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`sor-icon-btn sor-accent-choice ${compact ? styles.choice : "relative h-10 w-10"}`}
            aria-label={entry.label}
            aria-pressed={entry.key === value}
            title={entry.label}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              close();
              onChange(entry.key);
            }}
          >
            <entry.icon size={20} aria-hidden="true" />
            {entry.key === value && (
              <Check
                size={10}
                className={compact ? styles.check : "absolute right-0 top-0"}
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>
      <p
        id={`${id}-status`}
        className={
          compact
            ? `${styles.status} ${entries.length === 0 ? styles.empty : ""}`
            : "mt-2 text-xs text-[var(--color-textSecondary)]"
        }
        role="status"
      >
        {entries.length === 0
          ? compact
            ? "No matching icons. Try another name or keyword."
            : "No matching icons."
          : entries.length > visible.length
            ? `Showing ${visible.length} of ${entries.length} icons. Refine your search for more.`
            : search
              ? `${entries.length} matching icons.`
              : "File and folder icons. Search to browse all categories."}
      </p>
    </div>
  );

  return (
    <div className={compact ? styles.root : "min-w-0"}>
      <button
        ref={triggerRef}
        type="button"
        className={`sor-btn sor-btn-secondary${compact ? ` ${styles.trigger}` : ""}`}
        aria-label={`Document icon: ${current?.label ?? "Text file"}`}
        aria-expanded={expanded}
        aria-controls={id}
        aria-haspopup={compact ? "dialog" : undefined}
        title="Choose document icon"
        disabled={disabled}
        onClick={(event) => {
          if (disabled) return;
          if (compact) {
            if (focusReturnFrame.current !== null) {
              cancelAnimationFrame(focusReturnFrame.current);
              focusReturnFrame.current = null;
            }
            // Modal restores the element focused at open without checking it.
            // Release this trigger so only our guarded close path restores it.
            event.currentTarget.blur();
            setQuery("");
          }
          setOpen(!open);
        }}
      >
        <Icon size={18} aria-hidden="true" />
        {!compact && <span>Choose icon</span>}
        <ChevronDown
          size={compact ? 10 : 14}
          className={compact ? styles.chevron : undefined}
          aria-hidden="true"
        />
      </button>
      {compact ? (
        <Modal
          isOpen={expanded}
          onClose={close}
          ariaLabel="Choose document icon"
          initialFocusRef={searchRef}
          panelClassName="max-w-md mx-4"
        >
          <ModalHeader title="Choose document icon" onClose={close} />
          <ModalBody className={styles.body}>{picker}</ModalBody>
        </Modal>
      ) : (
        open && picker
      )}
    </div>
  );
}
