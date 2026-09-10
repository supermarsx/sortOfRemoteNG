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
  type TrustedRedirectSource,
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
  autoContinue: boolean;
  provenance: TrustedRedirectSource | null;
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
  const revisionState = useRef({ identity: "", number: 0 });

  const inherited = connection
    ? getRuntimeWebNavigation(connection.id)?.trustedRedirectSource
    : undefined;
  const savedId = inherited?.savedConnectionId ?? connection?.id;
  const saved = context.state.connections.find((item) => item.id === savedId);
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
    if (
      !parseHttpRedirectReview(
        review,
        review.sessionId,
        origin,
        runtime.httpProxyPolicy,
      )
    )
      throw new Error(UNAVAILABLE);
    const upstream = getRuntimeWebNavigation(runtime.id)?.trustedRedirectSource;
    const sourceId = upstream?.savedConnectionId ?? runtime.id;
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
    ]);
    let provenance =
      upstream ??
      (established.current?.key === key
        ? established.current.source
        : undefined);
    if (!provenance) {
      const originalIdentity = httpRedirectTrustIdentity(source);
      if (originalIdentity !== runtimeIdentity) throw new Error(UNAVAILABLE);
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
    };
  };

  const inspect = async (
    review: HttpRedirectReview,
    assertCurrent: () => void,
  ): Promise<HttpRedirectTrustInspection> => {
    try {
      const verified = await readVerified(review, assertCurrent);
      if (!verified)
        return {
          trusted: false,
          autoContinue: false,
          provenance: null,
          assertCurrent,
        };
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
      return {
        trusted:
          grantIsSettled &&
          verified.settings.origins.includes(
            new URL(review.destinationUrl).origin,
          ),
        autoContinue: grantIsSettled && verified.settings.autoContinue === true,
        provenance: verified.provenance,
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
  return { canRemember, unavailableReason, revision, inspect, remember };
}
