import { useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { VaultTotpFacet } from "../../types/security/databaseCredentialVault";
import {
  CredentialFailure,
  toCredentialFailure,
} from "../../utils/security/credentialFailure";
import { runtimeCredentialTargetKey } from "../../utils/security/runtimeCredentialVault";
import { generateTotpCode } from "../../utils/security/totpCode";
import { useRuntimeCredentialVault } from "./useRuntimeCredentialVault";

export type RuntimeVaultTotpEntry = Omit<VaultTotpFacet, "secret">;
export interface RuntimeVaultTotpController {
  scopeKey: string;
  sourceKind?: "connection" | "vault";
  available: boolean;
  unavailableReason: string;
  load: () => Promise<RuntimeVaultTotpEntry[]>;
  /** Rejects with a `CredentialFailure` naming the cause. */
  generate: (
    id: string,
  ) => Promise<{ code: string; expires: number; assertCurrent: () => void }>;
}

/** Manual disclosure facade: metadata/code only. Seeds never enter React state. */
export function useRuntimeVaultTotp(
  session: ConnectionSession,
  connection?: Connection,
): RuntimeVaultTotpController {
  const resolve = useRuntimeCredentialVault(session, connection);
  const { credentialVault, databaseAvailability } = useConnections();
  const identity = JSON.stringify([
    session.id,
    session.connectionId,
    session.ownerDatabaseId,
    credentialVault?.scope,
    credentialVault?.changeRevision,
    databaseAvailability,
    connection ? runtimeCredentialTargetKey(connection) : null,
  ]);
  const version = useRef({ identity, revision: 0 });
  if (version.current.identity !== identity)
    version.current = { identity, revision: version.current.revision + 1 };
  const revision = version.current.revision;
  const assertCurrent = () => {
    if (version.current.revision !== revision)
      throw new CredentialFailure("session-changed");
  };
  const available =
    connection?.credentialSource?.kind === "vault" &&
    !!credentialVault?.scope &&
    databaseAvailability?.status === "ready" &&
    databaseAvailability.databaseId === session.ownerDatabaseId &&
    credentialVault.scope.databaseId === session.ownerDatabaseId;
  const read = async () => {
    assertCurrent();
    if (!available) throw new CredentialFailure("database-unavailable");
    try {
      const result = await resolve(assertCurrent, false, "totp");
      if (!result) throw new CredentialFailure("authenticator-unavailable");
      result.assertCurrent();
      return result;
    } catch (error) {
      // The resolver's own text is not a message. A changed selection explains
      // its failure better than "unreadable" does.
      if (!(error instanceof CredentialFailure)) assertCurrent();
      throw toCredentialFailure(error, "vault-unavailable");
    }
  };
  return {
    scopeKey: `${session.id}:${session.ownerDatabaseId ?? ""}:${revision}`,
    sourceKind: "vault",
    available,
    unavailableReason: available
      ? ""
      : "Open and unlock the owning database vault to use its authenticators.",
    load: async () => {
      const result = await read();
      try {
        return result.facets.totp!.map(
          ({ secret: _secret, ...metadata }) => metadata,
        );
      } finally {
        result.facets = {};
      }
    },
    generate: async (id) => {
      const result = await read();
      const assertAccess = () => {
        try {
          result.assertCurrent();
        } catch (error) {
          throw toCredentialFailure(error, "session-changed");
        }
      };
      try {
        const matches =
          result.facets.totp?.filter((entry) => entry.id === id) ?? [];
        if (matches.length !== 1)
          throw new CredentialFailure("authenticator-unavailable");
        const generated = await generateTotpCode(matches[0]);
        assertAccess();
        return {
          code: generated.code,
          expires: generated.expires,
          assertCurrent: () => {
            assertAccess();
            generated.assertCurrent();
          },
        };
      } catch (error) {
        throw toCredentialFailure(error, "code-not-generated");
      } finally {
        result.facets = {};
      }
    },
  };
}
