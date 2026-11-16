export type VaultShortcutAction =
  | "search"
  | "copyUsername"
  | "copyPassword"
  | "copyTotp"
  | "openConnection"
  | "edit"
  | "create"
  | "delete"
  | "selectAll"
  | "generator"
  | "help"
  | "escape"
  | "reload";

export interface VaultShortcutDef {
  action: VaultShortcutAction;
  keys: string;
}

/** Shown in the help overlay; every row maps to a handler that exists. */
export const VAULT_SHORTCUTS: readonly VaultShortcutDef[] = [
  { action: "search", keys: "Ctrl+F" },
  { action: "copyUsername", keys: "Ctrl+B" },
  { action: "copyPassword", keys: "Ctrl+C" },
  { action: "copyTotp", keys: "Ctrl+T" },
  { action: "openConnection", keys: "Ctrl+U" },
  { action: "edit", keys: "Enter" },
  { action: "create", keys: "Insert" },
  { action: "delete", keys: "Delete" },
  { action: "selectAll", keys: "Ctrl+A" },
  { action: "generator", keys: "Ctrl+G" },
  { action: "reload", keys: "F5" },
  { action: "help", keys: "F1" },
  { action: "escape", keys: "Esc" },
];

export interface ShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** True when focus is in an editable control. */
  inEditable: boolean;
  /** True when the user has selected text on the page. */
  hasTextSelection: boolean;
}

/**
 * Returns the vault action for a key press, or null. Plain-text editing keys
 * (Delete, Enter, Ctrl+A, Ctrl+C) are never hijacked from inputs, and Ctrl+C
 * never overrides a real text selection.
 */
export function matchVaultShortcut(
  event: ShortcutEventLike,
): VaultShortcutAction | null {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.altKey) return null;
  if (mod && !event.shiftKey) {
    if (key === "f") return "search";
    if (key === "g") return "generator";
    if (event.inEditable) return null;
    if (key === "b") return "copyUsername";
    if (key === "c") return event.hasTextSelection ? null : "copyPassword";
    if (key === "t") return "copyTotp";
    if (key === "u") return "openConnection";
    if (key === "a") return "selectAll";
    return null;
  }
  if (mod) return null;
  if (key === "F1") return "help";
  if (key === "Escape") return "escape";
  if (key === "F5") return "reload";
  if (event.inEditable) return null;
  if (key === "Insert") return "create";
  if (key === "Delete") return "delete";
  if (key === "Enter") return "edit";
  return null;
}
