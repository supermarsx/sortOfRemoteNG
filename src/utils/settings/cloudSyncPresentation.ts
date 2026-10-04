/** Presentation only: identifiers never become instructions to open/unlock data. */
export function cloudSyncArtifactLabel(id: string): string {
  if (id.startsWith("database:")) return "Unavailable database";
  return id;
}

const unavailableDatabase =
  /Selected cloud sync artifact "database:([^"\r\n]+)" is unavailable\./g;

export function unavailableCloudSyncDatabaseIds(message: string): string[] {
  return [
    ...new Set(
      Array.from(message.matchAll(unavailableDatabase), (match) => match[1]),
    ),
  ];
}

/** Also covers older persisted failures, before the engine supplied names. */
export function cloudSyncErrorMessage(
  message: string,
  databaseNames: ReadonlyMap<string, string> = new Map(),
): string {
  return message.replace(unavailableDatabase, (_match, id: string) => {
    const name = databaseNames.get(id)?.trim();
    return name
      ? `Database “${name}” is unavailable for cloud sync.`
      : "A selected database is unavailable for cloud sync.";
  });
}
