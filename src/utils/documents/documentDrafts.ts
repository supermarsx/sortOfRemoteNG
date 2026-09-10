/** Runtime metadata only: private document contents never enter tab state. */
export interface DocumentDraftState {
  databaseId: string;
  dirty: boolean;
  busy: boolean;
  revision: number;
}
const drafts = new Map<string, () => DocumentDraftState>();
export function registerDocumentDraft(
  sessionId: string,
  read: () => DocumentDraftState,
) {
  drafts.set(sessionId, read);
  return () => {
    if (drafts.get(sessionId) === read) drafts.delete(sessionId);
  };
}
export function getDocumentDraft(
  sessionId: string,
): DocumentDraftState | undefined {
  return drafts.get(sessionId)?.();
}
export function hasPendingDocumentDraft(databaseId: string): boolean {
  return [...drafts.values()].some((read) => {
    const draft = read();
    return draft.databaseId === databaseId && (draft.dirty || draft.busy);
  });
}
