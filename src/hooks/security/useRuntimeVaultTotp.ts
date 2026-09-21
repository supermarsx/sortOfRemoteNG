import { useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { VaultTotpFacet } from "../../types/security/databaseCredentialVault";
import type { TotpAlgorithm } from "../../types/totp";
import { runtimeCredentialTargetKey } from "../../utils/security/runtimeCredentialVault";
import { useRuntimeCredentialVault } from "./useRuntimeCredentialVault";
import { totpApi } from "../totp/useTOTP";

export type RuntimeVaultTotpEntry = Omit<VaultTotpFacet, "secret">;
export interface RuntimeVaultTotpController {
  scopeKey: string;
  sourceKind?: "connection" | "vault";
  available: boolean;
  unavailableReason: string;
  load: () => Promise<RuntimeVaultTotpEntry[]>;
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
      throw new Error(
        "This vault authenticator selection is no longer current.",
      );
  };
  const available =
    connection?.credentialSource?.kind === "vault" &&
    !!credentialVault?.scope &&
    databaseAvailability?.status === "ready" &&
    databaseAvailability.databaseId === session.ownerDatabaseId &&
    credentialVault.scope.databaseId === session.ownerDatabaseId;
  const read = async () => {
    assertCurrent();
    if (!available)
      throw new Error(
        "Open and unlock the owning database vault to use its authenticators.",
      );
    const result = await resolve(assertCurrent, false, "totp");
    if (!result) throw new Error("No vault authenticator is selected.");
    result.assertCurrent();
    return result;
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
      try {
        const matches = result.facets.totp!.filter((entry) => entry.id === id);
        if (matches.length !== 1)
          throw new Error("The chosen vault authenticator is unavailable.");
        const entry = matches[0],
          started = Date.now();
        const expires =
          (Math.floor(started / (entry.period * 1000)) + 1) *
          entry.period *
          1000;
        if (expires - started < 3000)
          throw new Error(
            "Wait for the next authenticator time window, then generate a fresh code.",
          );
        const code = await totpApi.computeCode(
          entry.secret,
          entry.algorithm.toUpperCase() as TotpAlgorithm,
          entry.digits,
          entry.period,
        );
        result.assertCurrent();
        if (
          Date.now() >= expires - 1000 ||
          !new RegExp(`^\\d{${entry.digits}}$`).test(code)
        )
          throw new Error("The generated code expired. Generate a fresh code.");
        return {
          code,
          expires,
          assertCurrent: () => {
            result.assertCurrent();
            if (Date.now() >= expires)
              throw new Error("This authenticator code expired.");
          },
        };
      } catch {
        throw new Error(
          "The vault code could not be generated safely. Check database access and try again.",
        );
      } finally {
        result.facets = {};
      }
    },
  };
}
