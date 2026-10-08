import React, { useLayoutEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import type {
  ConnectionSession,
  HttpBookmarkItem,
} from "../../../types/connection/connection";
import {
  cloneOriginBookmarks,
  useOriginBookmarks,
  type BookmarkPath,
  type OriginBookmarkReview,
} from "../../../hooks/protocol/useOriginBookmarks";
import { resolveHttpBookmarkUrl } from "../../../utils/protocol/httpBookmarkUrl";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import { TextInput } from "../../ui/forms/TextInput";

function findBookmark(
  rows: HttpBookmarkItem[],
  url: string,
  initialUrl: string,
  parent: BookmarkPath = [],
): BookmarkPath | undefined {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index],
      path = [...parent, index];
    if (row.isFolder) {
      const found = findBookmark(row.children, url, initialUrl, path);
      if (found) return found;
    } else if (resolveHttpBookmarkUrl(row.path, initialUrl, url) === url)
      return path;
  }
}
type Review = {
  receipt: OriginBookmarkReview;
  path?: BookmarkPath;
  url: string;
  name: string;
};

/** Toolbar access to the same connection-owned bookmark tree, even with the bar hidden. */
export default function OriginBookmarkButton({
  session,
  bookmarks,
  initialUrl,
  currentUrl,
  currentTitle,
  eligible,
  canOpen,
  temporary,
  assertOwner,
  hideNative,
  onOverlayChange,
}: {
  session: ConnectionSession;
  bookmarks?: HttpBookmarkItem[];
  initialUrl: string;
  currentUrl?: string;
  currentTitle?: string;
  eligible: boolean;
  canOpen: boolean;
  temporary: boolean;
  assertOwner: () => void;
  hideNative: () => void;
  onOverlayChange: (open: boolean) => void;
}) {
  const capture = useOriginBookmarks(
    session,
    eligible && !temporary,
    assertOwner,
    bookmarks,
  );
  const [review, setReview] = useState<Review | null>(null);
  const currentReview = useRef(review);
  currentReview.current = review;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false),
    alive = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const url = currentUrl ? resolveHttpBookmarkUrl(currentUrl, initialUrl) : "";
  let valid = true,
    existing: BookmarkPath | undefined;
  try {
    if (url)
      existing = findBookmark(cloneOriginBookmarks(bookmarks), url, initialUrl);
  } catch {
    valid = false;
  }
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      currentReview.current = null;
      onOverlayChange(false);
    };
  }, [onOverlayChange]);
  useLayoutEffect(() => {
    currentReview.current = null;
    setReview(null);
    setError(false);
    onOverlayChange(false);
  }, [eligible, temporary, session, currentUrl, onOverlayChange]);
  const close = () => {
    currentReview.current = null;
    setReview(null);
    setError(false);
    onOverlayChange(false);
  };
  const open = () => {
    if (!eligible || !canOpen || temporary || !valid || !url || pending.current)
      return;
    try {
      const receipt = capture();
      const path = findBookmark(receipt.tree, url, initialUrl);
      let rows = receipt.tree;
      if (path)
        for (const index of path.slice(0, -1)) {
          const row = rows[index];
          if (!row.isFolder) throw new Error();
          rows = row.children;
        }
      const name = path
        ? rows[path[path.length - 1]].name
        : currentTitle || "Current page";
      hideNative();
      onOverlayChange(true);
      setError(false);
      setReview({ receipt, path, url, name });
    } catch {
      setError(true);
    }
  };
  const save = async () => {
    if (
      !review ||
      currentReview.current !== review ||
      !eligible ||
      temporary ||
      pending.current ||
      !review.name.trim()
    )
      return;
    const captured = review;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      assertOwner();
      await captured.receipt.commit({
        kind: "save",
        path: captured.path,
        parent: captured.path?.slice(0, -1) ?? [],
        item: { name: captured.name.trim(), path: captured.url },
      });
      if (alive.current && currentReview.current === captured) close();
    } catch {
      if (alive.current && currentReview.current === captured) setError(true);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const label = existing ? "Edit bookmark for this page" : "Bookmark this page";
  return (
    <>
      <button
        type="button"
        aria-label={label}
        className="sor-btn sor-icon-btn-sm shrink-0"
        data-tooltip={temporary ? "Save a connection to add bookmarks." : label}
        disabled={!eligible || !canOpen || temporary || !url || !valid || busy}
        onClick={open}
      >
        <Star
          size={16}
          aria-hidden="true"
          className={existing ? "text-warning" : undefined}
          fill={existing ? "currentColor" : "none"}
        />
      </button>
      {error && !review && (
        <span role="alert" className="text-xs text-error">
          Bookmarks could not be opened. Check database access.
        </span>
      )}
      {review && eligible && !temporary && (
        <Modal
          isOpen
          ariaLabel="Bookmark this page"
          initialFocusRef={cancel}
          onClose={busy ? undefined : close}
          panelClassName="max-w-lg mx-4"
        >
          <ModalHeader
            title={review.path ? "Edit page bookmark" : "Bookmark this page"}
            onClose={busy ? undefined : close}
          />
          <ModalBody className="space-y-4 p-5">
            <label className="block text-sm">
              Name
              <TextInput
                aria-label="Bookmark name"
                value={review.name}
                disabled={busy}
                onChange={(name) => setReview({ ...review, name })}
              />
            </label>
            <p
              className="break-all rounded border border-[var(--color-border)] p-3 font-mono text-xs"
              dir="ltr"
            >
              {review.url}
            </p>
            <p className="text-xs text-[var(--color-textSecondary)]">
              The full address, including query and fragment values, will be
              saved in this connection's database. Review it for sensitive
              information.
            </p>
            {error && (
              <p role="alert" className="text-sm text-error">
                The bookmark could not be saved. Close and reopen this review
                after checking database access and current bookmarks.
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <button
              ref={cancel}
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              className="sor-btn sor-btn-primary"
              disabled={busy || !review.name.trim()}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save bookmark"}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
