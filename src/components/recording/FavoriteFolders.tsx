import { useEffect, useState, type ReactNode } from "react";
import { Folder } from "lucide-react";
import type {
  QuickActionFolder,
  QuickActionReference,
} from "../../types/connection/sessionQuickActions";
import { MenuSurface } from "../ui/overlays/MenuSurface";

/** Folders group references only. Opening one never executes an action. */
export function FavoriteFolders<T extends QuickActionReference>({
  folders = [],
  items,
  renderItem,
  scope,
  onOpen,
  closeMenus = false,
  onFolderContextMenu,
}: {
  folders?: QuickActionFolder[];
  items: T[];
  renderItem: (item: T) => ReactNode;
  scope: string;
  onOpen?: () => void;
  closeMenus?: boolean;
  onFolderContextMenu?: (folderId: string, x: number, y: number) => void;
}) {
  const [menu, setMenu] = useState<{
    id: string;
    scope: string;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    if (closeMenus) setMenu(null);
  }, [closeMenus]);
  const selected =
    menu?.scope === scope
      ? folders.find((folder) => folder.id === menu.id)
      : undefined;
  return (
    <>
      {items
        .filter(
          (item) =>
            !item.folderId ||
            !folders.some((folder) => folder.id === item.folderId),
        )
        .map(renderItem)}
      {folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          className="sor-option-chip shrink-0 text-xs max-w-40"
          aria-label={`Favorite folder ${folder.name}`}
          aria-haspopup="menu"
          aria-expanded={selected?.id === folder.id}
          onContextMenu={(event) => {
            if (!onFolderContextMenu) return;
            event.preventDefault();
            event.stopPropagation();
            setMenu(null);
            onFolderContextMenu(folder.id, event.clientX, event.clientY);
          }}
          onClick={(event) => {
            onOpen?.();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ id: folder.id, scope, x: rect.left, y: rect.bottom });
          }}
        >
          <Folder size={13} />
          <span className="truncate">{folder.name}</span>
        </button>
      ))}
      {selected && menu && (
        <MenuSurface
          isOpen
          onClose={() => setMenu(null)}
          position={menu}
          ariaLabel={`Favorite folder ${selected.name}`}
          className="min-w-48 max-w-80 rounded-lg p-2"
        >
          <div
            className="flex flex-col items-start gap-1"
            onClick={(event) => {
              if (
                (event.target as HTMLElement).closest("button:not(:disabled)")
              )
                setMenu(null);
            }}
          >
            {items
              .filter((item) => item.folderId === selected.id)
              .map(renderItem)}
            {!items.some((item) => item.folderId === selected.id) && (
              <p className="p-2 text-xs text-[var(--color-textMuted)]">
                Empty folder
              </p>
            )}
          </div>
        </MenuSurface>
      )}
    </>
  );
}
