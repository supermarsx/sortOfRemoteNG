/**
 * `useLockShortcut` — global Ctrl+L / ⌘L keyboard binding that calls
 * `encryption_lock`.
 *
 * Separate from `useAutoLock` so the shortcut works regardless of the
 * user's auto-lock policy (you might want manual lock-on-demand even
 * with auto-lock disabled). Mounted by `AutoLockController` at the
 * App root.
 *
 * Behaviour:
 * - Fires only when the encryption state is currently unlocked —
 *   pressing Ctrl+L while already locked is a no-op (the listener
 *   does nothing rather than swallowing the keystroke from the rest
 *   of the page, so the browser default still works).
 * - Ignores the shortcut when the active element is an editable
 *   text input — Ctrl+L inside a URL bar / text area should select
 *   the line / address, not lock the app.
 * - Listens on the capture phase so that pages with their own
 *   keydown handlers can't swallow it before we see it.
 *
 * The matcher predicate is exported so unit tests can assert the
 * gating without mocking the entire DOM.
 */
import { useEffect, useRef } from "react";
import { useEncryption } from "./useEncryption";

/** Pure predicate: should the lock shortcut fire for this event?
 *  Extracted so tests don't need a real `KeyboardEvent` lifecycle. */
export function shouldFireLockShortcut(
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
  shiftKey: boolean,
  altKey: boolean,
  targetIsEditable: boolean,
  unlocked: boolean,
): boolean {
  if (!unlocked) return false;
  if (key.toLowerCase() !== "l") return false;
  // Either Ctrl (Win/Linux) or Cmd (Mac) — but never both, never
  // with Alt or Shift. Strict modifiers avoid stealing Ctrl+Shift+L
  // (browser dev-tools toggle) and Alt+L (locale switchers).
  if (shiftKey || altKey) return false;
  if (!(ctrlKey || metaKey)) return false;
  if (ctrlKey && metaKey) return false;
  // Don't steal Ctrl+L from a text input — that's the URL bar /
  // line-select shortcut and overriding it would be a footgun.
  if (targetIsEditable) return false;
  return true;
}

/** Inspect a DOM element to decide whether the user is currently
 *  editing text. Treats `contenteditable` and the standard form
 *  elements as editable. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) {
    // `type` like "checkbox" / "button" isn't editable.
    const t = (target.type || "").toLowerCase();
    const NON_EDITABLE = new Set([
      "button",
      "checkbox",
      "radio",
      "range",
      "submit",
      "reset",
      "color",
      "file",
      "hidden",
      "image",
    ]);
    return !NON_EDITABLE.has(t);
  }
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return false;
  const ce = (target as HTMLElement).isContentEditable;
  return !!ce;
}

export function useLockShortcut(): void {
  const enc = useEncryption();
  const lockRef = useRef(enc.lock);
  lockRef.current = enc.lock;
  const unlocked = !!enc.status?.unlocked;
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e.target);
      if (
        !shouldFireLockShortcut(
          e.key,
          e.ctrlKey,
          e.metaKey,
          e.shiftKey,
          e.altKey,
          editable,
          unlockedRef.current,
        )
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void lockRef.current("shortcut").catch(() => {
        // Errors are surfaced via the encryption hook's `error`
        // state; the shortcut itself stays silent so a transient
        // backend failure doesn't spam the keystroke handling path.
      });
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);
}
