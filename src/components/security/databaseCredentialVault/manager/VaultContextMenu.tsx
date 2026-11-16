import { MenuSurface } from "../../../ui/overlays/MenuSurface";
import { VaultActionButton, type VaultAction } from "./VaultToolbar";
import type { VaultTx } from "./vaultText";

/** Right-click menu: the same action descriptors as the toolbar, so the two
 * can never disagree about what is enabled. */
export function VaultContextMenu({
  position,
  actions,
  onClose,
  tx,
}: {
  position: { x: number; y: number } | null;
  actions: readonly VaultAction[];
  onClose: () => void;
  tx: VaultTx;
}) {
  return (
    <MenuSurface
      isOpen={!!position}
      position={position}
      onClose={onClose}
      ariaLabel={tx("contextMenu")}
      className="w-60 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-xl"
    >
      {actions.map((action, index) => (
        <div key={action.id}>
          {index > 0 && actions[index - 1].group !== action.group && (
            <hr className="my-1 border-[var(--color-border)]" />
          )}
          <VaultActionButton
            menu
            action={{
              ...action,
              onClick: (event) => {
                onClose();
                action.onClick(event);
              },
            }}
          />
        </div>
      ))}
    </MenuSurface>
  );
}
