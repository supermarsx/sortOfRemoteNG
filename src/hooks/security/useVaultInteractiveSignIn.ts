import { useEffect, useRef, useState } from "react";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { DatabaseCredentialFacets } from "../../types/security/databaseCredentialVault";
import { useRuntimeCredentialVault } from "./useRuntimeCredentialVault";
import { getHttpApplicationExternalTarget } from "../../utils/auth/httpApplicationExternal";
import { runtimeCredentialTargetKey } from "../../utils/security/runtimeCredentialVault";
import { getInvoke } from "../../utils/tauri/invoke";

export interface VaultSignInBinding {
  id: string;
  kind: "social" | "passkey";
  provider: string;
  accountHint?: string;
  authority: string;
  available: boolean;
  reason: string;
}
async function choices(
  facets: DatabaseCredentialFacets,
  target: string,
): Promise<VaultSignInBinding[]> {
  const { vaultPasskeyMatchesHost } =
    await import("../../utils/security/vaultPasskeyAuthority");
  const origin = new URL(target);
  return [
    ...(facets.social ?? []).map((row) => ({
      id: row.id,
      kind: "social" as const,
      provider: row.provider,
      accountHint: row.accountHint,
      authority: row.origin,
      available: row.origin === origin.origin,
      reason:
        row.origin === origin.origin
          ? ""
          : "This binding starts at another website origin. Edit the binding or open its own saved connection.",
    })),
    ...(facets.passkey ?? []).map((row) => ({
      id: row.id,
      kind: "passkey" as const,
      provider: row.provider,
      accountHint: row.accountHint,
      authority: row.rpId,
      available: vaultPasskeyMatchesHost(row.rpId, origin.hostname),
      reason: vaultPasskeyMatchesHost(row.rpId, origin.hostname)
        ? ""
        : "This relying-party ID is not the saved website or its valid parent domain. Use a matching saved connection; the browser and authenticator perform the final checks.",
    })),
  ];
}

/** Explicit browser handoff only: never transfers cookies, passwords or key material. */
export function useVaultInteractiveSignIn(
  session: ConnectionSession,
  connection: Connection | undefined,
  sessionTarget: string,
) {
  const resolve = useRuntimeCredentialVault(session, connection);
  const target = getHttpApplicationExternalTarget(connection, sessionTarget);
  const identity = JSON.stringify([
    session.id,
    session.connectionId,
    session.ownerDatabaseId,
    runtimeCredentialTargetKey(connection ?? {}),
    sessionTarget,
  ]);
  const latest = useRef({ identity, target, resolve });
  latest.current = { identity, target, resolve };
  const alive = useRef(true),
    epoch = useRef(0),
    pending = useRef(false);
  const [state, setState] = useState<{
    identity: string;
    rows: VaultSignInBinding[];
    open: boolean;
    error: string | null;
    notice: string | null;
  }>({ identity, rows: [], open: false, error: null, notice: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current += 1;
    };
  }, []);
  const visible =
    state.identity === identity
      ? state
      : { identity, rows: [], open: false, error: null, notice: null };
  const capture = () => {
    const sequence = ++epoch.current;
    return () => {
      if (
        !alive.current ||
        latest.current.identity !== identity ||
        epoch.current !== sequence ||
        latest.current.target?.url !== target?.url
      )
        throw new Error("Sign-in context changed.");
    };
  };
  const load = async () => {
    if (pending.current) return;
    const assert = capture();
    const capturedEpoch = epoch.current;
    pending.current = true;
    setBusy(true);
    setState({ identity, rows: [], open: true, error: null, notice: null });
    let resolved: Awaited<ReturnType<typeof resolve>> = null;
    try {
      if (!target) throw new Error("HTTPS target required.");
      assert();
      resolved = await resolve(assert, false, "bindings");
      assert();
      resolved?.assertCurrent();
      if (!resolved) throw new Error("Select a vault binding.");
      const rows = await choices(resolved.facets, target.url);
      assert();
      resolved.assertCurrent();
      resolved.facets = {};
      assert();
      setState({
        identity,
        rows,
        open: true,
        error: rows.length
          ? null
          : "No social sign-in or passkey bindings are saved for this credential. Add a binding in the database credential vault.",
        notice: null,
      });
    } catch {
      if (
        alive.current &&
        latest.current.identity === identity &&
        epoch.current === capturedEpoch
      )
        setState({
          identity,
          rows: [],
          open: true,
          error: target
            ? "Bindings could not be read. Unlock the owning database and review the selected vault credential."
            : "Interactive vault sign-in requires a saved HTTPS website at its original origin. No browser or credential fallback was used.",
          notice: null,
        });
    } finally {
      if (resolved) resolved.facets = {};
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const openBinding = async (row: VaultSignInBinding) => {
    if (
      pending.current ||
      !row.available ||
      !visible.rows.some((item) => JSON.stringify(item) === JSON.stringify(row))
    )
      return;
    const assert = capture();
    const capturedEpoch = epoch.current;
    pending.current = true;
    setBusy(true);
    let resolved: Awaited<ReturnType<typeof resolve>> = null;
    try {
      if (!target) throw new Error("Target unavailable.");
      assert();
      resolved = await resolve(assert, false, "bindings");
      assert();
      resolved?.assertCurrent();
      const current = (await choices(resolved?.facets ?? {}, target.url)).find(
        (item) => item.kind === row.kind && item.id === row.id,
      );
      assert();
      resolved?.assertCurrent();
      if (resolved) resolved.facets = {};
      if (
        !resolved ||
        !current?.available ||
        JSON.stringify(current) !== JSON.stringify(row)
      )
        throw new Error("Binding changed.");
      const invoke = await getInvoke();
      assert();
      resolved.assertCurrent();
      if (!invoke) throw new Error("Native browser handoff unavailable.");
      await invoke("open_url_external", { url: target.url });
      assert();
      resolved.assertCurrent();
      setState((previous) => ({
        ...previous,
        error: null,
        notice:
          "Opened the original website in your browser. Complete sign-in with its provider or authenticator. This does not sign in the embedded tab.",
      }));
    } catch {
      if (
        alive.current &&
        latest.current.identity === identity &&
        epoch.current === capturedEpoch
      )
        setState((previous) => ({
          ...previous,
          error:
            "The browser handoff could not be completed or the binding changed. Reload the bindings and use a compatible browser/authenticator; no local credentials were substituted.",
          notice: null,
        }));
    } finally {
      if (resolved) resolved.facets = {};
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return {
    ...visible,
    busy,
    target: target?.url ?? null,
    load,
    openBinding,
    close: () => {
      epoch.current += 1;
      setState({ identity, rows: [], open: false, error: null, notice: null });
    },
  };
}
