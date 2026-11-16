import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../../src/contexts/ConnectionContextTypes";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../../src/types/security/databaseCredentialVault";
import {
  databaseCredentialMetadata,
  normalizeDatabaseCredentialEntry,
} from "../../../src/utils/security/databaseCredentialVault";
import DatabaseCredentialVault from "../../../src/components/security/DatabaseCredentialVault";
import {
  VaultActionBar,
  type VaultAction,
} from "../../../src/components/security/databaseCredentialVault/manager/VaultToolbar";
import { useCopyCountdown } from "../../../src/components/security/databaseCredentialVault/manager/useCopyCountdown";
import { VaultPasswordGenerator } from "../../../src/components/security/databaseCredentialVault/manager/VaultPasswordGenerator";
import { useVaultText } from "../../../src/components/security/databaseCredentialVault/manager/vaultText";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";

const copySecret = vi.hoisted(() => vi.fn());
vi.mock("../../../src/utils/security/credentialClipboard", async (orig) => ({
  ...(await orig<
    typeof import("../../../src/utils/security/credentialClipboard")
  >()),
  copySecretToClipboard: copySecret,
}));
vi.mock("../../../src/components/ui/dialogs/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    message,
    onConfirm,
  }: {
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <p>{message}</p>
        <button onClick={onConfirm}>Confirm review</button>
      </div>
    ) : null,
}));

const entryOf = (
  n: number,
  patch: Partial<DatabaseCredentialEntry> = {},
): DatabaseCredentialEntry => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name: `Entry ${n}`,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
  facets: { username: "SECRET_USER", password: "SECRET_PASS" },
  ...patch,
});
function facade(initial: DatabaseCredentialEntry[]) {
  let rows = structuredClone(initial),
    revision = 0;
  const scope = { databaseId: "db-a", generation: 1 };
  const snapshot = (): DatabaseCredentialSnapshot => ({
    scope,
    revision,
    receipt: `review-${revision}`,
    entries: rows.map(databaseCredentialMetadata),
  });
  const api: DatabaseCredentialVaultApi = {
    scope,
    changeRevision: 0,
    list: vi.fn(async () => snapshot()),
    resolve: vi.fn(async () => ({})),
    compareAndSwap: vi.fn(async (review, changes) => {
      if (review.revision !== revision) throw Error("stale review");
      for (const change of changes) {
        if (change.operation === "delete")
          rows = rows.filter((row) => row.id !== change.id);
        else {
          const next = normalizeDatabaseCredentialEntry(change.entry);
          rows = [...rows.filter((row) => row.id !== next.id), next];
        }
      }
      revision++;
    }),
  };
  return api;
}
const mount = (
  api: DatabaseCredentialVaultApi,
  props: Partial<React.ComponentProps<typeof DatabaseCredentialVault>> = {},
) =>
  render(
    <ConnectionContext.Provider
      value={
        {
          credentialVault: api,
          databaseAvailability: {
            status: "ready",
            databaseId: "db-a",
            generation: 1,
          },
        } as ConnectionContextType
      }
    >
      <DatabaseCredentialVault {...props} />
    </ConnectionContext.Provider>,
  );
const rowOf = (name: string) =>
  screen.getByRole("button", { name: `Edit ${name}` }).closest("tr")!;

