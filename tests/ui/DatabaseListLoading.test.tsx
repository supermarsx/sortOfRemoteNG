import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import en from "../../src/i18n/locales/en.json";
import type { Mgr } from "../../src/components/database/list/types";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { LoadingCollection } from "../../src/hooks/connection/useDatabaseSelector";

// Mutable across tests so the D3 invariant can flip `animationsEnabled` off.
// `vi.hoisted` because vi.mock factories are hoisted above the imports and
// would otherwise read `settings` in its temporal dead zone.
const { settings } = vi.hoisted(() => ({
  settings: { animationsEnabled: true },
}));

// Both exports are needed: PasswordInput and LoadingElement pull `default`
// (the context object) from this module, not just `useSettings`.
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings }),
  default: React.createContext({ settings }),
}));

/**
 * Resolves keys against the real en.json and interpolates `{{name}}`, so the
 * copy assertions below test the strings users actually see. If the
 * `collections.loading.*` keys are renamed or dropped, these tests fail rather
 * than silently asserting on raw key names.
 */
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
  /** id of the currently-open database — drives the handoff derivation. */
  currentId?: string | null;
}

/**
 * `Mgr` is the whole `useDatabaseSelector` return; DatabaseList reads a small
 * slice of it. The stub supplies that slice and casts — a full literal would be
 * ~60 fields of noise with no extra coverage.
 */
function makeMgr({ loadingCollection = null, currentId = null }: StubOptions) {
  return {
    collections: [ALPHA, BETA, GAMMA],
    loadingCollection,
    // A function, not a boolean: the handoff derivation calls it per row.
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

function renderList(options: StubOptions = {}) {
  return render(<DatabaseList mgr={makeMgr(options)} onClose={vi.fn()} />);
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
    return label.startsWith("Open database ") || label === "Open";
  });
}

const OPENING_ALPHA = "Opening Alpha…";
const SWITCHING_BETA = "Switching to Beta…";
const UNLOCKING_ALPHA = "Unlocking Alpha…";
const CLOSING_ALPHA = "Closing Alpha…";

beforeEach(() => {
  settings.animationsEnabled = true;
});

