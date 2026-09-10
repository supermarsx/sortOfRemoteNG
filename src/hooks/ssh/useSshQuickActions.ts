import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import type { ConnectionSession } from "../../types/connection/connection";
import type { QuickActionReference } from "../../types/connection/sessionQuickActions";
import {
  normalizeSessionQuickActions,
  normalizeSshQuickActions,
  MAX_QUICK_ACTION_ITEMS,
  quickActionReferenceKey as key,
  quickActionReferenceScope,
} from "../../utils/connection/sessionQuickActions";
import {
  getDefaultScripts,
  type ManagedScript,
} from "../../components/recording/scriptManager/shared";
import type { TerminalMacro } from "../../types/recording/macroTypes";
import {
  nativeManagedScriptsStore as managedScriptsStore,
  resolveManagedScripts,
} from "../../utils/recording/managedScriptPersistence";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import { TERMINAL_MACROS_STORE_KEY } from "../../utils/recording/terminalMacroPersistence";
import * as macroService from "../../utils/recording/macroService";

interface Options {
  session: ConnectionSession;
  ready: boolean;
  active?: boolean;
  captureSession: () => () => void;
  runScript: (
    script: ManagedScript,
    assertReviewed?: () => Promise<void>,
  ) => Promise<void>;
  replayMacro: (
    macro: TerminalMacro,
    assertReviewed?: () => Promise<void>,
  ) => Promise<void>;
}
export interface SshQuickActionItem extends QuickActionReference {
  name: string;
  description: string;
  missing: boolean;
}

