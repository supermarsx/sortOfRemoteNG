import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Redo2, Undo2 } from "lucide-react";
import { scrollElementWithinContainer } from "../connection/editor/scrollWithinContainer";
import styles from "./documentEditorHeader.module.css";

export interface DocumentHistoryControlsProps {
  undo: string[];
  redo: string[];
  disabled: boolean;
  notice?: string;
  onStep: (direction: "undo" | "redo", count: number) => void;
}

export default function DocumentHistoryControls(
  props: DocumentHistoryControlsProps,
) {
  const [open, setOpen] = useState<"undo" | "redo" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (props.disabled) setOpen(null);
  }, [props.disabled]);
  return (
    <div
      ref={root}
      className={styles.history}
      role="group"
      aria-label="Document edit history"
    >
      {(["undo", "redo"] as const).map((direction) => {
        const label = direction === "undo" ? "Undo" : "Redo";
        const Icon = direction === "undo" ? Undo2 : Redo2;
        const steps = props[direction];
        const unavailable = props.disabled || !steps.length;
        return (
          <div key={direction} className={styles.historyPair}>
            <button
              type="button"
              className={`sor-btn sor-btn-secondary ${styles.command} ${styles.iconCommand}`}
              aria-label={`${label} document edit`}
              data-tooltip={
                steps.length
                  ? `${label}: ${steps[0]}`
                  : `No document edits to ${direction}`
              }
              disabled={unavailable}
              onClick={() => {
                setOpen(null);
                props.onStep(direction, 1);
              }}
            >
              <Icon size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`sor-btn sor-btn-secondary ${styles.command} ${styles.historyToggle}`}
              aria-label={`${label} history`}
              aria-expanded={open === direction && !unavailable}
              aria-controls={`${id}-${direction}`}
              aria-haspopup="menu"
              disabled={unavailable}
              data-tooltip={`${label} multiple edits`}
              onClick={() => setOpen(open === direction ? null : direction)}
            >
              <ChevronDown size={10} aria-hidden="true" />
            </button>
            {open === direction && !unavailable && (
              <div
                id={`${id}-${direction}`}
                role="menu"
                aria-label={`${label} document edits`}
                className={styles.historyMenu}
                onKeyDown={(event) => {
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role="menuitem"]',
                    ),
                  );
                  const index = buttons.indexOf(
                    event.target as HTMLButtonElement,
                  );
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(null);
                    event.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>(
                        '[aria-haspopup="menu"]',
                      )
                      ?.focus({ preventScroll: true });
                  } else if (
                    ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? buttons.length - 1
                          : (index +
                              (event.key === "ArrowDown" ? 1 : -1) +
                              buttons.length) %
                            buttons.length;
                    buttons[next]?.focus({ preventScroll: true });
                    if (buttons[next])
                      scrollElementWithinContainer(
                        event.currentTarget,
                        buttons[next],
                        { axis: "vertical" },
                      );
                  }
                }}
              >
                <p className={styles.historyCaption}>
                  {label} through this edit
                </p>
                {steps.map((step, index) => (
                  <button
                    key={index}
                    type="button"
                    role="menuitem"
                    ref={(button) => {
                      if (index === 0) button?.focus({ preventScroll: true });
                    }}
                    onClick={() => {
                      setOpen(null);
                      props.onStep(direction, index + 1);
                    }}
                  >
                    <span>{step}</span>
                    <span>
                      {index + 1} {index === 0 ? "step" : "steps"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {props.notice && (
        <span
          role="status"
          data-tooltip={props.notice}
          className="text-[var(--color-textMuted)]"
          tabIndex={0}
        >
          <CircleAlert size={13} aria-hidden="true" />
          <span className="sr-only">{props.notice}</span>
        </span>
      )}
    </div>
  );
}
