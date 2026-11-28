import { useState } from "react";
import type {
  QuickActionReference,
  SshQuickActionsConfig,
} from "../../types/connection/sessionQuickActions";
import { quickActionReferenceKey } from "../../utils/connection/sessionQuickActions";
import { FavoriteFolderEditor } from "../connectionEditor/FavoriteFolderEditor";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";

export function FavoriteOrganizer({
  config,
  items,
  onSave,
  onClose,
  busy,
}: {
  config: SshQuickActionsConfig;
  items: Array<QuickActionReference & { name: string }>;
  onSave: (
    config: SshQuickActionsConfig,
    expected: SshQuickActionsConfig,
  ) => Promise<unknown>;
  onClose: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(config);
  const [reviewed] = useState(config);
  const [error, setError] = useState(false);
  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onClose}
      ariaLabel="Organize favorite folders"
      panelClassName="max-w-xl w-full mx-4 max-h-[85vh] flex flex-col"
    >
      <ModalHeader title="Favorite folders" />
      <ModalBody className="p-4 space-y-4 overflow-y-auto">
        {error && (
          <p role="alert" className="text-sm text-error">
            Folders could not be saved. Close this organizer and reopen it to
            review the current favourites.
          </p>
        )}
        <FavoriteFolderEditor
          folders={draft.folders ?? []}
          onChange={(folders) =>
            setDraft({
              ...draft,
              folders,
              items: draft.items.map((item) => {
                if (
                  !item.folderId ||
                  folders.some((folder) => folder.id === item.folderId)
                )
                  return item;
                const { folderId: _folder, ...rest } = item;
                return rest;
              }),
            })
          }
        />
        {draft.items.map((item, index) => (
          <label
            key={quickActionReferenceKey(item)}
            className="flex items-center gap-3 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">
              {items.find(
                (candidate) =>
                  quickActionReferenceKey(candidate) ===
                  quickActionReferenceKey(item),
              )?.name ?? "Unavailable library entry"}
            </span>
            <select
              className="sor-form-select-sm max-w-48"
              aria-label={`Folder for ${items.find((candidate) => quickActionReferenceKey(candidate) === quickActionReferenceKey(item))?.name ?? item.id}`}
              value={item.folderId ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  items: draft.items.map((reference, row) => {
                    if (row !== index) return reference;
                    const { folderId: _folder, ...rest } = reference;
                    return event.target.value
                      ? { ...rest, folderId: event.target.value }
                      : rest;
                  }),
                })
              }
            >
              <option value="">No folder</option>
              {draft.folders?.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </ModalBody>
      <ModalFooter className="flex justify-end gap-2">
        <button
          type="button"
          className="sor-modal-cancel"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sor-modal-primary"
          disabled={busy}
          onClick={() =>
            void onSave(draft, reviewed)
              .then((result) => {
                if (result !== false) onClose();
                else setError(true);
              })
              .catch(() => setError(true))
          }
        >
          {busy ? "Saving…" : "Save folders"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
