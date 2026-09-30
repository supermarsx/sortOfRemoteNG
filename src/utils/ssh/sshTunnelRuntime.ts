import type { ConnectionContextType } from "../../contexts/ConnectionContextTypes";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { DatabaseManager } from "../connection/databaseManager";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { normalizeAdvancedProtocolConnection } from "../connection/normalizeAdvancedProtocolConnection";
import { normalizeConnectionCredentialSource } from "../security/databaseCredentialVault";
import {
  resolveRuntimeVaultCredential,
  type RuntimeVaultCredentialResult,
} from "../security/runtimeCredentialVault";

export interface TunnelRuntimeOptions {
  connections?: readonly Connection[];
  vault?: RuntimeVaultCredentialResult;
  assertCurrent?: () => void;
}

/** Private comparison only: never log or persist this credential-bearing key.
 * Retain unknown fields so new authentication/route/trust options participate
 * automatically. Unlike website identities this has no HTTP normalization.
 */
function tunnelSourceIdentity(connection: Connection | undefined): string {
  if (!connection) return stableJsonStringify(null);
  const source: Record<string, unknown> = { ...connection };
  for (const key of [
    "name",
    "description",
    "tags",
    "order",
    "color",
    "colorTag",
    "tabColor",
    "icon",
    "expanded",
    "favorite",
    "httpBookmarks",
    "focusOnConnect",
    "focusOnWinmgmtTool",
    "lastConnected",
    "connectionCount",
    "updatedAt",
    "lastAccessed",
    "lastUsed",
  ])
    delete source[key];
  // Keep creation identity (and invalid/missing values), but equate hydrated
  // Dates and persisted strings representing the same instant.
  const createdAt = source.createdAt;
  if (typeof createdAt === "string" || createdAt instanceof Date) {
    const timestamp = new Date(createdAt).getTime();
    if (Number.isFinite(timestamp))
      source.createdAt = new Date(timestamp).toISOString();
  }
  return stableJsonStringify(source);
}

/** Read the owning saved database at connect time; never serialize resolved authentication. */
export async function resolveSavedTunnelBase(
  connectionId: string,
  ownerDatabaseId: string | undefined,
  current: () => ConnectionContextType,
): Promise<{ connection: Connection; options: TunnelRuntimeOptions }> {
  if (!ownerDatabaseId)
    throw new Error(
      "This legacy tunnel has no owning database. Edit it, explicitly reselect its saved SSH base and save before connecting.",
    );
  const captured = current();
  const availability = captured.databaseAvailability;
  const target =
    DatabaseManager.getInstance().captureCurrentDatabaseDataTarget();
  if (
    !target?.readCurrent ||
    !target.assertAccessible ||
    availability?.status !== "ready" ||
    availability.databaseId !== target.databaseId ||
    (ownerDatabaseId && ownerDatabaseId !== target.databaseId)
  ) {
    throw new Error(
      "Open and unlock the tunnel's owning database before connecting its saved SSH base.",
    );
  }
  const api = captured.credentialVault;
  const revision = api?.changeRevision;
  const scope = JSON.stringify(api?.scope);
  const selected = captured.state.connections.find(
    (c) => c.id === connectionId,
  );
  const selectedKey = tunnelSourceIdentity(selected);
  const assertCurrent = () => {
    const latest = current();
    target.assertAccessible!();
    const live =
      latest.getCurrentConnections?.({
        databaseId: target.databaseId,
        generation: availability.generation,
      }) ?? latest.state.connections;
    if (
      latest.databaseAvailability?.status !== "ready" ||
      latest.databaseAvailability.databaseId !== target.databaseId ||
      latest.databaseAvailability.generation !== availability.generation ||
      latest.credentialVault?.changeRevision !== revision ||
      JSON.stringify(latest.credentialVault?.scope) !== scope ||
      tunnelSourceIdentity(live.find((c) => c.id === connectionId)) !==
        selectedKey
    ) {
      throw new Error(
        "The SSH base or owning database changed. Review the saved connection and retry.",
      );
    }
  };
  assertCurrent();
  const data = await target.readCurrent();
  assertCurrent();
  const matches = data?.connections.filter((c) => c.id === connectionId);
  const connection =
    matches?.length === 1
      ? normalizeAdvancedProtocolConnection(matches[0])
      : undefined;
  if (
    !selected ||
    !connection ||
    connection.protocol !== "ssh" ||
    connection.isGroup ||
    tunnelSourceIdentity(connection) !== selectedKey
  ) {
    throw new Error(
      "Save the SSH base connection in its owning database before opening this tunnel.",
    );
  }
  let vault: RuntimeVaultCredentialResult | undefined;
  if (
    normalizeConnectionCredentialSource(connection.credentialSource)?.kind ===
    "vault"
  ) {
    if (!api?.scope)
      throw new Error(
        "Unlock the owning database credential vault before connecting this SSH tunnel.",
      );
    vault = await resolveRuntimeVaultCredential({
      api,
      connection,
      target,
      assertCurrent,
      session: {
        id: `ssh-tunnel:${connection.id}`,
        connectionId: connection.id,
        ownerDatabaseId: target.databaseId,
        hostname: connection.hostname,
        protocol: "ssh",
        name: connection.name,
        status: "connecting",
        startTime: new Date(),
      } as ConnectionSession,
    });
  }
  return {
    connection,
    options: { connections: data!.connections, vault, assertCurrent },
  };
}
