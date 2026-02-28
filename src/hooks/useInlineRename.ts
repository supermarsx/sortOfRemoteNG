import { useState, useCallback, KeyboardEvent } from 'react';

/**
 * Encapsulates the common inline-rename pattern used
 * by recording rows, shortcut rows, and similar list items.
 *
 * Returns state and handlers that the caller wires into
 * an `<input>` + confirm/cancel buttons.
 */
export function useInlineRename(
  initialName: string,
  onCommit: (name: string) => void,
) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(initialName);

  const startRename = useCallback(() => {
    setDraft(initialName);
    setIsRenaming(true);
  }, [initialName]);

  const commitRename = useCallback(() => {
    if (draft.trim()) {
      onCommit(draft.trim());
    }
    setIsRenaming(false);
  }, [draft, onCommit]);

  const cancelRename = useCallback(() => {
    setDraft(initialName);
    setIsRenaming(false);
  }, [initialName]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') commitRename();
      if (e.key === 'Escape') cancelRename();
    },
    [commitRename, cancelRename],
  );

  return {
    isRenaming,
    draft,
    setDraft,
    startRename,
    commitRename,
    cancelRename,
    handleKeyDown,
  } as const;
}
