/** Advisory notes metadata, never a routing target or credential source. */
export interface ConnectionMachineAssignment {
  version: 1;
  type: "server" | "container" | "vm";
  name: string;
  /** Provider-scoped VM/container ID or server asset identifier, entered as text. */
  resourceId?: string;
  /** Hosting machine or platform name, not an endpoint to connect to. */
  host?: string;
  /** Exact saved record identity. Name/host above are fallback labels only. */
  connectionRef?: { databaseId: string; connectionId: string };
}

export const MACHINE_ASSIGNMENT_TEXT_LIMIT = 256;

/** Keep bounded labels and an exact scoped reference, never connection secrets. */
export function normalizeMachineAssignment(
  value: unknown,
): ConnectionMachineAssignment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.type !== "string" ||
    !["server", "container", "vm"].includes(String(candidate.type)) ||
    typeof candidate.name !== "string"
  )
    return undefined;
  const text = (item: unknown) =>
    typeof item === "string"
      ? item
          // eslint-disable-next-line no-control-regex -- Imported labels must not retain control bytes.
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .slice(0, MACHINE_ASSIGNMENT_TEXT_LIMIT)
          .trim()
      : "";
  const resourceId = text(candidate.resourceId);
  const host = text(candidate.host);
  const ref = candidate.connectionRef;
  const validId = (id: unknown): id is string =>
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 256 &&
    // Do not repair/truncate identities: that could point at a different record.
    id === text(id);
  const connectionRef =
    ref &&
    typeof ref === "object" &&
    !Array.isArray(ref) &&
    "databaseId" in ref &&
    validId(ref.databaseId) &&
    "connectionId" in ref &&
    validId(ref.connectionId)
      ? { databaseId: ref.databaseId, connectionId: ref.connectionId }
      : undefined;
  return {
    version: 1,
    type: candidate.type as ConnectionMachineAssignment["type"],
    name: text(candidate.name),
    ...(resourceId ? { resourceId } : {}),
    ...(host ? { host } : {}),
    ...(connectionRef ? { connectionRef } : {}),
  };
}
