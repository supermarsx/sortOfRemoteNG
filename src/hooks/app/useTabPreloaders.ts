import { useEffect, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import { useAppDocumentsStore } from "../documents/useAppDocumentsStore";
import { preloadDocuments } from "../documents/documentsCache";
import { preloadCredentialVault } from "../security/credentialVaultCache";
import {
  ensurePreloadLockListener,
  registerTabPreloader,
  warmTabsWhenIdle,
} from "../../utils/preload/tabPreload";

/**
 * Registers the Documents and Credential Vault warmers, then warms them once
 * the app is idle. Hover/focus on their toolbar entries calls the same
 * preloaders through `tabIntentHandlers`.
 *
 * Preloading never unlocks or prompts: both read paths refuse anything that is
 * not already unlocked and verified, and a refusal is swallowed. Caches are
 * dropped on lock (see `ensurePreloadLockListener`).
 */
export function useTabPreloaders(enabled = true): void {
  const { documents, credentialVault } = useConnections();
  const appStore = useAppDocumentsStore();
  const latest = useRef({ documents, credentialVault, appStore });
  latest.current = { documents, credentialVault, appStore };

  useEffect(() => {
    if (!enabled) return;
    ensurePreloadLockListener();
    // Warm the lazily loaded chunks too: the tab then mounts without a network
    // or parse stall.
    const chunks = () => {
      void import("../../components/documents/DocumentsWorkspace").catch(
        () => undefined,
      );
      void import("../../components/security/DatabaseCredentialVault").catch(
        () => undefined,
      );
    };
    const offDocuments = registerTabPreloader("documents", async () => {
      chunks();
      await Promise.all([
        preloadDocuments(latest.current.documents),
        preloadDocuments(latest.current.appStore),
      ]);
    });
    const offVault = registerTabPreloader("credentialVault", async () => {
      chunks();
      const api = latest.current.credentialVault;
      if (api) await preloadCredentialVault(api);
    });
    const offIdle = warmTabsWhenIdle();
    return () => {
      offIdle();
      offDocuments();
      offVault();
    };
  }, [enabled]);

  // Re-warm when the owner changes (database opened/unlocked, app unlocked).
  const vaultKey = credentialVault?.scope
    ? `${credentialVault.scope.databaseId}:${credentialVault.scope.generation}`
    : "";
  const documentsKey = documents?.scope
    ? `${documents.scope.databaseId}:${documents.scope.generation}`
    : "";
  const appKey = appStore?.scope ? "app" : "";
  useEffect(() => {
    if (!enabled || (!vaultKey && !documentsKey && !appKey)) return;
    return warmTabsWhenIdle(5000);
  }, [enabled, vaultKey, documentsKey, appKey]);
}
