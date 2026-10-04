import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import en from "../../src/i18n/locales/en-US.json";
import type { Mgr } from "../../src/components/database/list/types";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { LoadingCollection } from "../../src/hooks/connection/useDatabaseSelector";

vi.mock("../../src/hooks/connection/useDatabaseSizes", () => ({
  useDatabaseSizes: () => ({ sizes: {}, loading: false, refresh: () => {} }),
}));

const { settings, navigate } = vi.hoisted(() => ({
  settings: { animationsEnabled: true },
  navigate: vi.fn(),
}));
vi.mock("../../src/components/ImportExport/navigation", () => ({
  useImportExportNavigation: () => navigate,
}));

// Both exports are needed: PasswordInput and LoadingElement pull `default`
// (the context object) from this module, not just `useSettings`.
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings }),
  default: React.createContext({ settings }),
}));

/** Use real labels so assertions catch visible progress copy as well as raw keys. */
function translate(key: string, opts?: string | Record<string, unknown>) {
  const resolved = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en,
    );

  if (typeof resolved !== "string") {
    return typeof opts === "string" ? opts : key;
  }
  if (!opts || typeof opts === "string") return resolved;

  return resolved.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
    token in opts ? String(opts[token]) : match,
  );
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) =>
      translate(key, opts),
  }),
}));

import DatabaseList from "../../src/components/database/list/DatabaseList";

const ALPHA: ConnectionDatabase = {
  id: "alpha",
  name: "Alpha",
  isEncrypted: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastAccessed: "2026-01-01T00:00:00.000Z",
};
const BETA: ConnectionDatabase = { ...ALPHA, id: "beta", name: "Beta" };
const GAMMA: ConnectionDatabase = { ...ALPHA, id: "gamma", name: "Gamma" };

interface StubOptions {
  loadingCollection?: LoadingCollection | null;
  /** Current may change during a load; only fromId owns the outgoing handoff. */
  currentId?: string | null;
  encryptedId?: string;
}

/**
 * `Mgr` is the whole `useDatabaseSelector` return; DatabaseList reads a small
 * slice of it. The stub supplies that slice and casts — a full literal would be
 * ~60 fields of noise with no extra coverage.
 */
function makeMgr({
  loadingCollection = null,
  currentId = null,
  encryptedId,
}: StubOptions = {}) {
  return {
    collections: [ALPHA, BETA, GAMMA].map((collection) => ({
      ...collection,
      isEncrypted: collection.id === encryptedId,
    })),
    loadingCollection,
    isCurrentDatabase: (id: string) => id === currentId,
    isDatabaseUnlocked: () => false,
    isWorking: false,
    highlightedCollectionId: null,
    showCreateForm: false,
    showImportForm: false,
    showPasswordDialog: false,
    editingCollection: null,
    exportingCollection: null,
    selectedCollection: null,
    passwordDialogMode: "unlock",
    error: "",
    setShowCreateForm: vi.fn(),
    setShowImportForm: vi.fn(),
    setError: vi.fn(),
    handleSelectCollection: vi.fn(),
    handleCloseCollection: vi.fn(),
    handleEditCollection: vi.fn(),
    handleCloneCollection: vi.fn(),
    handleExportCollection: vi.fn(),
    handleDeleteCollection: vi.fn(),
  } as unknown as Mgr;
}

/** Every row container carries aria-busy (true or false), so it locates rows. */
function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest("[aria-busy]");
  if (!row) throw new Error(`no row container for ${name}`);
  return row as HTMLElement;
}

/**
 * The two ways into a database from a row: the row body (labelled
 * "Open database {{name}}") and the open/unlock icon (a bare "Open"/"Unlock").
 * Both must be disabled while any load is in flight.
 */
function openEntryPoints(row: HTMLElement): HTMLButtonElement[] {
  return Array.from(row.querySelectorAll("button")).filter((button) => {
    const label = button.getAttribute("aria-label") ?? "";
    return (
      label.startsWith("Open database ") ||
      label === "Open" ||
      label === "Unlock"
    );
  });
}

