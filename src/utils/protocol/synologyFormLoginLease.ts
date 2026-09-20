import type { Connection } from "../../types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../types/security/databaseCredentialVault";
import type {
  SynologyRedirectSource,
  SynologyMfaProof,
} from "../session/runtimeConnectionRegistry";
import { DatabaseManager } from "../connection/databaseManager";
import {
  getHttpAutoMfaOrigin,
  normalizeHttpAutoMfa,
} from "../connection/httpAutoMfa";
import { getHttpApplicationProfile } from "../connection/httpApplicationProfiles";
import { invoke } from "@tauri-apps/api/core";
import type { TotpAlgorithm } from "../../types/totp";
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
  let mfaAttempted = false;
  let mfaRevoked = false;
  return {
    revoke: () => {
      revoked = true;
    },
    autoMfaAttempted: () => mfaAttempted,
    revokeAutoMfa: () => {
      mfaRevoked = true;
    },
    assertAutoMfaCurrent: () => {
      if (revoked || mfaRevoked) throw new Error(REVOKED);
    },
    claimAutoMfaAttempt: () => {
      if (revoked || mfaRevoked || mfaAttempted) throw new Error(REVOKED);
      mfaAttempted = true;
    },
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

export interface SynologyMfaContext {
  runtimeConnectionId: string;
  currentUrl: string;
  document: { sessionId: string; url: string };
}

/** Missing/unsupported MFA consent is inert; it must not revoke native login. */
export function hasSynologyAutoMfaConsent(source: Connection): boolean {
  try {
    const config = normalizeHttpAutoMfa(source.httpAutoMfa);
    if (
      source.httpApplication?.id !== "synology-dsm" ||
      source.httpApplication.invalid ||
      source.httpApplication.loginMode !== "form" ||
      !config.enabled ||
      config.challengeId !== "synology-dsm-otp" ||
      getHttpAutoMfaOrigin(source) !== config.origin
    )
      return false;
    return source.credentialSource?.kind === "vault"
      ? source.credentialSource.totpId === config.totpConfigId
      : source.totpConfigs?.filter((entry) => entry.id === config.totpConfigId)
          .length === 1;
  } catch {
    return false;
  }
}

/** MFA only: no credential/source getters and no session impersonation. */
export interface SynologyMfaCapability {
  readonly runtimeConnectionId: string;
  readonly proxySessionId: string;
  assertCurrent: (context: SynologyMfaContext) => void;
  revoke: () => void;
  attempted: () => boolean;
  claim: (context: SynologyMfaContext) => void;
  generate: (
    context: SynologyMfaContext,
    assertAttempt: () => void,
  ) => Promise<{
    code: string;
    expires: number;
    assertCurrent: () => void;
  }>;
}

/** Each disclosure resolves the one saved source and only its selected OTP.
 * The ordinary vault adapter deliberately rejects redirected session targets;
 * this separate boundary accepts only a successfully redeemed native proof. */
export function createSynologyMfaCapability(
  proof: SynologyMfaProof,
  source: SynologyRedirectSource,
  readSource: () => Connection,
  readVault: () => DatabaseCredentialVaultApi | undefined,
): SynologyMfaCapability {
  const lease = source.formLogin!;
  const manager = DatabaseManager.getInstance();
  const target = manager.captureCurrentDatabaseDataTarget();
  const checkSource = (current: Connection) => {
    source.assertOwner();
    if (
      !lease ||
      current.id !== source.savedConnectionId ||
      manager.getCurrentDatabase()?.id !== source.databaseId ||
      target?.databaseId !== source.databaseId ||
      !target.assertAccessible ||
      !target.readCurrent ||
      !target.verifyCurrent
    )
      throw new Error(REVOKED);
    target.assertAccessible();
    lease.assertCurrent(current, readVault());
    lease.assertAutoMfaCurrent();
    const consent = normalizeHttpAutoMfa(current.httpAutoMfa);
    if (
      current.httpApplication?.id !== "synology-dsm" ||
      current.httpApplication.loginMode !== "form" ||
      !consent.enabled ||
      consent.origin !== source.originalOrigin ||
      getHttpAutoMfaOrigin(current) !== consent.origin ||
      consent.challengeId !== "synology-dsm-otp"
    )
      throw new Error(REVOKED);
    return consent;
  };
  const assertCurrent = (context: SynologyMfaContext) => {
    try {
      proof.assertCurrent();
      checkSource(readSource());
      const upstream = new URL(context.currentUrl),
        local = new URL(context.document.url);
      const challenge = getHttpApplicationProfile(
        "synology-dsm",
      )?.totpChallenges?.find((item) => item.id === "synology-dsm-otp");
      if (
        context.runtimeConnectionId !== proof.runtimeConnectionId ||
        context.document.sessionId !== proof.proxySessionId ||
        upstream.protocol !== "https:" ||
        upstream.origin !== proof.origin ||
        upstream.username ||
        upstream.password ||
        local.origin !== proof.proxyOrigin ||
        local.username ||
        local.password ||
        upstream.pathname !== local.pathname ||
        !challenge?.paths.includes(upstream.pathname)
      )
        throw new Error(REVOKED);
    } catch {
      lease?.revokeAutoMfa();
      throw new Error(REVOKED);
    }
  };
  return Object.freeze({
    runtimeConnectionId: proof.runtimeConnectionId,
    proxySessionId: proof.proxySessionId,
    assertCurrent,
    revoke: lease.revokeAutoMfa,
    attempted: lease.autoMfaAttempted,
    claim: (context: SynologyMfaContext) => {
      assertCurrent(context);
      lease.claimAutoMfaAttempt();
    },
    generate: async (
      context: SynologyMfaContext,
      assertAttempt: () => void,
    ) => {
      const check = () => {
        assertAttempt();
        assertCurrent(context);
        if (lease.autoMfaAttempted()) throw new Error(REVOKED);
      };
      const persisted = async () => {
        check();
        await target!.verifyCurrent!();
        check();
        const data = await target!.readCurrent!();
        check();
        const matches =
          data?.connections.filter(
            (item) => item.id === source.savedConnectionId,
          ) ?? [];
        if (matches.length !== 1) throw new Error(REVOKED);
        checkSource(matches[0]);
        return matches[0];
      };
      try {
        const saved = await persisted();
        const consent = checkSource(saved);
        let entries = saved.totpConfigs;
        if (saved.credentialSource?.kind === "vault") {
          const api = readVault();
          const reference = saved.credentialSource;
          if (
            !api?.scope ||
            api.scope.databaseId !== source.databaseId ||
            reference.totpId !== consent.totpConfigId
          )
            throw new Error(REVOKED);
          // Only the original owning vault's explicit selected entry can disclose.
          entries = undefined;
          const snapshot = await api.list({ ...api.scope });
          check();
          if (
            snapshot.scope.databaseId !== api.scope.databaseId ||
            snapshot.scope.generation !== api.scope.generation
          )
            throw new Error(REVOKED);
          const rows = snapshot.entries.filter(
            (row) => row.id === reference.credentialId,
          );
          if (rows.length !== 1 || !rows[0].availableFacets.includes("totp"))
            throw new Error(REVOKED);
          let facets = await api.resolve(snapshot, reference.credentialId, [
            "totp",
          ]);
          try {
            check();
            return await compute(facets.totp);
          } finally {
            facets = {};
          }
        }
        return await compute(entries);

        async function compute(
          entries:
            | readonly {
                id?: string;
                secret: string;
                algorithm: string;
                digits: number;
                period: number;
              }[]
            | undefined,
        ) {
          check();
          const matches =
            entries?.filter((entry) => entry.id === consent.totpConfigId) ?? [];
          if (matches.length !== 1) throw new Error(REVOKED);
          const entry = matches[0];
          if (
            typeof entry.secret !== "string" ||
            !entry.secret ||
            entry.secret.length > 4096 ||
            !["sha1", "sha256", "sha512"].includes(entry.algorithm) ||
            !Number.isInteger(entry.digits) ||
            entry.digits < 6 ||
            entry.digits > 8 ||
            !Number.isInteger(entry.period) ||
            entry.period < 1 ||
            entry.period > 3600
          )
            throw new Error(REVOKED);
          const started = Date.now();
          const expires =
            (Math.floor(started / (entry.period * 1000)) + 1) *
            entry.period *
            1000;
          if (expires - started < 3000) throw new Error(REVOKED);
          const code = await invoke<string>("totp_compute_code", {
            secret: entry.secret,
            algorithm: entry.algorithm.toUpperCase() as TotpAlgorithm,
            digits: entry.digits,
            period: entry.period,
          });
          check();
          await persisted();
          const assertCodeCurrent = () => {
            assertAttempt();
            assertCurrent(context);
            if (Date.now() >= expires - 1000) throw new Error(REVOKED);
          };
          assertCodeCurrent();
          if (!new RegExp(`^\\d{${entry.digits}}$`).test(code))
            throw new Error(REVOKED);
          return { code, expires, assertCurrent: assertCodeCurrent };
        }
      } catch {
        lease.revokeAutoMfa();
        throw new Error(REVOKED);
      }
    },
  });
}
