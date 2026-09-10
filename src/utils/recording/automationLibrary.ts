import type {
  AutomationEntry,
  AutomationFamily,
  AutomationLibraryApi,
  AutomationLibraryChange,
  AutomationLibrarySnapshot,
  AutomationScope,
  DatabaseAutomationApi,
  DatabaseAutomationLibrary,
  DatabaseAutomationScope,
  AutomationProvenance,
} from "../../types/recording/automationLibrary";
import { defaultScripts } from "../../data/defaultScripts";
import { getInvoke } from "../tauri/invoke";
import {
  nativeManagedScriptsStore as managedScriptsStore,
  resolveManagedScripts,
  buildManagedScriptsSnapshot,
} from "./managedScriptPersistence";
import {
  loadTerminalMacros,
  terminalMacrosStore,
} from "./terminalMacroPersistence";
import {
  EMPTY_WEB_AUTOMATION_LIBRARY,
  webAutomationStore,
  normalizeWebAutomationLibrary,
} from "./webAutomationLibrary";
import {
  normalizeAutomationEntry,
  normalizeDatabaseAutomationLibrary,
} from "./automationLibraryValidation";
import { AutomationLibraryAccessError } from "./automationLibraryAccess";
import { hasAutomationControlCharacters } from "./automationProvenance";

const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const fail = (
  code:
    "conflict" | "access-changed" | "database-unavailable" | "desktop-required",
  message: string,
): never => {
  throw new AutomationLibraryAccessError({ code, message, retryable: true });
};
function validateScope(scope: AutomationScope): AutomationScope {
  if (scope?.kind === "app" && Object.keys(scope).length === 1)
    return { kind: "app" };
  if (
    scope?.kind === "database" &&
    Object.keys(scope).length === 2 &&
    typeof scope.databaseId === "string" &&
    scope.databaseId.length > 0 &&
    scope.databaseId.length <= 256 &&
    !hasAutomationControlCharacters(scope.databaseId, false)
  )
    return { kind: "database", databaseId: scope.databaseId };
  return fail(
    "database-unavailable",
    "The requested library scope is invalid. Select its owning database explicitly.",
  );
}
function entries(
  family: AutomationFamily,
  payloads: readonly unknown[],
  provenance: Record<string, AutomationProvenance> = {},
): AutomationEntry[] {
  return payloads.map((payload) => {
    const normalized = normalizeAutomationEntry({ family, payload });
    const source = provenance[`${family}:${normalized.payload.id}`];
    return source
      ? normalizeAutomationEntry({ ...normalized, provenance: source })
      : normalized;
  });
}
function databaseEntries(
  library: DatabaseAutomationLibrary,
  family: AutomationFamily,
): AutomationEntry[] {
  const payloads =
    family === "terminal-script"
      ? [
          ...library.terminalScripts.customScripts,
          ...library.terminalScripts.modifiedDefaults,
        ]
      : family === "terminal-macro"
        ? library.terminalMacros
        : family === "website-script"
          ? library.website.scripts
          : library.website.macros;
  return entries(family, payloads, library.provenance);
}
function updatedProvenance(
  current: Record<string, AutomationProvenance> | undefined,
  family: AutomationFamily,
  replacement: AutomationEntry[],
) {
  const next = Object.fromEntries(
    Object.entries(current ?? {}).filter(
      ([key]) => !key.startsWith(`${family}:`),
    ),
  );
  for (const entry of replacement)
    if (entry.provenance)
      next[`${family}:${entry.payload.id}`] = entry.provenance;
  return next;
}
function applyChanges<F extends AutomationFamily>(
  family: AutomationFamily,
  reviewed: AutomationEntry[],
  changes: readonly AutomationLibraryChange<F>[],
): AutomationEntry[] {
  if (!Array.isArray(changes) || changes.length > 1024)
    throw new Error("Invalid or oversized automation edit batch.");
  const result = new Map(reviewed.map((entry) => [entry.payload.id, entry]));
  const changed = new Set<string>();
  for (const raw of changes) {
    if (!raw || (raw.operation !== "put" && raw.operation !== "delete"))
      throw new Error("Invalid automation edit operation.");
    const expected =
      raw.expected === undefined
        ? undefined
        : normalizeAutomationEntry(raw.expected);
    const entry =
      raw.operation === "put" ? normalizeAutomationEntry(raw.entry) : expected;
    if (
      !entry ||
      entry.family !== family ||
      (expected &&
        (expected.family !== family ||
          expected.payload.id !== entry.payload.id)) ||
      changed.has(entry.payload.id)
    )
      throw new Error("Invalid, duplicate, or mixed-family automation edit.");
    if (!equal(result.get(entry.payload.id), expected))
      fail(
        "conflict",
        "The reviewed library item changed. Reload before applying edits.",
      );
    changed.add(entry.payload.id);
    if (raw.operation === "delete") result.delete(entry.payload.id);
    else result.set(entry.payload.id, entry);
  }
  return [...result.values()];
}

