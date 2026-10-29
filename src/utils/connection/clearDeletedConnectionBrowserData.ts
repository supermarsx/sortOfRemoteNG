import type { Connection } from "../../types/connection/connection";
import { isBrowserProtocol } from "./browserConnectionType";
import {
  clearConnectionData,
  type OriginBrowserDataOutcome,
  type ClearConnectionDataResult,
} from "../../services/originBrowserData";

type Clear = (request: {
  connectionId: string;
  cookies: boolean;
  cache: boolean;
}) => Promise<OriginBrowserDataOutcome<ClearConnectionDataResult>>;

/** Saved web connections present before a delete and absent after it.
 * Covers folder deletes, whose descendants leave the live list too. */
export function deletedWebConnectionIds(
  before: readonly Connection[],
  after: readonly Connection[],
): string[] {
  const remaining = new Set(after.map((connection) => connection.id));
  return before
    .filter(
      (connection) =>
        !connection.isGroup &&
        isBrowserProtocol(connection.protocol) &&
        !remaining.has(connection.id),
    )
    .map((connection) => connection.id);
}

/**
 * Best effort, after a delete has been applied: clear each deleted web
 * connection's retained sign-in cookies and page cache (t-cefiso C-H5).
 * Fire-and-forget: returns synchronously, never throws and never blocks the
 * delete. Failures, including runtimes without the command, are only logged;
 * native housekeeping removes leftovers later.
 */
export function clearDeletedConnectionBrowserData(
  before: readonly Connection[],
  after: readonly Connection[],
  clear: Clear = clearConnectionData,
): void {
  let ids: string[];
  try {
    ids = deletedWebConnectionIds(before, after);
  } catch {
    return;
  }
  for (const connectionId of ids) {
    let pending: Promise<OriginBrowserDataOutcome<ClearConnectionDataResult>>;
    try {
      pending = clear({ connectionId, cookies: true, cache: true });
    } catch (error) {
      console.warn("Browser data cleanup after delete failed:", error);
      continue;
    }
    void Promise.resolve(pending).then(
      (outcome) => {
        if (outcome && !outcome.ok && outcome.error !== "unavailable")
          console.warn(
            `Browser data cleanup after delete did not complete (${outcome.error}).`,
          );
      },
      (error: unknown) =>
        console.warn("Browser data cleanup after delete failed:", error),
    );
  }
}