describe("DatabaseList loading treatment", () => {
  it("renders no loading state when nothing is loading", () => {
    renderList();

    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    expect(document.querySelectorAll(".animate-row-sweep")).toHaveLength(0);
    expect(document.querySelectorAll(".animate-row-handoff")).toHaveLength(0);
    expect(
      screen.getByTestId("database-loading-announcement").textContent,
    ).toBe("");
  });

  it("shows the spinner in place of the database glyph on the loading row", () => {
    renderList({
      loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
    });

    const loadingRow = rowFor("Alpha");
    const idleRow = rowFor("Beta");

    // The spinner root carries role="status" and is deliberately wrapped in
    // aria-hidden, so it is invisible to role queries — query the DOM directly.
    expect(
      loadingRow.querySelector('[aria-hidden="true"] [role="status"]'),
    ).not.toBeNull();
    expect(
      idleRow.querySelector('[aria-hidden="true"] [role="status"]'),
    ).toBeNull();
  });

  it("renders the mode copy on the loading row", () => {
    renderList({
      loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
    });

    // Twice by design: once on the row, once in the live region.
    expect(screen.getAllByText(OPENING_ALPHA)).toHaveLength(2);
    expect(rowFor("Alpha").textContent).toContain(OPENING_ALPHA);
    expect(rowFor("Beta").textContent).not.toContain(OPENING_ALPHA);
  });

  it("renders unlock copy for the unlock mode", () => {
    renderList({
      loadingCollection: { id: "alpha", name: "Alpha", mode: "unlock" },
    });

    expect(rowFor("Alpha").textContent).toContain(UNLOCKING_ALPHA);
  });

  it("marks only the loading row aria-busy", () => {
    renderList({
      loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
    });

    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    expect(rowFor("Alpha")).toHaveAttribute("aria-busy", "true");
    expect(rowFor("Beta")).toHaveAttribute("aria-busy", "false");
  });

  it("disables and dims bystander rows while a load is in flight", () => {
    renderList({
      loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
    });

    const bystander = rowFor("Beta");
    expect(bystander.className).toContain("pointer-events-none");
    expect(bystander.className).toContain("opacity-50");

    // Both entry points — the row body and the open/unlock icon — must be shut.
    // Scoped to the row: the icon button's label is a bare "Open" on every row.
    expect(openEntryPoints(bystander)).toHaveLength(2);
    for (const button of openEntryPoints(bystander)) {
      expect(button).toBeDisabled();
    }

    // The loading row's own entry points are shut too — the guard is global.
    for (const button of openEntryPoints(rowFor("Alpha"))) {
      expect(button).toBeDisabled();
    }
  });

  it("announces exactly once — one live region, not one per row", () => {
    renderList({
      loadingCollection: { id: "beta", name: "Beta", mode: "switch" },
      currentId: "alpha",
    });

    // A switch lights up two rows. Exactly one region may be exposed to AT:
    // the spinner's own role="status" is aria-hidden, so it must not appear.
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]).toBe(
      screen.getByTestId("database-loading-announcement"),
    );
    expect(regions[0]).toHaveAttribute("aria-live", "polite");
    expect(regions[0].textContent).toBe(SWITCHING_BETA);
  });

  it("renders handoff copy on the outgoing row during a switch", () => {
    renderList({
      loadingCollection: { id: "beta", name: "Beta", mode: "switch" },
      currentId: "alpha",
    });

    // Outgoing row hands off; incoming row loads; the third row is a bystander.
    expect(rowFor("Alpha").textContent).toContain(CLOSING_ALPHA);
    expect(rowFor("Beta").textContent).toContain(SWITCHING_BETA);
    expect(rowFor("Gamma").textContent).not.toContain(CLOSING_ALPHA);

    // The outgoing row is handing off, not loading: no spinner, no aria-busy.
    expect(rowFor("Alpha")).toHaveAttribute("aria-busy", "false");
    expect(document.querySelectorAll(".animate-row-handoff")).toHaveLength(1);
    expect(document.querySelectorAll(".animate-row-sweep")).toHaveLength(1);

    // Handoff copy is row-only — the announcement carries the incoming mode.
    expect(screen.getAllByText(CLOSING_ALPHA)).toHaveLength(1);
  });

  it("does not treat a re-open of the current database as a handoff", () => {
    renderList({
      loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
      currentId: "alpha",
    });

    expect(document.querySelectorAll(".animate-row-handoff")).toHaveLength(0);
    expect(rowFor("Alpha").textContent).toContain(OPENING_ALPHA);
    expect(rowFor("Alpha").textContent).not.toContain(CLOSING_ALPHA);
  });

  it("applies motion classes only while animations are enabled", () => {
    renderList({
      loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
    });

    expect(document.querySelectorAll(".animate-row-sweep")).toHaveLength(1);
  });

  // ─── The D3 invariant ───────────────────────────────────────────────
  //
  // The animationsEnabled gate covers motion and nothing else. Everything that
  // carries information — mode copy, aria-busy, the announcement, the disabled
  // siblings — must survive with animations off. This is the test that stops a
  // future change from gating the accessible state away along with the motion.
  describe("with animations disabled", () => {
    beforeEach(() => {
      settings.animationsEnabled = false;
    });

    it("drops every motion class on an open", () => {
      renderList({
        loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
      });

      expect(document.querySelectorAll(".animate-row-sweep")).toHaveLength(0);
      expect(document.querySelectorAll(".animate-row-handoff")).toHaveLength(0);
      expect(document.querySelectorAll('[class*="animate-row-"]')).toHaveLength(
        0,
      );
    });

    it("drops every motion class on a switch, including the handoff", () => {
      renderList({
        loadingCollection: { id: "beta", name: "Beta", mode: "switch" },
        currentId: "alpha",
      });

      expect(document.querySelectorAll('[class*="animate-row-"]')).toHaveLength(
        0,
      );
    });

    it("keeps the mode copy, aria-busy and the announcement on an open", () => {
      renderList({
        loadingCollection: { id: "alpha", name: "Alpha", mode: "open" },
      });

      expect(rowFor("Alpha").textContent).toContain(OPENING_ALPHA);
      expect(rowFor("Alpha")).toHaveAttribute("aria-busy", "true");
      expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
      expect(
        screen.getByTestId("database-loading-announcement").textContent,
      ).toBe(OPENING_ALPHA);
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });

    it("keeps the spinner, the handoff copy and the disabled siblings", () => {
      renderList({
        loadingCollection: { id: "beta", name: "Beta", mode: "switch" },
        currentId: "alpha",
      });

      // LoadingElement self-gates to a static glyph; it must still be mounted
      // in the icon slot rather than reverting to the Database icon.
      expect(
        rowFor("Beta").querySelector('[aria-hidden="true"] [role="status"]'),
      ).not.toBeNull();
      expect(rowFor("Alpha").textContent).toContain(CLOSING_ALPHA);
      expect(rowFor("Beta").textContent).toContain(SWITCHING_BETA);
      expect(rowFor("Gamma").className).toContain("pointer-events-none");
      for (const button of openEntryPoints(rowFor("Gamma"))) {
        expect(button).toBeDisabled();
      }
      expect(
        screen.getByTestId("database-loading-announcement").textContent,
      ).toBe(SWITCHING_BETA);
    });
  });
});
