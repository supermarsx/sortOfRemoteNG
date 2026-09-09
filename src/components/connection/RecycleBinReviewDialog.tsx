import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
import type { RecycleBinReview } from "../../types/connection/recycleBin";

export function RecycleBinReviewDialog({
  review,
  busy,
  onConfirm,
  onCancel,
  databaseName,
}: {
  review: RecycleBinReview | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  databaseName?: string;
}) {
  if (!review) return null;
  const retention = review.kind === "retention";
  const title = retention
    ? "Review recycle-bin retention"
    : "Permanently delete recycled connections?";
  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onCancel}
      ariaLabel={title}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      panelClassName="max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden"
    >
      <ModalHeader title={title} />
      <ModalBody className="min-h-0 overflow-y-auto p-6 space-y-3 text-sm">
        <p
          className="break-words text-[var(--color-textSecondary)]"
          title={review.scope.databaseId}
        >
          Database: {databaseName ?? review.scope.databaseId}
        </p>
        {retention && (
          <p>
            Keep deleted connections{" "}
            {review.policy?.mode === "forever"
              ? "indefinitely"
              : `for ${review.policy?.days} days from deletion`}{" "}
            in this database only.
          </p>
        )}
        {review.entryCount === 0 ? (
          <p>No existing items will be deleted.</p>
        ) : (
          <p>
            {review.entryCount} {review.entryCount === 1 ? "item" : "items"}{" "}
            will be permanently deleted
            {retention
              ? " because the new retention period has already elapsed"
              : " from this database’s recycle bin"}
            .
          </p>
        )}
        {review.entryCount > 0 && (
          <p className="text-warning">
            These items cannot be restored from the recycle bin afterward.
            Backups are not erased by this action.
          </p>
        )}
        <p className="text-[var(--color-textSecondary)]">
          This review is valid only while the database and recycle-bin contents
          remain unchanged.
        </p>
      </ModalBody>
      <ModalFooter className="shrink-0 flex justify-end gap-2">
        <button className="sor-modal-cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className={
            review.entryCount
              ? "sor-btn sor-btn-danger"
              : "sor-btn sor-btn-primary"
          }
          disabled={busy}
          onClick={onConfirm}
        >
          {retention ? "Apply retention" : "Permanently delete"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
