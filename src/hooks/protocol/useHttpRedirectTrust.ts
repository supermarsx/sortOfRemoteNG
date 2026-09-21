import { useEffect, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import {
  getRuntimeWebNavigation,
  isSynologyMfaProofRetired,
  type TrustedRedirectSource,
  type SynologyRedirectSource,
} from "../../utils/session/runtimeConnectionRegistry";
import {
  parseHttpRedirectReview,
  type HttpRedirectReview,
} from "../../utils/protocol/httpRedirectReview";
import {
  httpRedirectConnectionOrigin,
  httpRedirectTrustIdentity,
} from "../../utils/protocol/httpRedirectTrustIdentity";
import {
  MAX_TRUSTED_REDIRECT_DESTINATIONS,
  normalizeHttpTrustedRedirectDestinations,
} from "../../utils/protocol/httpTrustedRedirectDestinations";
import { stableJsonStringify } from "../../utils/core/stableJsonStringify";
import { normalizeHttpProxyPolicy } from "../../utils/connection/httpProxyPolicy";
import { normalizeSynologySettings } from "../../types/protocols/synology";
import {
  captureSynologyFormLoginLease,
  createSynologyMfaCapability,
  hasSynologyAutoMfaConsent,
  type SynologyMfaCapability,
} from "../../utils/protocol/synologyFormLoginLease";
import {
  isSynologyDefaultRedirect,
  isSynologyDefaultRedirectOrigin,
  synologyRedirectDefaultsForConnection,
  withSynologyRedirectDefaults,
  type SynologyQuickConnectDefaults,
} from "../../utils/protocol/synologyRedirectDefaults";

const UNSAVED =
  "Save this connection in its owning database before remembering redirect destinations. One-time review is still available.";
const UNAVAILABLE =
  "Trusted redirect preferences are unavailable. Open and unlock the original connection's database, then reload and review the redirect.";
const SAVE_FAILED =
  "The trusted destination could not be verified as saved. Restore database access and retry; no automatic continuation was approved.";
const FULL =
  "This connection already has 32 trusted redirect destinations. Remove an unused destination in its HTTP(S) settings before remembering another.";

export interface HttpRedirectTrustInspection {
  trusted: boolean;
  defaultTrusted?: boolean;
  provenance: TrustedRedirectSource | null;
  synologySource?: SynologyRedirectSource;
  assertCurrent: () => void;
  /** After an authorized stop, transport is gone but database authority remains. */
  assertLaunchCurrent?: () => void;
}

/** Database-owned preferences, never a TLS, downgrade or credential grant. */
export function useHttpRedirectTrust(
  session: ConnectionSession,
  connection?: Connection,
) {
  const context = useConnections();
  const latest = useRef({ context, session, connection });
  latest.current = { context, session, connection };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const established = useRef<{
    key: string;
    source: TrustedRedirectSource;
  } | null>(null);
  const writing = useRef(false);
  const defaultSourceRef = useRef<{
    key: string;
    value: SynologyRedirectSource;
  } | null>(null);
  const revisionState = useRef({ identity: "", number: 0 });

  const runtimeNavigation = connection
    ? getRuntimeWebNavigation(connection.id)
    : undefined;
  const inherited = runtimeNavigation?.trustedRedirectSource;
  const inheritedDefault = connection
    ? getRuntimeWebNavigation(connection.id)?.synologyRedirectSource
    : undefined;
  const savedId =
    inherited?.savedConnectionId ??
    inheritedDefault?.savedConnectionId ??
    connection?.id;
  const saved = context.state.connections.find((item) => item.id === savedId);
  let defaults: SynologyQuickConnectDefaults | undefined;
  let defaultSource: SynologyRedirectSource | undefined = inheritedDefault;
  try {
    const availability = context.databaseAvailability;
    if (
      connection &&
      availability?.status === "ready" &&
      availability.databaseId === session.ownerDatabaseId
    ) {
      if (inheritedDefault) {
        inheritedDefault.assertOwner();
        if (inheritedDefault.databaseId !== availability.databaseId)
          throw new Error();
        if (inheritedDefault.savedConnectionId) {
          if (!saved) throw new Error();
          inheritedDefault.formLogin?.assertCurrent(
            saved,
            context.credentialVault,
          );
          inheritedDefault.assertIdentity(saved);
          defaults = synologyRedirectDefaultsForConnection(saved);
        } else if (inheritedDefault.enabled) {
          defaults = {
            version: 1,
            originalOrigin: inheritedDefault.originalOrigin,
          };
        }
        defaultSource = inheritedDefault;
      } else if (!runtimeNavigation || inherited) {
        const source = saved ?? connection;
        if (inherited) {
          inherited.assertOwner();
          if (!saved) throw new Error();
          inherited.assertIdentity(saved);
        } else if (
          saved &&
          httpRedirectTrustIdentity(saved) !==
            httpRedirectTrustIdentity(connection)
        )
          throw new Error();
        const settings = normalizeSynologySettings(source.synologySettings);
        const original = synologyRedirectDefaultsForConnection({
          ...source,
          synologySettings: {
            ...settings,
            useDefaultRedirectDestinations: true,
          },
        });
        defaults =
          settings.useDefaultRedirectDestinations === false
            ? undefined
            : original;
        if (original) {
          const identity = httpRedirectTrustIdentity(source);
          const key = JSON.stringify([
            session.id,
            availability.databaseId,
            availability.generation,
            source.id,
            saved?.id ?? null,
            identity,
            source.credentialSource?.kind === "vault"
              ? [
                  context.credentialVault?.scope,
                  context.credentialVault?.changeRevision,
                ]
              : null,
          ]);
          if (defaultSourceRef.current?.key !== key) {
            defaultSourceRef.current = {
              key,
              value: {
                originalOrigin: original.originalOrigin,
                enabled: settings.useDefaultRedirectDestinations !== false,
                databaseId: availability.databaseId!,
                databaseGeneration: availability.generation,
                savedConnectionId: saved?.id,
                formLogin: saved
                  ? captureSynologyFormLoginLease(
                      source,
                      context.credentialVault,
                    )
                  : undefined,
                assertOwner: captureSessionDatabaseAccess(session),
                assertIdentity: (current) => {
                  if (httpRedirectTrustIdentity(current) !== identity)
                    throw new Error(UNAVAILABLE);
                },
              },
            };
          }
          defaultSource = defaultSourceRef.current.value;
        }
      }
      if (defaults) {
        const currentOrigin = httpRedirectConnectionOrigin(connection);
        if (
          currentOrigin !== defaults.originalOrigin &&
          !isSynologyDefaultRedirectOrigin(
            defaults.originalOrigin,
            currentOrigin,
          )
        )
          throw new Error();
      }
    }
  } catch {
    inheritedDefault?.formLogin?.revoke();
    defaults = undefined;
    // Keep invalidated provenance as an inert marker across an explicit manual
    // handoff; never reinterpret a later portal as a new original NAS source.
    defaultSource = inheritedDefault;
  }
  // Eligibility belongs to the original source, not a later redirect host or
  // the defaults checkbox. This lease changes only the loop bound, never trust.
  const budgetSource = defaultSource;
  const latestBudgetSource = useRef(budgetSource);
  latestBudgetSource.current = budgetSource;
  const assertBudgetCurrent = () => {
    try {
      const current = latest.current;
      const availability = current.context.databaseAvailability;
      if (
        !budgetSource ||
        latestBudgetSource.current !== budgetSource ||
        availability?.status !== "ready" ||
        availability.databaseId !== current.session.ownerDatabaseId ||
        availability.databaseId !== budgetSource.databaseId ||
        (budgetSource.formLogin &&
          availability.generation !== budgetSource.databaseGeneration)
      )
        throw new Error(UNAVAILABLE);
      budgetSource.assertOwner();
      if (budgetSource.savedConnectionId) {
        const originals = current.context.state.connections.filter(
          (item) => item.id === budgetSource.savedConnectionId,
        );
        if (originals.length !== 1) throw new Error(UNAVAILABLE);
        const original = originals[0];
        budgetSource.formLogin?.assertCurrent(
          original,
          current.context.credentialVault,
        );
        budgetSource.assertIdentity(original);
      }
    } catch {
      budgetSource?.formLogin?.revoke();
      throw new Error(UNAVAILABLE);
    }
  };
  let redirectBudget:
    | import("../../utils/protocol/httpRedirectBudget").HttpRedirectBudget
    | undefined;
  try {
    assertBudgetCurrent();
    redirectBudget = {
      profile: "synology",
      assertCurrent: assertBudgetCurrent,
    };
  } catch {
    // Invalid original provenance never upgrades an ordinary website's limit.
  }
  const assertFormLoginCurrent = () => {
    if (!budgetSource?.formLogin) return;
    assertBudgetCurrent();
  };
  const formLoginCurrent = !!budgetSource?.formLogin && !!redirectBudget;
  const mfaRef = useRef<{
    proof: unknown;
    capability: SynologyMfaCapability;
  } | null>(null);
  const proof = runtimeNavigation?.synologyMfaProof;
  let synologyMfa: SynologyMfaCapability | undefined;
  if (
    proof &&
    !isSynologyMfaProofRetired(proof) &&
    inheritedDefault?.formLogin &&
    formLoginCurrent &&
    connection &&
    saved &&
    hasSynologyAutoMfaConsent(saved)
  ) {
    const runtime = connection;
    const source = inheritedDefault;
    const readSource = () => {
      assertBudgetCurrent();
      const current = latest.current;
      const navigation = getRuntimeWebNavigation(runtime.id);
      const origin = httpRedirectConnectionOrigin(runtime);
      if (
        current.connection !== runtime ||
        current.session.connectionId !== runtime.id ||
        navigation !== runtimeNavigation ||
        navigation?.synologyMfaProof !== proof ||
        navigation.synologyRedirectSource !== source ||
        !Number.isSafeInteger(navigation.redirectHops) ||
        navigation.redirectHops < 1 ||
        navigation.redirectHops > 20 ||
        !source.enabled ||
        proof.runtimeConnectionId !== runtime.id ||
        proof.origin !== origin ||
        new URL(navigation.initialUrl).origin !== origin ||
        new URL(origin).protocol !== "https:" ||
        (origin !== source.originalOrigin &&
          !isSynologyDefaultRedirectOrigin(source.originalOrigin, origin))
      )
        throw new Error(UNAVAILABLE);
      const matches = current.context.state.connections.filter(
        (item) => item.id === source.savedConnectionId,
      );
      if (matches.length !== 1) throw new Error(UNAVAILABLE);
      return matches[0];
    };
    try {
      proof.assertCurrent();
      readSource();
      if (mfaRef.current?.proof !== proof) {
        mfaRef.current = {
          proof,
          capability: createSynologyMfaCapability(
            proof,
            source,
            readSource,
            () => latest.current.context.credentialVault,
          ),
        };
      }
      synologyMfa = mfaRef.current.capability;
    } catch {
      // Source/DB/vault failures revoke through assertBudgetCurrent and the
      // source lease. A stale proxy/runtime proof only disables this capability.
    }
  }
  const latestDefaults = useRef({ defaults, source: defaultSource });
  latestDefaults.current = { defaults, source: defaultSource };
  let canRemember = false;
  let unavailableReason = UNSAVED;
  let identity = "unavailable";
  try {
    const availability = context.databaseAvailability;
    if (saved && connection) {
      unavailableReason = UNAVAILABLE;
      if (
        availability?.status === "ready" &&
        availability.databaseId === session.ownerDatabaseId &&
        (!inherited || inherited.databaseId === availability.databaseId)
      ) {
        inherited?.assertOwner();
        inherited?.assertIdentity(saved);
        if (
          !inherited &&
          !inheritedDefault &&
          httpRedirectTrustIdentity(saved) !==
            httpRedirectTrustIdentity(connection)
        )
          throw new Error();
        const preferences = normalizeHttpTrustedRedirectDestinations(
          saved.httpTrustedRedirectDestinations,
        );
        identity = JSON.stringify([
          availability.databaseId,
          availability.generation,
          saved.id,
          httpRedirectTrustIdentity(saved),
          preferences,
          defaults,
        ]);
        canRemember =
          preferences.origins.length < MAX_TRUSTED_REDIRECT_DESTINATIONS;
        unavailableReason = canRemember ? "" : FULL;
      }
    }
  } catch {
    unavailableReason = UNAVAILABLE;
  }
  if (revisionState.current.identity !== identity) {
    revisionState.current = {
      identity,
      number: revisionState.current.number + 1,
    };
  }
  // Never expose the private identity comparison (which includes credentials).
  const revision = String(revisionState.current.number);

  const readVerified = async (
    review: HttpRedirectReview,
    receiptGuard: () => void,
  ) => {
    receiptGuard();
    const captured = latest.current;
    const runtime = captured.connection;
    if (!runtime) throw new Error(UNAVAILABLE);
    const origin = httpRedirectConnectionOrigin(runtime);
    const capturedDefaults = latestDefaults.current;
    if (
      !parseHttpRedirectReview(
        review,
        review.sessionId,
        origin,
        withSynologyRedirectDefaults(
          normalizeHttpProxyPolicy(runtime.httpProxyPolicy),
          capturedDefaults.defaults,
        ),
      )
    )
      throw new Error(UNAVAILABLE);
    const upstream = getRuntimeWebNavigation(runtime.id)?.trustedRedirectSource;
    const defaultProvenance = capturedDefaults.source;
    const sourceId =
      upstream?.savedConnectionId ??
      defaultProvenance?.savedConnectionId ??
      runtime.id;
    const source = captured.context.state.connections.find(
      (item) => item.id === sourceId,
    );
    if (!source && !upstream) return null;
    if (!source) throw new Error(UNAVAILABLE);
    const available = captured.context.databaseAvailability;
    const manager = DatabaseManager.getInstance();
    const target = manager.captureCurrentDatabaseDataTarget();
    const runtimeIdentity = httpRedirectTrustIdentity(runtime);
    const key = JSON.stringify([
      captured.session.id,
      captured.session.ownerDatabaseId,
      available?.generation,
      runtime.id,
      httpRedirectTrustIdentity(source),
    ]);
    let provenance =
      upstream ??
      (established.current?.key === key
        ? established.current.source
        : undefined);
    if (!provenance) {
      const originalIdentity = httpRedirectTrustIdentity(source);
      if (!defaultProvenance && originalIdentity !== runtimeIdentity)
        throw new Error(UNAVAILABLE);
      defaultProvenance?.assertOwner();
      defaultProvenance?.assertIdentity(source);
      provenance = {
        databaseId: captured.session.ownerDatabaseId ?? "",
        savedConnectionId: source.id,
        originalOrigin: httpRedirectConnectionOrigin(source),
        assertOwner: captureSessionDatabaseAccess(captured.session),
        assertIdentity: (current) => {
          if (httpRedirectTrustIdentity(current) !== originalIdentity)
            throw new Error(UNAVAILABLE);
        },
      };
    }
    const owner = provenance;
    const checkAuthority = () => {
      owner.assertOwner();
      const current = latest.current;
      if (
        !available ||
        available.status !== "ready" ||
        available.databaseId !== owner.databaseId ||
        current.context.databaseAvailability?.status !== "ready" ||
        current.context.databaseAvailability.generation !==
          available.generation ||
        current.context.databaseAvailability.databaseId !== owner.databaseId ||
        current.session.ownerDatabaseId !== owner.databaseId ||
        current.session.id !== captured.session.id ||
        manager.getCurrentDatabase()?.id !== owner.databaseId ||
        target?.databaseId !== owner.databaseId ||
        !target.assertAccessible ||
        !target.readCurrent ||
        !current.connection ||
        httpRedirectTrustIdentity(current.connection) !== runtimeIdentity
      )
        throw new Error(UNAVAILABLE);
      target.assertAccessible();
      const currentSource = current.context.state.connections.find(
        (item) => item.id === owner.savedConnectionId,
      );
      if (!currentSource) throw new Error(UNAVAILABLE);
      owner.assertIdentity(currentSource);
      if (httpRedirectConnectionOrigin(currentSource) !== owner.originalOrigin)
        throw new Error(UNAVAILABLE);
      return currentSource;
    };
    const check = () => {
      receiptGuard();
      return checkAuthority();
    };
    check();
    const data = await target!.readCurrent!();
    check();
    const persisted = data?.connections.find(
      (item) => item.id === owner.savedConnectionId,
    );
    if (!persisted) throw new Error(UNAVAILABLE);
    owner.assertIdentity(persisted);
    const settings = normalizeHttpTrustedRedirectDestinations(
      persisted.httpTrustedRedirectDestinations,
    );
    if (!upstream) established.current = { key, source: owner };
    return {
      provenance: owner,
      check,
      checkAuthority,
      settings,
      target: target!,
      persisted,
      defaultProvenance,
    };
  };

  const inspect = async (
    review: HttpRedirectReview,
    assertCurrent: () => void,
  ): Promise<HttpRedirectTrustInspection> => {
    try {
      const verified = await readVerified(review, assertCurrent);
      if (!verified) {
        const captured = latest.current;
        const capturedDefaults = latestDefaults.current;
        const source = capturedDefaults.source;
        const runtime = captured.connection;
        if (
          source &&
          !source.savedConnectionId &&
          runtime &&
          capturedDefaults.defaults
        ) {
          const identity = httpRedirectTrustIdentity(runtime);
          const checkOwner = () => {
            source.assertOwner();
            if (
              latestDefaults.current.source !== source ||
              !latest.current.connection ||
              latest.current.session.id !== captured.session.id ||
              latest.current.session.ownerDatabaseId !== source.databaseId ||
              httpRedirectTrustIdentity(latest.current.connection) !== identity
            )
              throw new Error(UNAVAILABLE);
          };
          const check = () => {
            assertCurrent();
            checkOwner();
          };
          check();
          const defaultTrusted = isSynologyDefaultRedirect(
            withSynologyRedirectDefaults(
              normalizeHttpProxyPolicy(runtime.httpProxyPolicy),
              capturedDefaults.defaults,
            ),
            review.sourceOrigin,
            review.destinationUrl,
          );
          return {
            trusted: defaultTrusted,
            defaultTrusted,
            provenance: null,
            synologySource: source,
            assertCurrent: check,
            assertLaunchCurrent: () => {
              if (!mounted.current) throw new Error(UNAVAILABLE);
              checkOwner();
            },
          };
        }
        return {
          trusted: false,
          provenance: null,
          synologySource: source,
          assertCurrent,
        };
      }
      const grantIdentity = stableJsonStringify(
        normalizeHttpTrustedRedirectDestinations(
          verified.check().httpTrustedRedirectDestinations,
        ),
      );
      const grantIsSettled =
        grantIdentity === stableJsonStringify(verified.settings);
      const checkGrant = (current: Connection) => {
        if (
          stableJsonStringify(
            normalizeHttpTrustedRedirectDestinations(
              current.httpTrustedRedirectDestinations,
            ),
          ) !== grantIdentity
        )
          throw new Error(UNAVAILABLE);
      };
      const defaultTrusted =
        grantIsSettled &&
        isSynologyDefaultRedirect(
          withSynologyRedirectDefaults(
            normalizeHttpProxyPolicy(
              latest.current.connection?.httpProxyPolicy,
            ),
            verified.defaultProvenance
              ? synologyRedirectDefaultsForConnection(verified.persisted)
              : undefined,
          ),
          review.sourceOrigin,
          review.destinationUrl,
        );
      return {
        trusted:
          grantIsSettled &&
          (defaultTrusted ||
            verified.settings.origins.includes(
              new URL(review.destinationUrl).origin,
            )),
        defaultTrusted,
        provenance: verified.provenance,
        synologySource: verified.defaultProvenance,
        assertCurrent: () => checkGrant(verified.check()),
        assertLaunchCurrent: () => {
          // Automatic current-tab handoff is synchronous before source unmount.
          // After unmount React no longer refreshes this Context snapshot. The
          // reference-only provenance intentionally has no mount dependency.
          if (!mounted.current) throw new Error(UNAVAILABLE);
          checkGrant(verified.checkAuthority());
        },
      };
    } catch {
      throw new Error(UNAVAILABLE);
    }
  };

  const remember = async (
    review: HttpRedirectReview,
    assertCurrent: () => void,
  ): Promise<void> => {
    if (writing.current)
      throw new Error("A trusted destination save is already in progress.");
    writing.current = true;
    try {
      const initial = await readVerified(review, assertCurrent);
      if (!initial) throw new Error(UNSAVED);
      initial.check();
      await latest.current.context.flushPendingSave();
      initial.check();
      // Flush can publish unrelated legitimate drafts; re-read without blessing
      // the Provider's content-CAS baseline or reviving a replaced owner lease.
      const verified = await readVerified(review, assertCurrent);
      if (!verified) throw new Error(UNAVAILABLE);
      const current = verified.check();
      if (
        stableJsonStringify(
          normalizeHttpTrustedRedirectDestinations(
            current.httpTrustedRedirectDestinations,
          ),
        ) !== stableJsonStringify(verified.settings)
      )
        throw new Error(SAVE_FAILED);
      const origin = new URL(review.destinationUrl).origin;
      if (
        !verified.settings.origins.includes(origin) &&
        verified.settings.origins.length >= MAX_TRUSTED_REDIRECT_DESTINATIONS
      )
        throw new Error(FULL);
      const settings = normalizeHttpTrustedRedirectDestinations({
        ...verified.settings,
        origins: verified.settings.origins.includes(origin)
          ? verified.settings.origins
          : [...verified.settings.origins, origin],
      });
      const expectedGrant = stableJsonStringify(settings);
      const assertSavedGrantCurrent = () => {
        const latestSource = verified.check();
        if (
          stableJsonStringify(
            normalizeHttpTrustedRedirectDestinations(
              latestSource.httpTrustedRedirectDestinations,
            ),
          ) !== expectedGrant
        )
          throw new Error(SAVE_FAILED);
      };
      await latest.current.context.dispatchAndFlush({
        type: "UPDATE_CONNECTION",
        payload: { ...current, httpTrustedRedirectDestinations: settings },
      });
      assertSavedGrantCurrent();
      const readBack = await verified.target.readCurrent!();
      assertSavedGrantCurrent();
      const persisted = readBack?.connections.find(
        (item) => item.id === verified.provenance.savedConnectionId,
      );
      if (!persisted) throw new Error(UNAVAILABLE);
      verified.provenance.assertIdentity(persisted);
      if (
        stableJsonStringify(
          normalizeHttpTrustedRedirectDestinations(
            persisted.httpTrustedRedirectDestinations,
          ),
        ) !== expectedGrant
      )
        throw new Error(SAVE_FAILED);
    } catch (error) {
      throw new Error(
        error instanceof Error && [UNSAVED, FULL].includes(error.message)
          ? error.message
          : SAVE_FAILED,
      );
    } finally {
      writing.current = false;
    }
  };
  return {
    canRemember,
    unavailableReason,
    revision,
    inspect,
    remember,
    defaults,
    defaultSource,
    formLoginCurrent,
    assertFormLoginCurrent,
    ...(synologyMfa ? { synologyMfa } : {}),
    ...(redirectBudget ? { redirectBudget } : {}),
  };
}