function expectNoDuplicateProgress(container: HTMLElement) {
  expect(
    screen.queryByTestId("database-loading-announcement"),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(container.querySelector("[aria-live]")).toBeNull();
  expect(container).not.toHaveTextContent(
    /Opening |Unlocking |Switching to |Closing |databaseCenter\.collections\.loading\./,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.animationsEnabled = true;
});
afterEach(cleanup);

const scenarios = [
  { name: "cold open", mode: "open", id: "alpha", currentId: null },
  { name: "cold unlock", mode: "unlock", id: "alpha", currentId: null },
  { name: "reopen current", mode: "open", id: "alpha", currentId: "alpha" },
  { name: "unlock current", mode: "unlock", id: "alpha", currentId: "alpha" },
  {
    name: "switch",
    mode: "switch",
    id: "beta",
    currentId: "alpha",
    fromId: "alpha",
  },
  {
    name: "unlock with handoff",
    mode: "unlock",
    id: "beta",
    currentId: "alpha",
    fromId: "alpha",
  },
] satisfies (LoadingCollection & { currentId: string | null })[];

// Toast lifecycle coverage lives in useDatabaseOpenNotification/useDatabaseSelector.
// These rows must retain their metadata and interaction guards without announcing
// the same progress again, including when motion is disabled.
describe.each([true, false])(
  "DatabaseList progress with animationsEnabled=%s",
  (animationsEnabled) => {
    it.each(scenarios)(
      "$name keeps metadata, a hidden spinner, and disabled entry points",
      (scenario) => {
        settings.animationsEnabled = animationsEnabled;
        const incoming = scenario.id === "alpha" ? ALPHA : BETA;
        const loadingCollection: LoadingCollection = {
          id: scenario.id,
          name: incoming.name,
          mode: scenario.mode,
          ...("fromId" in scenario ? { fromId: scenario.fromId } : {}),
        };
        const options: StubOptions = {
          loadingCollection,
          currentId: scenario.currentId,
          encryptedId: scenario.mode === "unlock" ? incoming.id : undefined,
        };
        const mgr = makeMgr(options);
        const view = render(<DatabaseList mgr={mgr} onClose={vi.fn()} />);
        expectNoDuplicateProgress(view.container);
        expect(
          view.container.querySelectorAll('[aria-busy="true"]'),
        ).toHaveLength(1);
        expect(rowFor(incoming.name)).toHaveAttribute("aria-busy", "true");
        expect(
          view.container.querySelectorAll(
            '[aria-hidden="true"] [role="status"]',
          ),
        ).toHaveLength(1);

        for (const collection of mgr.collections) {
          const row = rowFor(collection.name);
          const isIncoming = collection.id === incoming.id;
          const isHandoff = collection.id === loadingCollection.fromId;
          expect(row).toHaveAttribute("aria-busy", String(isIncoming));
          expect(row).toHaveTextContent(
            "Last accessed: " +
              new Date(collection.lastAccessed).toLocaleDateString(),
          );
          expect(
            row.querySelector('[aria-hidden="true"] [role="status"]') !== null,
          ).toBe(isIncoming);
          expect(row.classList.contains("pointer-events-none")).toBe(
            !isIncoming && !isHandoff,
          );
          expect(row.classList.contains("opacity-50")).toBe(
            !isIncoming && !isHandoff,
          );
          expect(row.classList.contains("animate-row-handoff")).toBe(
            animationsEnabled && isHandoff,
          );
          expect(row.querySelector(".animate-row-sweep") !== null).toBe(
            animationsEnabled && isIncoming,
          );
          const buttons = openEntryPoints(row);
          expect(buttons).toHaveLength(2);
          for (const button of buttons) {
            expect(button).toBeDisabled();
            fireEvent.click(button);
          }
          const exportButton = within(row).getByRole("button", {
            name: "Export",
          });
          expect(exportButton).toBeDisabled();
          fireEvent.click(exportButton);
          expect(within(row).queryByText("encrypted") !== null).toBe(
            collection.isEncrypted,
          );
        }
        expect(mgr.handleSelectCollection).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        if (scenario.mode === "unlock") {
          expect(
            within(rowFor(incoming.name)).getByRole("button", {
              name: "Unlock",
            }),
          ).toBeDisabled();
        }
        if (!animationsEnabled)
          expect(
            view.container.querySelector('[class*="animate-row-"]'),
          ).toBeNull();

        // Settling the operation removes loading state and restores the same actions.
        view.rerender(
          <DatabaseList
            mgr={makeMgr({
              ...options,
              loadingCollection: null,
              currentId: incoming.id,
            })}
            onClose={vi.fn()}
          />,
        );
        expectNoDuplicateProgress(view.container);
        expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
        expect(
          view.container.querySelector('[class*="animate-row-"]'),
        ).toBeNull();
        expect(
          view.container.querySelector('[aria-hidden="true"] [role="status"]'),
        ).toBeNull();
        for (const collection of mgr.collections) {
          const row = rowFor(collection.name);
          expect(row).not.toHaveClass("pointer-events-none", "opacity-50");
          for (const button of openEntryPoints(row))
            expect(button).toBeEnabled();
          expect(
            within(row).getByRole("button", { name: "Export" }),
          ).toBeEnabled();
          expect(row).toHaveTextContent("Last accessed:");
        }
        expect(
          within(rowFor(incoming.name)).getByTestId("database-close"),
        ).toBeInTheDocument();
      },
    );

    it.each(["switch", "unlock"] as const)(
      "keeps the fromId handoff when current changes mid-%s",
      (mode) => {
        settings.animationsEnabled = animationsEnabled;
        const options: StubOptions = {
          loadingCollection: {
            id: "beta",
            name: "Beta",
            mode,
            fromId: "alpha",
          },
          currentId: "alpha",
          encryptedId: mode === "unlock" ? "beta" : undefined,
        };
        const view = render(
          <DatabaseList mgr={makeMgr(options)} onClose={vi.fn()} />,
        );
        expect(
          within(rowFor("Alpha")).getByTestId("database-close"),
        ).toBeInTheDocument();
        view.rerender(
          <DatabaseList
            mgr={makeMgr({ ...options, currentId: "beta" })}
            onClose={vi.fn()}
          />,
        );
        expectNoDuplicateProgress(view.container);
        expect(rowFor("Alpha")).toHaveAttribute("aria-busy", "false");
        expect(rowFor("Alpha")).not.toHaveClass(
          "pointer-events-none",
          "opacity-50",
        );
        expect(rowFor("Alpha").classList.contains("animate-row-handoff")).toBe(
          animationsEnabled,
        );
        expect(rowFor("Beta")).toHaveAttribute("aria-busy", "true");
        expect(rowFor("Gamma")).toHaveClass(
          "pointer-events-none",
          "opacity-50",
        );
        expect(
          within(rowFor("Alpha")).queryByTestId("database-close"),
        ).not.toBeInTheDocument();
        expect(
          within(rowFor("Beta")).getByTestId("database-close"),
        ).toBeInTheDocument();
        for (const name of ["Alpha", "Beta", "Gamma"]) {
          expect(rowFor(name)).toHaveTextContent("Last accessed:");
          for (const button of openEntryPoints(rowFor(name)))
            expect(button).toBeDisabled();
        }
      },
    );
  },
);

it("idle rows preserve current/encrypted status and invoke normal open/export actions", () => {
  const mgr = makeMgr({ currentId: "alpha", encryptedId: "beta" });
  const { container } = render(<DatabaseList mgr={mgr} onClose={vi.fn()} />);
  expectNoDuplicateProgress(container);
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelector('[class*="animate-row-"]')).toBeNull();
  expect(
    container.querySelector('[aria-hidden="true"] [role="status"]'),
  ).toBeNull();
  expect(
    within(rowFor("Alpha")).getByRole("button", { name: "Close" }),
  ).toBeInTheDocument();
  expect(within(rowFor("Beta")).getByText("encrypted")).toBeInTheDocument();
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    for (const button of openEntryPoints(rowFor(name))) {
      expect(button).toBeEnabled();
      fireEvent.click(button);
    }
  }
  expect(mgr.handleSelectCollection).toHaveBeenCalledTimes(6);
  fireEvent.click(
    within(rowFor("Beta")).getByRole("button", { name: "Export" }),
  );
  expect(navigate).toHaveBeenCalledExactlyOnceWith({
    tab: "export",
    format: "json",
    databaseIds: ["beta"],
    encrypted: true,
  });
});
