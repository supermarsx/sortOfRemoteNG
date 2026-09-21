import type { Connection } from "../../types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../types/security/databaseCredentialVault";
import {
  isSynologyMfaProofRetired,
  type SynologyRedirectSource,
  type SynologyMfaProof,
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
import type {
  RuntimeVaultTotpController,
  RuntimeVaultTotpEntry,
} from "../../hooks/security/useRuntimeVaultTotp";

export interface SynologyManualTotpController extends RuntimeVaultTotpController {
  assertCurrent: () => void;
  revoke: () => void;
}

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

/** Manual disclosure only. The caller binds readSource to an accepted same-tab
 * navigation; neither a proxy MFA proof nor automatic-submission consent is used.
 * All private values stay in operation-local variables, never in the facade. */
export function createSynologyManualTotpController(
  source: SynologyRedirectSource,
  readSource: () => Connection,
  readVault: () => DatabaseCredentialVaultApi | undefined,
): SynologyManualTotpController {
  const lease = source.formLogin;
  const databaseId = source.databaseId;
  const savedConnectionId = source.savedConnectionId;
  const originalOrigin = source.originalOrigin;
  const manager = DatabaseManager.getInstance();
  const target = manager.captureCurrentDatabaseDataTarget();
  const scopeKey = `synology-manual-totp:${crypto.randomUUID()}`;
  let revoked = false;
  let vaultRevision: number | undefined;
  const revoke = () => {
    // Manual-panel cancellation must not consume or revoke automatic MFA.
    revoked = true;
  };
  const checkSource = (current: Connection) => {
    if (
      !lease ||
      source.formLogin !== lease ||
      source.databaseId !== databaseId ||
      source.savedConnectionId !== savedConnectionId ||
      source.originalOrigin !== originalOrigin ||
      !savedConnectionId ||
      current.id !== savedConnectionId ||
      current.httpApplication?.id !== "synology-dsm" ||
      current.httpApplication.invalid ||
      current.httpApplication.loginMode !== "form"
    )
      throw new Error(REVOKED);
    lease.assertCurrent(current, readVault());
    source.assertIdentity(current);
  };
  const guard = <T>(operation: () => T): T => {
    try {
      if (revoked) throw new Error(REVOKED);
      return operation();
    } catch {
      revoke();
      throw new Error(REVOKED);
    }
  };
  const assertCurrent = () =>
    guard(() => {
      source.assertOwner();
      if (
        manager.getCurrentDatabase()?.id !== databaseId ||
        target?.databaseId !== databaseId ||
        !target.assertAccessible ||
        !target.verifyCurrent ||
        !target.readCurrent
      )
        throw new Error(REVOKED);
      target.assertAccessible();
      checkSource(readSource());
    });
  const persisted = async () => {
    assertCurrent();
    await target!.verifyCurrent!();
    assertCurrent();
    const data = await target!.readCurrent!();
    assertCurrent();
    const matches =
      data?.connections.filter((entry) => entry.id === savedConnectionId) ?? [];
    return guard(() => {
      if (matches.length !== 1) throw new Error(REVOKED);
      checkSource(matches[0]);
      return matches[0];
    });
  };
  type Entry = RuntimeVaultTotpEntry & { secret: string };
  const readEntries = async (): Promise<Entry[]> => {
    try {
      const saved = await persisted();
      let entries: Entry[];
      if (saved.credentialSource?.kind === "vault") {
        const reference = saved.credentialSource;
        const api = readVault();
        const scope = api?.scope ? { ...api.scope } : null;
        if (!api || scope?.databaseId !== databaseId) throw new Error(REVOKED);
        const snapshot = await api.list(scope);
        assertCurrent();
        if (
          snapshot.scope.databaseId !== scope.databaseId ||
          snapshot.scope.generation !== scope.generation ||
          !Number.isSafeInteger(snapshot.revision) ||
          snapshot.revision < 0 ||
          (vaultRevision !== undefined && snapshot.revision !== vaultRevision)
        )
          throw new Error(REVOKED);
        vaultRevision = snapshot.revision;
        const rows = snapshot.entries.filter(
          (entry) => entry.id === reference.credentialId,
        );
        if (rows.length !== 1 || !rows[0].availableFacets.includes("totp"))
          throw new Error(REVOKED);
        let facets = await api.resolve(snapshot, reference.credentialId, [
          "totp",
        ]);
        try {
          assertCurrent();
          const selected = reference.totpId
            ? facets.totp?.filter((entry) => entry.id === reference.totpId)
            : facets.totp;
          if (!selected || (reference.totpId && selected.length !== 1))
            throw new Error(REVOKED);
          // Explicit allowlist: an over-returning backend cannot leak other facets.
          entries = selected.map(
            ({ id, label, secret, digits, algorithm, period }) => ({
              id,
              label,
              secret,
              digits,
              algorithm,
              period,
            }),
          );
        } finally {
          facets = {};
        }
      } else {
        entries = (saved.totpConfigs ?? []).map((entry, index) => ({
          id: entry.id ?? `legacy-${index}`,
          label: [entry.issuer, entry.account].filter(Boolean).join(" — "),
          secret: entry.secret,
          digits: entry.digits as Entry["digits"],
          algorithm: entry.algorithm,
          period: entry.period,
        }));
      }
      const ids = new Set<string>();
      for (const entry of entries) {
        if (
          typeof entry.id !== "string" ||
          !entry.id ||
          ids.has(entry.id) ||
          typeof entry.label !== "string" ||
          typeof entry.secret !== "string" ||
          !entry.secret ||
          entry.secret.length > 4096 ||
          !["sha1", "sha256", "sha512"].includes(entry.algorithm) ||
          ![6, 8].includes(entry.digits) ||
          !Number.isInteger(entry.period) ||
          entry.period < 1 ||
          entry.period > 3600
        )
          throw new Error(REVOKED);
        ids.add(entry.id);
      }
      // Recheck durable source selection after vault disclosure, not just React.
      await persisted();
      return entries;
    } catch {
      revoke();
      throw new Error(REVOKED);
    }
  };
  const metadata = (entry: Entry, index: number): RuntimeVaultTotpEntry => ({
    // Opaque, controller-local handles also support legacy local entries with no ID.
    id: `${scopeKey}:${index}`,
    label: entry.label,
    digits: entry.digits,
    algorithm: entry.algorithm,
    period: entry.period,
  });
  assertCurrent();
  const sourceKind = guard(() => {
    const current = readSource();
    checkSource(current);
    return current.credentialSource?.kind === "vault" ? "vault" : "connection";
  });
  return Object.freeze({
    scopeKey,
    sourceKind,
    get available() {
      try {
        assertCurrent();
        return true;
      } catch {
        return false;
      }
    },
    get unavailableReason() {
      return this.available ? "" : REVOKED;
    },
    assertCurrent,
    revoke,
    load: async () => {
      let entries = await readEntries();
      try {
        assertCurrent();
        return entries.map(metadata);
      } finally {
        entries = [];
      }
    },
    generate: async (id: string) => {
      let entries = await readEntries();
      try {
        assertCurrent();
        const entry = entries.find(
          (item, index) => metadata(item, index).id === id,
        );
        if (!entry) throw new Error("The chosen authenticator is unavailable.");
        const started = Date.now();
        const expires =
          (Math.floor(started / (entry.period * 1000)) + 1) *
          entry.period *
          1000;
        if (expires - started < 3000)
          throw new Error(
            "Wait for the next authenticator time window, then generate a fresh code.",
          );
        let code: string;
        try {
          code = await invoke<string>("totp_compute_code", {
            secret: entry.secret,
            algorithm: entry.algorithm.toUpperCase() as TotpAlgorithm,
            digits: entry.digits,
            period: entry.period,
          });
          assertCurrent();
          await persisted();
        } catch {
          revoke();
          throw new Error(REVOKED);
        }
        const assertCodeCurrent = () => {
          assertCurrent();
          if (Date.now() >= expires)
            throw new Error("This authenticator code expired.");
        };
        assertCodeCurrent();
        if (
          Date.now() >= expires - 1000 ||
          !new RegExp(`^\\d{${entry.digits}}$`).test(code)
        )
          throw new Error(
            "The generated code expired or was invalid. Generate a fresh code.",
          );
        return { code, expires, assertCurrent: assertCodeCurrent };
      } finally {
        entries = [];
      }
    },
  });
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
  let retired = false;
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
    // Expected handoff invalidates this capability, not the shared source lease.
    if (retired || isSynologyMfaProofRetired(proof)) throw new Error(REVOKED);
    let current: Connection;
    try {
      proof.assertCurrent();
      current = readSource();
    } catch {
      // readSource's budget check owns chain-wide source/DB/vault revocation.
      retired = true;
      throw new Error(REVOKED);
    }
    try {
      checkSource(current);
    } catch {
      lease?.revokeAutoMfa();
      throw new Error(REVOKED);
    }
    try {
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
      retired = true;
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
      const assertLiveAttempt = () => {
        try {
          assertAttempt();
        } catch {
          retired = true;
          throw new Error(REVOKED);
        }
      };
      const check = () => {
        assertLiveAttempt();
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
            assertLiveAttempt();
            assertCurrent(context);
            if (Date.now() >= expires - 1000) throw new Error(REVOKED);
          };
          assertCodeCurrent();
          if (!new RegExp(`^\\d{${entry.digits}}$`).test(code))
            throw new Error(REVOKED);
          return { code, expires, assertCurrent: assertCodeCurrent };
        }
      } catch {
        // A pending generation can finish after its reviewed proxy handoff.
        if (!retired && !isSynologyMfaProofRetired(proof))
          lease.revokeAutoMfa();
        throw new Error(REVOKED);
      }
    },
  });
}
