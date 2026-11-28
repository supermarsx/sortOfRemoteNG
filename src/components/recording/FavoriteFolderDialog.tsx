import { useState } from "react";
import type { SshQuickActionsConfig } from "../../types/connection/sessionQuickActions";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
export type FavoriteFolderAction = {
  kind: "create" | "rename" | "delete";
  folderId?: string;
};

export function FavoriteFolderDialog({
  action,
  config,
  busy,
  onSave,
  onClose,
}: {
  action: FavoriteFolderAction;
  config: SshQuickActionsConfig;
  busy: boolean;
  onSave: (
    next: SshQuickActionsConfig,
    expected: SshQuickActionsConfig,
  ) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reviewed] = useState(config);
  const folder = reviewed.folders?.find(
    (folder) => folder.id === action.folderId,
  );
  const [name, setName] = useState(folder?.name ?? "");
  const [error, setError] = useState(false);
  const deleting = action.kind === "delete";
  const title =
    action.kind === "create"
      ? "New script folder"
      : deleting
        ? "Delete script folder"
        : "Rename script folder";
  const save = async () => {
    const folders = reviewed.folders ?? [];
    if (action.kind !== "create" && !folder) {
      setError(true);
      return;
    }
    const next = {
      ...reviewed,
      folders:
        action.kind === "create"
          ? [...folders, { id: crypto.randomUUID(), name: name.trim() }]
          : deleting
            ? folders.filter((item) => item.id !== folder!.id)
            : folders.map((item) =>
                item.id === folder!.id ? { ...item, name: name.trim() } : item,
              ),
      items: reviewed.items.map((item) => {
        if (!deleting || item.folderId !== folder?.id) return item;
        const { folderId: _removed, ...reference } = item;
        return reference;
      }),
    };
    try {
      if ((await onSave(next, reviewed)) === false) setError(true);
      else onClose();
    } catch {
      setError(true);
    }
  };
  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onClose}
      ariaLabel={title}
      panelClassName="max-w-sm w-full mx-4"
    >
      <ModalHeader title={title} />
      <ModalBody className="p-4 space-y-3">
        {deleting ? (
          <p className="text-sm">
            Delete “{folder?.name}”? Its favourites will move to the top level.
          </p>
        ) : (
          <label className="block text-sm">
            Folder name
            <input
              autoFocus
              className="sor-form-input mt-1 w-full"
              maxLength={128}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            Folder could not be saved. Reopen this action to review the current
            favourites.
          </p>
        )}
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
          className={deleting ? "sor-btn sor-btn-danger" : "sor-modal-primary"}
          disabled={busy || (!deleting && !name.trim())}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : deleting ? "Delete folder" : "Save folder"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
