import { useRef } from "react";
import { ExternalLink } from "lucide-react";
import type { useWebExternalLinks } from "../../../hooks/protocol/useWebExternalLinks";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";

export default function ExternalLinkReview({
  manager,
}: {
  manager: ReturnType<typeof useWebExternalLinks>;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  if (!manager.url) return null;
  return (
    <Modal
      isOpen
      ariaLabel="Open email link"
      panelClassName="max-w-xl mx-4"
      initialFocusRef={cancelRef}
      onClose={manager.busy ? undefined : manager.cancel}
    >
      <ModalHeader
        title="Open email link"
        onClose={manager.busy ? undefined : manager.cancel}
      />
      <ModalBody className="p-6 space-y-4">
        <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
          Open this address in your system browser. Your mailbox stays open
          here. Website cookies and saved login details are not shared.
        </p>
        <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
          Your system browser uses its own network and proxy settings, outside
          this app's private proxy route.
        </p>
        <p
          dir="ltr"
          className="max-h-48 overflow-auto break-all rounded-lg border border-[var(--color-border)] p-4 font-mono text-sm"
          style={{ unicodeBidi: "plaintext" }}
        >
          {manager.url}
        </p>
        {manager.error && (
          <p role="alert" className="mt-2 text-xs text-error">
            {manager.error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          ref={cancelRef}
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={manager.busy}
          onClick={manager.cancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-primary gap-2"
          disabled={manager.busy}
          onClick={(event) => void manager.open(event.nativeEvent)}
        >
          <ExternalLink size={16} aria-hidden="true" />
          {manager.busy ? "Opening…" : "Open in browser"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
