/** Runtime metadata only. Never store credential contents or serialized drafts. */
export interface CredentialVaultDraftState {
  databaseId: string;
  scopeKey: string;
  dirty: boolean;
  busy: boolean;
  revision: number;
}
const drafts = new Map<string, () => CredentialVaultDraftState>();
export function registerCredentialVaultDraft(
  sessionId: string,
  read: () => CredentialVaultDraftState,
) {
  drafts.set(sessionId, read);
  return () => {
    if (drafts.get(sessionId) === read) drafts.delete(sessionId);
  };
}
export function getCredentialVaultDraft(sessionId: string) {
  const read = drafts.get(sessionId);
  if (!read) return undefined;
  return { ...read(), isCurrent: () => drafts.get(sessionId) === read };
}
export function hasPendingCredentialVaultDraft(databaseId: string): boolean {
  return [...drafts.values()].some((read) => {
    const draft = read();
    return draft.databaseId === databaseId && (draft.dirty || draft.busy);
  });
}