/** Identifier-only connection favorites; library bodies remain in their protected stores. */
export function useSshQuickActions(options: Options) {
  const context = useConnections();
  const { settings } = useSettings();
  const manager = useMemo(() => DatabaseManager.getInstance(), []);
  const ownerId = options.session.ownerDatabaseId;
  const [accessEpoch, setAccessEpoch] = useState(0);
  const [library, setLibrary] = useState<SshQuickActionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const busyRef = useRef(false);
  const generation = useRef(0);
  const current = useRef({ context, options, settings });
  current.current = { context, options, settings };
  const enabled =
    options.session.protocol === "ssh" &&
    normalizeSessionQuickActions(settings.sessionQuickActions).sshEnabled;

  const assertOwner = useCallback(() => {
    if (
      !normalizeSessionQuickActions(
        current.current.settings.sessionQuickActions,
      ).sshEnabled
    )
      throw new Error("SSH quick actions are disabled in Settings.");
    if (!ownerId || manager.getCurrentDatabase()?.id !== ownerId)
      throw new Error(
        "Open the owning database to use this SSH connection's favorites.",
      );
    const target = manager.captureCurrentDatabaseDataTarget();
    if (
      !target ||
      target.databaseId !== ownerId ||
      typeof target.assertAccessible !== "function"
    )
      throw new Error("Unlock the owning database before using favorites.");
    target.assertAccessible();
    const connection = current.current.context.state.connections.find(
      (item) => item.id === current.current.options.session.connectionId,
    );
    if (!connection || connection.isGroup || connection.protocol !== "ssh")
      throw new Error(
        "Favorites require a saved SSH connection in the owning database.",
      );
    return { connection, target };
  }, [manager, ownerId]);

  useEffect(() => {
    const changed = () => {
      generation.current++;
      setLibrary([]);
      setAccessEpoch((value) => value + 1);
    };
    const stopDatabase = manager.onCurrentDatabaseChange(changed);
    const stopAccess = manager.onDatabaseAccessChange?.(changed);
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      invalidate();
      stopDatabase();
      stopAccess?.();
    };
  }, [manager]);

  const configuration = useMemo(() => {
    // Access events invalidate the view even if the private connection did not change.
    void accessEpoch;
    void context.state.connections;
    try {
      if (!enabled) return { references: [], unavailable: null };
      const { connection } = assertOwner();
      return {
        references: normalizeSshQuickActions(connection.sshQuickActions).items,
        unavailable: null,
      };
    } catch (failure) {
      return {
        references: [],
        unavailable:
          failure instanceof Error
            ? failure.message
            : "Favorites unavailable. Reopen the connection settings to repair the configuration.",
      };
    }
  }, [accessEpoch, enabled, assertOwner, context.state.connections]);

  const hasConnection = context.state.connections.some(
    (item) => item.id === options.session.connectionId,
  );
  const readDatabase = useCallback(
    async (databaseId: string) => {
      assertOwner();
      const api = current.current.context.automationLibrary;
      const scope = api?.scope;
      if (
        !api ||
        !scope ||
        scope.databaseId !== databaseId ||
        databaseId !== ownerId
      )
        throw new Error(
          "Open and unlock this favorite's exact owning database. No app-wide substitute was used.",
        );
      const capturedScope = { ...scope };
      const stored = await api.read(capturedScope);
      assertOwner();
      const latestScope = current.current.context.automationLibrary?.scope;
      if (
        !latestScope ||
        latestScope.databaseId !== capturedScope.databaseId ||
        latestScope.generation !== capturedScope.generation
      )
        throw new Error("Database library access changed. Reload favorites.");
      return stored;
    },
    [assertOwner, ownerId],
  );
  const resolveAction = useCallback(
    async (reference: QuickActionReference) => {
      const scope = quickActionReferenceScope(reference);
      if (scope.kind === "database") {
        const stored = await readDatabase(scope.databaseId);
        return reference.kind === "script"
          ? [
              ...stored.terminalScripts.customScripts,
              ...stored.terminalScripts.modifiedDefaults,
            ].find((item) => item.id === reference.id)
          : stored.terminalMacros.find((item) => item.id === reference.id);
      }
      return reference.kind === "script"
        ? resolveManagedScripts(
            getDefaultScripts(),
            (await managedScriptsStore.load()).value,
          ).find((item) => item.id === reference.id)
        : (await macroService.loadMacros()).find(
            (item) => item.id === reference.id,
          );
    },
    [readDatabase],
  );
  const refresh = useCallback(async () => {
    void hasConnection;
    const captured = ++generation.current;
    if (!enabled || options.active === false) {
      setLibrary([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { target } = assertOwner();
      const [scripts, macros, database] = await Promise.all([
        managedScriptsStore.load(),
        macroService.loadMacros(),
        current.current.context.automationLibrary?.scope?.databaseId === ownerId
          ? readDatabase(ownerId!)
          : Promise.resolve(null),
      ]);
      if (captured !== generation.current) return;
      target.assertAccessible?.();
      assertOwner();
      const items: SshQuickActionItem[] = [
        ...resolveManagedScripts(getDefaultScripts(), scripts.value).map(
          (script) => ({
            kind: "script" as const,
            id: script.id,
            name: script.name,
            description: script.description,
            missing: false,
          }),
        ),
        ...macros.map((macro) => ({
          kind: "macro" as const,
          id: macro.id,
          name: macro.name,
          description: macro.description ?? "",
          missing: false,
        })),
      ];
      if (database) {
        const scope = { kind: "database" as const, databaseId: ownerId! };
        items.push(
          ...[
            ...database.terminalScripts.customScripts,
            ...database.terminalScripts.modifiedDefaults,
          ].map((item) => ({
            kind: "script" as const,
            id: item.id,
            name: item.name,
            description: item.description,
            missing: false,
            scope,
          })),
          ...database.terminalMacros.map((item) => ({
            kind: "macro" as const,
            id: item.id,
            name: item.name,
            description: item.description ?? "",
            missing: false,
            scope,
          })),
        );
      }
      setLibrary(items);
    } catch (failure) {
      if (captured !== generation.current) return;
      setLibrary([]);
      setError(
        failure instanceof Error
          ? failure.message
          : "The protected action libraries could not be loaded. Unlock and retry.",
      );
    } finally {
      if (captured === generation.current) setLoading(false);
    }
  }, [
    assertOwner,
    enabled,
    options.active,
    hasConnection,
    ownerId,
    readDatabase,
  ]);

  useEffect(() => {
    void accessEpoch;
    void refresh();
    const changed = (event: Event) => {
      const storeKey = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (
        storeKey === managedScriptsStore.key ||
        storeKey === TERMINAL_MACROS_STORE_KEY
      )
        void refresh();
    };
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      invalidate();
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    };
  }, [
    accessEpoch,
    refresh,
    context.automationLibrary?.changeRevision,
    context.automationLibrary?.scope?.generation,
  ]);

  const mutate = useCallback(
    async (
      transform: (references: QuickActionReference[]) => QuickActionReference[],
    ) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const captured = generation.current;
      try {
        const { connection, target } = assertOwner();
        const expected = normalizeSshQuickActions(connection.sshQuickActions);
        const next = normalizeSshQuickActions({
          version: 1,
          items: transform(expected.items),
        });
        await current.current.context.flushPendingSave();
        target.assertAccessible?.();
        const latest = assertOwner().connection;
        if (
          generation.current !== captured ||
          JSON.stringify(normalizeSshQuickActions(latest.sshQuickActions)) !==
            JSON.stringify(expected)
        )
          throw new Error(
            "Favorites or database changed. Review the action again.",
          );
        await current.current.context.dispatchAndFlush({
          type: "UPDATE_CONNECTION",
          payload: {
            ...latest,
            sshQuickActions: next,
            updatedAt: new Date().toISOString(),
          },
        });
        target.assertAccessible?.();
        assertOwner();
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Favorites were not saved. Retry after unlocking the database.",
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [assertOwner],
  );

  const add = useCallback(
    (reference: QuickActionReference) =>
      mutate((references) => {
        if (references.some((item) => key(item) === key(reference)))
          return references;
        if (references.length >= MAX_QUICK_ACTION_ITEMS)
          throw new Error(
            `A connection supports at most ${MAX_QUICK_ACTION_ITEMS} favorites.`,
          );
        if (!library.some((item) => key(item) === key(reference)))
          throw new Error("Library entry is unavailable. Reload the library.");
        return [
          ...references,
          {
            kind: reference.kind,
            id: reference.id,
            ...(reference.scope ? { scope: reference.scope } : {}),
          },
        ];
      }),
    [library, mutate],
  );
  const remove = useCallback(
    (reference: QuickActionReference) =>
      mutate((references) =>
        references.filter((item) => key(item) !== key(reference)),
      ),
    [mutate],
  );
  const move = useCallback(
    (reference: QuickActionReference, direction: -1 | 1) =>
      mutate((references) => {
        const index = references.findIndex(
          (item) => key(item) === key(reference),
        );
        const destination = index + direction;
        if (index < 0 || destination < 0 || destination >= references.length)
          return references;
        const next = [...references];
        [next[index], next[destination]] = [next[destination], next[index]];
        return next;
      }),
    [mutate],
  );
  const run = useCallback(
    async (reference: QuickActionReference) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const captured = generation.current;
      try {
        const { connection, target } = assertOwner();
        if (
          !normalizeSshQuickActions(connection.sshQuickActions).items.some(
            (item) => key(item) === key(reference),
          )
        )
          throw new Error("This favorite is no longer configured.");
        const assertCurrentSession = current.current.options.captureSession();
        const payload = await resolveAction(reference);
        if (!payload)
          throw new Error(
            "This exact library entry was removed or is unavailable. No substitute was used.",
          );
        const reviewed = JSON.stringify(payload);
        const assertCurrent = () => {
          target.assertAccessible?.();
          const latest = assertOwner().connection;
          if (
            captured !== generation.current ||
            !normalizeSshQuickActions(latest.sshQuickActions).items.some(
              (item) => key(item) === key(reference),
            )
          )
            throw new Error("Favorite or database changed. Reload favorites.");
          assertCurrentSession();
        };
        const assertReviewed = async () => {
          assertCurrent();
          const latest = await resolveAction(reference);
          assertCurrent();
          if (!latest || JSON.stringify(latest) !== reviewed)
            throw new Error(
              "The reviewed library entry changed. Cancelled without substituting or retrying commands.",
            );
        };
        assertCurrent();
        if (reference.kind === "script")
          await current.current.options.runScript(
            payload as ManagedScript,
            assertReviewed,
          );
        else
          await current.current.options.replayMacro(
            payload as TerminalMacro,
            assertReviewed,
          );
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Action could not be run. Reconnect and retry.",
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [assertOwner, resolveAction],
  );

  const favorites = useMemo(() => {
    const byKey = new Map(library.map((item) => [key(item), item]));
    return configuration.references.map(
      (reference) =>
        byKey.get(key(reference)) ?? {
          ...reference,
          name: "Unavailable library entry",
          description:
            "The referenced script or macro was removed or is unavailable.",
          missing: true,
        },
    );
  }, [configuration.references, library]);
  const normalizedQuery = query.trim().toLowerCase();
  return {
    enabled,
    unavailable: configuration.unavailable,
    error,
    busy,
    loading,
    query,
    setQuery,
    favorites,
    available: library.filter(
      (item) =>
        !favorites.some((favorite) => key(favorite) === key(item)) &&
        (!normalizedQuery ||
          `${item.name} ${item.description} ${item.kind}`
            .toLowerCase()
            .includes(normalizedQuery)),
    ),
    visibleFavorites: favorites.filter(
      (item) =>
        !normalizedQuery ||
        `${item.name} ${item.description} ${item.kind}`
          .toLowerCase()
          .includes(normalizedQuery),
    ),
    canRun: options.ready && !busy && !configuration.unavailable && !loading,
    add,
    remove,
    move,
    run,
    refresh,
  };
}
