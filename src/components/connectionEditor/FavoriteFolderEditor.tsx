import { hasAutomationControlCharacters } from "../../utils/recording/automationProvenance";
import { useId, useState } from "react";
import { FolderPlus, Trash2 } from "lucide-react";
import type { QuickActionFolder } from "../../types/connection/sessionQuickActions";

/** Names only. Library bodies and the scope-qualified references stay untouched. */
export function FavoriteFolderEditor({
  folders,
  onChange,
}: {
  folders: QuickActionFolder[];
  onChange: (folders: QuickActionFolder[]) => void;
}) {
  const [name, setName] = useState("");
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <label htmlFor={id} className="min-w-0 flex-1 text-xs">
          New script / macro folder
          <input
            id={id}
            className="sor-form-input mt-1 w-full"
            maxLength={128}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="sor-btn sor-btn-secondary text-xs"
          disabled={
            !name.trim() ||
            folders.length >= 64 ||
            hasAutomationControlCharacters(name, false)
          }
          onClick={() => {
            onChange([
              ...folders,
              { id: crypto.randomUUID(), name: name.trim() },
            ]);
            setName("");
          }}
        >
          <FolderPlus size={14} /> Add folder
        </button>
      </div>
      {folders.map((folder) => (
        <div key={folder.id} className="flex items-center gap-2">
          <input
            className="sor-form-input min-w-0 flex-1"
            aria-label={`Folder name ${folder.name}`}
            value={folder.name}
            maxLength={128}
            onChange={(event) => {
              const name = event.target.value;
              if (name.trim() && !hasAutomationControlCharacters(name, false))
                onChange(
                  folders.map((item) =>
                    item.id === folder.id ? { ...item, name } : item,
                  ),
                );
            }}
          />
          <button
            type="button"
            className="sor-icon-btn"
            aria-label={`Remove folder ${folder.name}`}
            data-tooltip="Remove folder; keep its favourites at the top level"
            onClick={() =>
              onChange(folders.filter((item) => item.id !== folder.id))
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
