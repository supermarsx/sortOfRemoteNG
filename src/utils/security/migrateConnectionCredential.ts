import type { Connection } from "../../types/connection/connection";
import type { ConnectionContextType } from "../../contexts/ConnectionContextTypes";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialScope,
  DatabaseCredentialSnapshot,
} from "../../types/security/databaseCredentialVault";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { normalizeDatabaseCredentialEntry } from "./databaseCredentialVault";
import {
  clearLocalCredentialFields,
  LOCAL_CREDENTIAL_FACETS,
} from "./connectionCredentialConversion";

const same = (a: unknown, b: unknown) =>
  stableJsonStringify(a) === stableJsonStringify(b);

/** Same conversion facets and verified-write sequence as the connection editor.
 * Persist and verify the link with local fields retained BEFORE cleanup. Nothing
 * is deleted from the vault, including after an uncertain/failed save. */
export async function migrateConnectionCredential({
  access,
  scope,
  original,
  entry: draft,
}: {
  access: () => ConnectionContextType;
  scope: DatabaseCredentialScope;
  original: Connection;
  entry: DatabaseCredentialEntry;
}): Promise<void> {
  const entry = normalizeDatabaseCredentialEntry(draft);
  const selectedLocalId =
    original.synologySettings?.otpAuthenticatorId ??
    original.httpAutoMfa?.totpConfigId;
  const localTotp = selectedLocalId
    ? original.totpConfigs?.find((item) => item.id === selectedLocalId)
    : undefined;
  const selectedSecret = localTotp?.secret ?? original.totpSecret;
  const totpId = entry.facets.totp?.find(
    (item) =>
      item.secret === selectedSecret?.replace(/\s/g, "").toUpperCase() &&
      (!localTotp ||
        (item.digits === localTotp.digits &&
          item.period === localTotp.period &&
          item.algorithm === localTotp.algorithm)),
  )?.id;
  if (selectedSecret && !totpId)
    throw new Error("Authenticator review required");
  const linked: Connection = {
    ...original,
    credentialSource: {
      kind: "vault",
      credentialId: entry.id,
      ...(totpId ? { totpId } : {}),
    },
    // Switching the source revokes automatic submission approval, as in the editor.
    httpAutoMfa: original.httpAutoMfa
      ? { version: 1, enabled: false }
      : undefined,
  };
  const cleaned = { ...linked, ...clearLocalCredentialFields() };
  const read = (allowed: readonly Connection[]) => {
    const context = access();
    const availability = context.databaseAvailability;
    const api = context.credentialVault;
    if (
      !api?.scope ||
      api.scope.databaseId !== scope.databaseId ||
      api.scope.generation !== scope.generation ||
      availability?.status !== "ready" ||
      availability.databaseId !== scope.databaseId ||
      !context.getCurrentConnections
    )
      throw new Error("Owner changed");
    const matches = context
      .getCurrentConnections({
        databaseId: scope.databaseId,
        generation: availability.generation,
      })
      .filter((row) => row.id === original.id);
    if (matches.length !== 1 || !allowed.some((row) => same(row, matches[0])))
      throw new Error("Connection changed");
    return { context, api, connection: matches[0] };
  };
  const states = [original, linked, cleaned];
  const review = async (): Promise<DatabaseCredentialSnapshot> => {
    const snapshot = await read(states).api.list({ ...scope });
    read(states);
    if (!same(snapshot.scope, scope)) throw new Error("Review owner changed");
    return snapshot;
  };
  let snapshot = await review();
  if (!snapshot.entries.some((row) => row.id === entry.id)) {
    // Retries reuse the editor's entry id. Never create another id after an uncertain write.
    await read([original]).api.compareAndSwap(snapshot, [
      { operation: "put", entry },
    ]);
    const prior = snapshot.revision;
    snapshot = await review();
    if (snapshot.revision <= prior) throw new Error("Write not verified");
  }
  if (!snapshot.entries.some((row) => row.id === entry.id))
    throw new Error("Missing saved credential");
  const facets = LOCAL_CREDENTIAL_FACETS.filter(
    (facet) => entry.facets[facet] !== undefined,
  );
  const stored = await read(states).api.resolve(snapshot, entry.id, facets);
  read(states);
  if (facets.some((facet) => !same(stored[facet], entry.facets[facet])))
    throw new Error("Credential verification failed");
  const verifyUnchangedVault = async () => {
    const current = await review();
    if (
      current.revision !== snapshot.revision ||
      !current.entries.some((row) => row.id === entry.id)
    )
      throw new Error("Verified credential changed");
  };
  if (same(read(states).connection, original)) {
    await read([original]).context.dispatchAndFlush({
      type: "UPDATE_CONNECTION",
      payload: linked,
    });
  }
  // api.list joins pending saves and verifies the protected on-disk target.
  await verifyUnchangedVault();
  const current = read([linked, cleaned]);
  if (same(current.connection, linked)) {
    await current.context.dispatchAndFlush({
      type: "UPDATE_CONNECTION",
      payload: cleaned,
    });
  }
  await verifyUnchangedVault();
  read([cleaned]);
}