/** Existing app stores and the owning provider are the only persistence backends. */
export function createAutomationLibraryApi(
  database: () => DatabaseAutomationApi | undefined = () => undefined,
  assertAppAccess: () => void = () => {},
): AutomationLibraryApi & { invalidateReviews(): void } {
  let epoch = 0;
  const reviews = new Map<
    string,
    {
      snapshot: AutomationLibrarySnapshot;
      epoch: number;
      deadline: number;
      databaseScope?: DatabaseAutomationScope;
      library?: DatabaseAutomationLibrary;
      bytes: number;
    }
  >();
  const assertEpoch = (expected: number) => {
    if (expected !== epoch)
      fail(
        "access-changed",
        "Library access changed. Reload and review before continuing.",
      );
  };
  const assertApp = (expected: number) => {
    assertEpoch(expected);
    assertAppAccess();
  };
  const dbFor = (
    scope: AutomationScope,
    expected?: DatabaseAutomationScope,
  ) => {
    const api = database();
    if (
      scope.kind !== "database" ||
      !api?.scope ||
      api.scope.databaseId !== scope.databaseId ||
      (expected && !equal(api.scope, expected))
    )
      fail(
        "database-unavailable",
        "Open and unlock the exact owning database, then reload this library.",
      );
    return api!;
  };
  const readApp = async (
    family: AutomationFamily,
    captured: number,
  ): Promise<AutomationEntry[]> => {
    assertApp(captured);
    if (!(await getInvoke()))
      fail(
        "desktop-required",
        "This library requires the desktop app. No browser fallback was created.",
      );
    assertApp(captured);
    let result: AutomationEntry[];
    if (family === "terminal-script") {
      const current = (await managedScriptsStore.load()).value;
      result = entries(
        family,
        resolveManagedScripts(defaultScripts, current),
        current?.provenance,
      );
    } else if (family === "terminal-macro") {
      await loadTerminalMacros(); // Retain verified legacy migration and its refusal semantics.
      const current = (await terminalMacrosStore.load()).value;
      if (!current)
        throw new Error(
          "Terminal macro library disappeared; reload before editing.",
        );
      result = entries(family, current.macros, current.provenance);
    } else {
      const current =
        (await webAutomationStore.load()).value ?? EMPTY_WEB_AUTOMATION_LIBRARY;
      result = entries(
        family,
        family === "website-script" ? current.scripts : current.macros,
        current.provenance,
      );
    }
    assertApp(captured);
    return result;
  };
  const read = async <F extends AutomationFamily>(
    requested: AutomationScope,
    family: F,
  ): Promise<AutomationLibrarySnapshot<F>> => {
    if (
      ![
        "terminal-script",
        "terminal-macro",
        "website-script",
        "website-macro",
      ].includes(family)
    )
      throw new Error("Invalid automation family.");
    const scope = validateScope(requested),
      captured = epoch;
    assertApp(captured);
    let library: DatabaseAutomationLibrary | undefined,
      databaseScope: DatabaseAutomationScope | undefined;
    let value: AutomationEntry[];
    if (scope.kind === "app") value = await readApp(family, captured);
    else {
      const api = dbFor(scope);
      databaseScope = { ...api.scope! };
      library = normalizeDatabaseAutomationLibrary(
        await api.read(databaseScope),
      );
      assertApp(captured);
      dbFor(scope, databaseScope);
      value = databaseEntries(library, family);
    }
    const snapshot = {
      scope,
      family,
      receipt: crypto.randomUUID(),
      entries: value,
    } as AutomationLibrarySnapshot<F>;
    const now = performance.now();
    for (const [key, review] of reviews)
      if (review.deadline <= now) reviews.delete(key);
    const bytes = new TextEncoder().encode(
      JSON.stringify({ snapshot, library }),
    ).length;
    if (bytes > 32 * 1024 * 1024)
      throw new Error(
        "Library review exceeds the bounded memory limit. Existing data was retained.",
      );
    while (
      reviews.size >= 8 ||
      [...reviews.values()].reduce(
        (total, review) => total + review.bytes,
        bytes,
      ) >
        32 * 1024 * 1024
    )
      reviews.delete(reviews.keys().next().value!);
    reviews.set(snapshot.receipt, {
      snapshot: structuredClone(snapshot),
      epoch: captured,
      deadline: now + 30 * 60_000,
      databaseScope,
      library,
      bytes,
    });
    return structuredClone(snapshot);
  };
  const apply = async <F extends AutomationFamily>(
    snapshot: AutomationLibrarySnapshot<F>,
    changes: readonly AutomationLibraryChange<F>[],
  ): Promise<AutomationLibrarySnapshot<F>> => {
    const review = reviews.get(snapshot?.receipt);
    if (
      !review ||
      review.deadline <= performance.now() ||
      !equal(review.snapshot, snapshot)
    )
      fail(
        "conflict",
        "The library review expired or changed. Reload and review before applying edits.",
      );
    reviews.delete(snapshot.receipt); // One use, including refused/ambiguous writes.
    assertApp(review!.epoch);
    const replacement = applyChanges(
      snapshot.family,
      review!.snapshot.entries,
      changes,
    );
    const checkCurrent = (current: AutomationEntry[]) => {
      assertApp(review!.epoch);
      if (!equal(current, review!.snapshot.entries))
        fail(
          "conflict",
          "The library changed in another window. Reload before applying edits.",
        );
    };
    if (snapshot.scope.kind === "database") {
      const current = review!.library!,
        expectedScope = review!.databaseScope!;
      const next = structuredClone(current);
      next.revision++;
      next.provenance = updatedProvenance(
        next.provenance,
        snapshot.family,
        replacement,
      );
      const payloads = replacement.map((entry) => entry.payload);
      if (snapshot.family === "terminal-script")
        next.terminalScripts = {
          customScripts:
            payloads as DatabaseAutomationLibrary["terminalScripts"]["customScripts"],
          modifiedDefaults: [],
          deletedDefaultIds: [],
        };
      else if (snapshot.family === "terminal-macro")
        next.terminalMacros =
          payloads as DatabaseAutomationLibrary["terminalMacros"];
      else if (snapshot.family === "website-script")
        next.website.scripts =
          payloads as DatabaseAutomationLibrary["website"]["scripts"];
      else
        next.website.macros =
          payloads as DatabaseAutomationLibrary["website"]["macros"];
      await dbFor(snapshot.scope, expectedScope).compareAndSwap(
        expectedScope,
        current,
        normalizeDatabaseAutomationLibrary(next),
      );
      assertApp(review!.epoch);
      dbFor(snapshot.scope, expectedScope);
    } else {
      assertApp(review!.epoch);
      if (!(await getInvoke()))
        fail(
          "desktop-required",
          "This library requires the desktop app. No browser fallback was created.",
        );
      assertApp(review!.epoch);
      if (snapshot.family === "terminal-script") {
        await managedScriptsStore.update((current) => {
          checkCurrent(
            entries(
              snapshot.family,
              resolveManagedScripts(defaultScripts, current),
              current?.provenance,
            ),
          );
          return {
            ...buildManagedScriptsSnapshot(
              replacement.map(
                (entry) => entry.payload,
              ) as typeof defaultScripts,
              defaultScripts,
            ),
            provenance: updatedProvenance(
              current?.provenance,
              snapshot.family,
              replacement,
            ),
          };
        });
      } else if (snapshot.family === "terminal-macro") {
        await terminalMacrosStore.update((current) => {
          if (!current)
            throw new Error(
              "Terminal macro library disappeared; reload before editing.",
            );
          checkCurrent(
            entries(snapshot.family, current.macros, current.provenance),
          );
          return {
            ...current,
            macros: replacement.map(
              (entry) => entry.payload,
            ) as typeof current.macros,
            provenance: updatedProvenance(
              current.provenance,
              snapshot.family,
              replacement,
            ),
          };
        });
      } else {
        await webAutomationStore.update((value) => {
          const current = value ?? EMPTY_WEB_AUTOMATION_LIBRARY;
          checkCurrent(
            entries(
              snapshot.family,
              snapshot.family === "website-script"
                ? current.scripts
                : current.macros,
              current.provenance,
            ),
          );
          return normalizeWebAutomationLibrary({
            ...current,
            [snapshot.family === "website-script" ? "scripts" : "macros"]:
              replacement.map((entry) => entry.payload),
            provenance: updatedProvenance(
              current.provenance,
              snapshot.family,
              replacement,
            ),
          });
        });
      }
      assertApp(review!.epoch);
    }
    return read(snapshot.scope, snapshot.family);
  };
  return {
    read,
    apply,
    invalidateReviews() {
      epoch++;
      reviews.clear();
    },
  };
}
