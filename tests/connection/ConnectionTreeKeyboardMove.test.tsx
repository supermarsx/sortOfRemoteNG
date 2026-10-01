import React, { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";
import type {
  Connection,
  ConnectionFilter,
} from "../../src/types/connection/connection";

vi.mock("../../src/contexts/useConnections", async (original) => {
  const actual =
    await original<typeof import("../../src/contexts/useConnections")>();
  return {
    useConnections: () => ({
      ...actual.useConnections(),
      databaseAvailability: {
        status: "ready",
        databaseId: "keyboard-fixture",
        generation: 1,
      },
    }),
  };
});
afterEach(cleanup);
const folder = (
  id: string,
  overrides: Partial<Connection> = {},
): Connection => ({
  id,
  name: id,
  protocol: "ssh",
  hostname: "",
  port: 22,
  isGroup: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  ...overrides,
});
const entries = [
  folder("Charlie"),
  folder("Alpha"),
  folder("Bravo"),
  folder("Leaf", { isGroup: false }),
];
const noop = () => {};
function Seed({
  data,
  filter,
  enabled,
}: {
  data: Connection[];
  filter?: Partial<ConnectionFilter>;
  enabled: boolean;
}) {
  const { state, dispatch } = useConnections();
  useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: data });
    dispatch({
      type: "SET_FILTER",
      payload: filter ?? { sortBy: "name", sortDirection: "asc" },
    });
    dispatch({
      type: "SELECT_CONNECTION",
      payload: data.find((c) => c.id === "Bravo") ?? data[0],
    });
  }, [data, filter, dispatch]);
  return (
    <>
      <output data-testid="state">
        {JSON.stringify({
          connections: state.connections,
          selected: [...state.selectedConnectionIds],
          filter: state.filter,
        })}
      </output>
      <ConnectionTree
        enableReorder={enabled}
        onConnect={noop}
        onDisconnect={noop}
        onEdit={noop}
        onDelete={noop}
      />
    </>
  );
}
function mount(
  data = entries,
  enabled = true,
  filter?: Partial<ConnectionFilter>,
) {
  return render(
    <ToastProvider>
      <ConnectionProvider>
        <Seed data={data} enabled={enabled} filter={filter} />
      </ConnectionProvider>
    </ToastProvider>,
  );
}
const state = () =>
  JSON.parse(screen.getByTestId("state").textContent!) as {
    connections: Connection[];
    selected: string[];
    filter: ConnectionFilter;
  };
const order = () =>
  [...screen.getByRole("tree").querySelectorAll("[data-connection-id]")].map(
    (el) => el.getAttribute("data-connection-id"),
  );
