import type { Connection } from "../../types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../types/security/databaseCredentialVault";
import type { SynologyRedirectSource } from "../session/runtimeConnectionRegistry";
import { resolveHttpApplicationLogin } from "../auth/httpApplicationLogin";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { httpRedirectTrustIdentity } from "./httpRedirectTrustIdentity";

const REVOKED =
  "The original Synology login or credential access changed. Reload the original saved connection to start a new login attempt.";

/** A private comparison, not credentials for a destination or a vault resolve. */
function identity(source: Connection): string {
  return stableJsonStringify([
    httpRedirectTrustIdentity(source),
    source.httpTrustedRedirectDestinations ?? null,
  ]);
}

export function captureSynologyFormLoginLease(
  source: Connection,
  vault: DatabaseCredentialVaultApi | undefined,
): SynologyRedirectSource["formLogin"] {
  const login = resolveHttpApplicationLogin(source);
  if (
    source.httpApplication?.id !== "synology-dsm" ||
    login.loginFlow !== "synology" ||
    !login.autoLogin
  )
    return undefined;
  const originalIdentity = identity(source);
  const usesVault = source.credentialSource?.kind === "vault";
  const scope = usesVault && vault?.scope ? { ...vault.scope } : null;
  const revision = usesVault ? vault?.changeRevision : undefined;
  if (usesVault && !scope) throw new Error(REVOKED);
  let revoked = false;
  return {
    assertCurrent(current, currentVault) {
      try {
        if (
          revoked ||
          identity(current) !== originalIdentity ||
          (usesVault &&
            (!currentVault?.scope ||
              currentVault.scope.databaseId !== scope!.databaseId ||
              currentVault.scope.generation !== scope!.generation ||
              currentVault.changeRevision !== revision))
        )
          throw new Error(REVOKED);
      } catch {
        // An observed ABA must not re-arm an already cancelled native intent.
        revoked = true;
        throw new Error(REVOKED);
      }
    },
  };
}