beforeEach(() => copySecret.mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("credential vault manager workspace", () => {
  const three = () =>
    facade([
      entryOf(1, { tags: ["Finance"] }),
      entryOf(2, { tags: ["Finance", "Ops"] }),
      entryOf(3, { updatedAt: "2024-01-01T00:00:00.000Z" }),
    ]);

  it("shows group counts and filters by tag from the sidebar", async () => {
    mount(three());
    await screen.findByText("Entry 1");
    const nav = screen.getByRole("navigation", { name: "Credential groups" });
    expect(
      within(nav).getByText("All credentials").closest("button"),
    ).toHaveTextContent("3");
    const finance = within(nav).getByText("Finance").closest("button")!;
    expect(finance).toHaveTextContent("2");
    fireEvent.click(finance);
    expect(finance).toHaveAttribute("aria-current", "true");
    expect(screen.queryByText("Entry 3")).toBeNull();
    expect(screen.getByText("Entry 2")).toBeVisible();
  });

  it("applies quick-filter chips and the stale chip", async () => {
    mount(three());
    await screen.findByText("Entry 1");
    const chips = screen.getByRole("group", { name: "Quick filters" });
    fireEvent.click(
      within(chips).getByRole("button", { name: "Not updated in 6 months" }),
    );
    expect(screen.getByText("Entry 3")).toBeVisible();
    expect(screen.queryByText("Entry 1")).toBeNull();
    expect(screen.getByText("1 active filter")).toBeVisible();
  });

  it("searches with options: scope, regex, invalid pattern", async () => {
    mount(three());
    await screen.findByText("Entry 1");
    const input = screen.getByLabelText("Search vault credentials");
    fireEvent.change(input, { target: { value: "ops" } });
    expect(screen.queryByText("Entry 1")).toBeNull();
    expect(screen.getByText("Entry 2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Search options" }));
    const options = await screen.findByRole("group", {
      name: "Search options",
    });
    fireEvent.click(within(options).getByLabelText("Category tags"));
    expect(screen.queryByText("Entry 2")).toBeNull();
    fireEvent.click(within(options).getByLabelText("Category tags"));
    fireEvent.click(within(options).getByLabelText("Regular expression"));
    fireEvent.change(input, { target: { value: "^Entry [13]$" } });
    expect(screen.getByText("Entry 1")).toBeVisible();
    expect(screen.queryByText("Entry 2")).toBeNull();
    fireEvent.change(input, { target: { value: "([" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent(
      "Invalid regular expression",
    );
  });

  it("selects with click, ctrl and shift, shows details without secrets, and bulk-deletes in one CAS", async () => {
    const api = three();
    mount(api);
    await screen.findByText("Entry 1");
    const click = (name: string, init: object = {}) =>
      fireEvent.click(within(rowOf(name)).getByText(name), init);
    click("Entry 1");
    const details = screen.getByRole("complementary", {
      name: "Credential details",
    });
    expect(within(details).getAllByText("Entry 1").length).toBeGreaterThan(0);
    expect(rowOf("Entry 1")).toHaveAttribute("aria-selected", "true");
    click("Entry 3", { shiftKey: true });
    expect(within(details).getByText("3 credentials selected.")).toBeVisible();
    click("Entry 2", { ctrlKey: true });
    expect(
      screen.getByRole("group", { name: "Bulk actions" }),
    ).toHaveTextContent("2 selected");
    const bulk = screen.getByRole("group", { name: "Bulk actions" });
    fireEvent.click(
      within(bulk).getByRole("button", { name: /Delete 2 selected/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    await waitFor(() => expect(api.compareAndSwap).toHaveBeenCalledTimes(1));
    const [, changes] = vi.mocked(api.compareAndSwap).mock.calls[0];
    expect(changes).toHaveLength(2);
    expect(changes.every((change) => change.operation === "delete")).toBe(true);
    await waitFor(() => expect(screen.queryByText("Entry 3")).toBeNull());
    expect(api.resolve).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toMatch(/SECRET_USER|SECRET_PASS/);
  });

  it("drives the workspace from the keyboard", async () => {
    const onOpenEditor = vi.fn();
    mount(three(), { onOpenEditor });
    await screen.findByText("Entry 1");
    const search = screen.getByLabelText("Search vault credentials");
    const region = screen.getByRole("region", { name: "Credential inventory" });
    fireEvent.keyDown(region, { key: "f", ctrlKey: true });
    expect(search).toHaveFocus();
    fireEvent.keyDown(region, { key: "Insert" });
    expect(onOpenEditor).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "create" }),
    );
    fireEvent.click(within(rowOf("Entry 2")).getByText("Entry 2"));
    fireEvent.keyDown(region, { key: "Enter" });
    expect(onOpenEditor).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "edit", credentialId: entryOf(2).id }),
    );
    fireEvent.keyDown(region, { key: "ArrowDown" });
    expect(rowOf("Entry 3")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(region, { key: "a", ctrlKey: true });
    expect(
      screen.getByRole("group", { name: "Bulk actions" }),
    ).toHaveTextContent("3 selected");
    fireEvent.keyDown(region, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Bulk actions" })).toBeNull();
    // Typing in the search box never triggers Delete/Insert shortcuts.
    onOpenEditor.mockClear();
    fireEvent.keyDown(search, { key: "Insert" });
    expect(onOpenEditor).not.toHaveBeenCalled();
    fireEvent.keyDown(region, { key: "F1" });
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(help).getByText("Ctrl+B")).toBeVisible();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeNull();
  });

  it("opens a context menu on the row with the same actions as the toolbar", async () => {
    const onOpenEditor = vi.fn();
    mount(three(), { onOpenEditor });
    await screen.findByText("Entry 1");
    fireEvent.contextMenu(rowOf("Entry 1"), { clientX: 20, clientY: 20 });
    const menu = await screen.findByRole("menu", { name: "Credential menu" });
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: /Edit credential/ }),
    );
    expect(onOpenEditor).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "edit", credentialId: entryOf(1).id }),
    );
  });

  it("disables single-target controls with an explanation when nothing is selected", async () => {
    mount(three(), { onOpenEditor: vi.fn() });
    await screen.findByText("Entry 1");
    const edit = screen.getByRole("button", { name: "Edit credential" });
    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute(
      "data-tooltip",
      "Select exactly one credential",
    );
    expect(
      screen.getByRole("button", { name: "Delete credential" }),
    ).toBeDisabled();
  });
});

