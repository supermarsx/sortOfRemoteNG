import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import {
  VAULT_SHORTCUTS,
  type VaultShortcutAction,
} from "../../../../utils/security/vaultManager/vaultShortcuts";
import type { VaultTextKey, VaultTx } from "./vaultText";

const LABELS: Record<VaultShortcutAction, VaultTextKey> = {
  search: "shortcutSearch",
  copyUsername: "shortcutCopyUsername",
  copyPassword: "shortcutCopyPassword",
  copyTotp: "shortcutCopyTotp",
  openConnection: "shortcutOpenConnection",
  edit: "shortcutEdit",
  create: "shortcutCreate",
  delete: "shortcutDelete",
  selectAll: "shortcutSelectAll",
  generator: "shortcutGenerator",
  reload: "shortcutReload",
  help: "shortcutHelp",
  escape: "shortcutEscape",
};

export function VaultShortcutHelp({
  onClose,
  tx,
}: {
  onClose: () => void;
  tx: VaultTx;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={tx("helpTitle")}
        className="w-full max-w-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{tx("helpTitle")}</h3>
          <button
            ref={close}
            type="button"
            className="sor-icon-btn-sm"
            aria-label={tx("helpClose")}
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-xs">
          {VAULT_SHORTCUTS.map(({ action, keys }) => (
            <div key={action} className="contents">
              <dt>{tx(LABELS[action])}</dt>
              <dd>
                <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px]">
                  {keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
