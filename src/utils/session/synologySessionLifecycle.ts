/** Exact mounted-session handlers, containing no persisted credentials or native SID. */
const controllers = new Map<string, { disconnect: () => Promise<void> }>();
export function registerSynologySession(
  sessionId: string,
  disconnect: () => Promise<void>,
): () => void {
  const controller = { disconnect };
  controllers.set(sessionId, controller);
  return () => {
    if (controllers.get(sessionId) === controller)
      controllers.delete(sessionId);
  };
}
export async function disconnectSynologySession(
  sessionId: string,
): Promise<void> {
  await controllers.get(sessionId)?.disconnect();
}