describe("toolbar overflow", () => {
  function Host({ width }: { width: number }) {
    const tx = useVaultText();
    const actions: VaultAction[] = [
      {
        id: "new",
        label: "New",
        icon: Plus,
        priority: 0,
        group: "a",
        onClick: vi.fn(),
      },
      {
        id: "edit",
        label: "Edit",
        icon: Pencil,
        priority: 1,
        group: "a",
        onClick: vi.fn(),
      },
      {
        id: "del",
        label: "Remove",
        icon: Trash2,
        priority: 5,
        group: "a",
        onClick: vi.fn(),
      },
      {
        id: "imp",
        label: "Import",
        icon: Upload,
        priority: 6,
        group: "b",
        onClick: vi.fn(),
      },
    ];
    return (
      <VaultActionBar
        actions={actions}
        tx={tx}
        label="Bar"
        availableWidth={width}
      />
    );
  }
  it("shows every action when wide", () => {
    render(<Host width={1000} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });
  it("moves low-priority actions into the More menu and runs them from there", async () => {
    render(<Host width={90} />);
    expect(screen.getByRole("button", { name: "New" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("menu", { name: "More actions" });
    expect(
      within(menu).getByRole("menuitem", { name: /Import/ }),
    ).toBeVisible();
  });
});

describe("clipboard auto-clear countdown", () => {
  it("counts down to zero with fake timers and restarts on a new copy", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    const first = { at: Date.now(), seconds: 12 };
    const { result, rerender } = renderHook(
      ({ copy }: { copy: { at: number; seconds: number } | null }) =>
        useCopyCountdown(copy),
      {
        initialProps: { copy: first as { at: number; seconds: number } | null },
      },
    );
    expect(result.current).toBe(12);
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toBe(7);
    act(() => void vi.advanceTimersByTime(7000));
    expect(result.current).toBe(0);
    rerender({ copy: { at: Date.now(), seconds: 30 } });
    expect(result.current).toBe(30);
    rerender({ copy: null });
    expect(result.current).toBe(0);
  });
});

describe("standalone password generator", () => {
  function Host({ onCopied }: { onCopied: (seconds: number) => void }) {
    const tx = useVaultText();
    const ref = React.useRef<HTMLDivElement>(null);
    return (
      <div ref={ref}>
        <VaultPasswordGenerator
          isOpen
          anchorRef={ref}
          onClose={() => {}}
          onCopied={onCopied}
          tx={tx}
        />
      </div>
    );
  }
  it("generates, rates, and copies through the auto-clearing clipboard", async () => {
    copySecret.mockResolvedValue({ ok: true });
    const onCopied = vi.fn();
    render(<Host onCopied={onCopied} />);
    await screen.findByRole("dialog", { name: "Password generator" });
    const output = screen.getByLabelText("Generated password");
    expect(output.textContent).toHaveLength(20);
    expect(
      screen.getByRole("meter", { name: "Password quality" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Length"), {
      target: { value: "40" },
    });
    expect(output.textContent).toHaveLength(40);
    fireEvent.click(screen.getByLabelText("Lowercase (a-z)"));
    fireEvent.click(screen.getByLabelText("Uppercase (A-Z)"));
    fireEvent.click(screen.getByLabelText("Symbols"));
    expect(output.textContent).toMatch(/^[2-9]{40}$/);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy generated password" }),
    );
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(12));
    expect(copySecret).toHaveBeenCalledWith(output.textContent, "password");
    fireEvent.click(screen.getByLabelText("Digits (0-9)"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select at least one character type.",
    );
    expect(
      screen.getByRole("button", { name: "Copy generated password" }),
    ).toBeDisabled();
  });
  it("reports a failed copy without pretending it worked", async () => {
    copySecret.mockResolvedValue({ ok: false });
    const onCopied = vi.fn();
    render(<Host onCopied={onCopied} />);
    await screen.findByRole("dialog", { name: "Password generator" });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy generated password" }),
    );
    await screen.findByText("The password could not be copied.");
    expect(onCopied).not.toHaveBeenCalled();
  });
});