async function row(id: string) {
  await screen.findByText(id);
  return screen
    .getByRole("tree")
    .querySelector(`[data-connection-id="${id}"]`)!
    .closest('[role="treeitem"]') as HTMLElement;
}
describe("folder Alt+arrow moves", () => {
  it("reorders in displayed order, switches to custom and preserves focus/selection", async () => {
    mount();
    const target = await row("Bravo");
    act(() => target.focus());
    expect(fireEvent.keyDown(target, { key: "ArrowUp", altKey: true })).toBe(
      false,
    );
    await waitFor(() =>
      expect(order()).toEqual(["Bravo", "Alpha", "Charlie", "Leaf"]),
    );
    expect(state().filter.sortBy).toBe("custom");
    expect(state().selected).toEqual(["Bravo"]);
    expect(document.activeElement).toBe(target);
    expect(fireEvent.keyDown(target, { key: "ArrowDown", altKey: true })).toBe(
      false,
    );
    await waitFor(() =>
      expect(order()).toEqual(["Alpha", "Bravo", "Charlie", "Leaf"]),
    );
    expect(document.activeElement).toBe(target);
  });
  it("indents under preceding folder and outdents after parent without changing selection", async () => {
    mount();
    const target = await row("Bravo");
    act(() => target.focus());
    fireEvent.keyDown(target, { key: "ArrowRight", altKey: true });
    await waitFor(() =>
      expect(state().connections.find((c) => c.id === "Bravo")?.parentId).toBe(
        "Alpha",
      ),
    );
    expect(state().connections.find((c) => c.id === "Alpha")?.expanded).toBe(
      true,
    );
    expect(document.activeElement).toBe(await row("Bravo"));
    fireEvent.keyDown(await row("Bravo"), { key: "ArrowLeft", altKey: true });
    await waitFor(() =>
      expect(
        state().connections.find((c) => c.id === "Bravo")?.parentId,
      ).toBeUndefined(),
    );
    expect(order()).toEqual(["Alpha", "Bravo", "Charlie", "Leaf"]);
    expect(state().selected).toEqual(["Bravo"]);
  });
  it.each(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])(
    "does not handle %s when locked",
    async (key) => {
      mount(entries, false);
      expect(fireEvent.keyDown(await row("Bravo"), { key, altKey: true })).toBe(
        true,
      );
      expect(state().connections).toEqual(entries);
      expect(state().selected).toEqual(["Bravo"]);
    },
  );
  it.each(["input", "textarea", "select", "contenteditable"])(
    "leaves %s keyboard events alone",
    async (kind) => {
      mount();
      const target = await row("Bravo");
      const editor = document.createElement(
        kind === "contenteditable" ? "div" : kind,
      );
      if (kind === "contenteditable")
        editor.setAttribute("contenteditable", "true");
      target.appendChild(editor);
      expect(fireEvent.keyDown(editor, { key: "ArrowUp", altKey: true })).toBe(
        true,
      );
      expect(state().connections).toEqual(entries);
    },
  );
  it.each([
    ["Alpha", "ArrowUp"],
    ["Charlie", "ArrowDown"],
    ["Alpha", "ArrowRight"],
    ["Bravo", "ArrowLeft"],
    ["Leaf", "ArrowUp"],
  ])("leaves impossible/non-folder move %s %s unhandled", async (id, key) => {
    mount();
    expect(fireEvent.keyDown(await row(id), { key, altKey: true })).toBe(true);
    expect(state().connections).toEqual(entries);
  });
  it("honors descending custom order", async () => {
    mount(
      entries.map((c, i) => ({ ...c, order: i })),
      true,
      { sortBy: "custom", sortDirection: "desc" },
    );
    expect(order()).toEqual(["Bravo", "Alpha", "Charlie", "Leaf"]);
    fireEvent.keyDown(await row("Bravo"), { key: "ArrowDown", altKey: true });
    await waitFor(() =>
      expect(order()).toEqual(["Alpha", "Bravo", "Charlie", "Leaf"]),
    );
    expect(state().filter.sortDirection).toBe("desc");
  });
  it("keeps ordinary arrow navigation", async () => {
    mount();
    fireEvent.keyDown(await row("Bravo"), { key: "ArrowDown" });
    expect(state().selected).toEqual(["Charlie"]);
    expect(state().connections).toEqual(entries);
  });
  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])(
    "does not steal other modified shortcuts: %j",
    async (modifier) => {
      mount();
      expect(
        fireEvent.keyDown(await row("Bravo"), {
          key: "ArrowUp",
          altKey: true,
          ...modifier,
        }),
      ).toBe(true);
      expect(state().connections).toEqual(entries);
    },
  );
  it("does not reorder a filtered view", async () => {
    mount(entries, true, { searchTerm: "Bravo" });
    expect(
      fireEvent.keyDown(await row("Bravo"), { key: "ArrowUp", altKey: true }),
    ).toBe(true);
    expect(state().connections).toEqual(entries);
  });
  it("honors a lock enabled after a successful keyboard move", async () => {
    const view = mount();
    fireEvent.keyDown(await row("Bravo"), { key: "ArrowUp", altKey: true });
    const before = state().connections;
    view.rerender(
      <ToastProvider>
        <ConnectionProvider>
          <Seed data={entries} enabled={false} />
        </ConnectionProvider>
      </ToastProvider>,
    );
    expect(
      fireEvent.keyDown(await row("Bravo"), { key: "ArrowDown", altKey: true }),
    ).toBe(true);
    expect(state().connections).toEqual(before);
  });
  it("enforces maximum subtree depth on indent", async () => {
    const data = [...entries];
    let parent = "Bravo";
    for (let i = 0; i < 7; i++) {
      const id = `deep${i}`;
      data.push(folder(id, { parentId: parent }));
      parent = id;
    }
    mount(data);
    expect(
      fireEvent.keyDown(await row("Bravo"), {
        key: "ArrowRight",
        altKey: true,
      }),
    ).toBe(true);
    expect(state().connections).toEqual(data);
  });
});
