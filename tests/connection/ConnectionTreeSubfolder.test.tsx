import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";

// These component fixtures exercise a deliberately available synthetic database.
vi.mock("../../src/contexts/useConnections", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/contexts/useConnections")>();
  return {
    useConnections: () => ({
      ...actual.useConnections(),
      databaseAvailability: {
        status: "ready",
        databaseId: "tree-fixture",
        generation: 1,
      },
    }),
  };
});
import type { Connection } from "../../src/types/connection/connection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      fallback ?? (key === "connections.newFolder" ? "New Folder" : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: async () => [] }));

const stamp = "2026-09-09T00:00:00.000Z";
const seeds: Connection[] = [
  {
    id: "target",
    name: "Target folder",
    protocol: "rdp",
    hostname: "",
    port: 3389,
    isGroup: true,
    expanded: false,
    createdAt: stamp,
    updatedAt: stamp,
    password: "synthetic-parent-secret",
    icon: "folder-lock",
    rdpSettings: { port: 9999 } as Connection["rdpSettings"],
  },
  {
    id: "other",
    name: "Other folder",
    protocol: "rdp",
    hostname: "",
    port: 3389,
    isGroup: true,
    expanded: true,
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: "endpoint",
    name: "Saved endpoint",
    protocol: "ssh",
    hostname: "endpoint.example.test",
    port: 22,
    isGroup: false,
    createdAt: stamp,
    updatedAt: stamp,
  },
];

function TreeFixture() {
  const { state, dispatch } = useConnections();
  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: seeds });
    dispatch({ type: "SELECT_CONNECTION", payload: seeds[1] });
  }, [dispatch]);
  return (
    <>
      <ConnectionTree
        onConnect={() => {}}
        onDisconnect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
      <output data-testid="connections-state">
        {JSON.stringify(state.connections)}
      </output>
    </>
  );
}
async function mounted() {
  const view = render(
    <ToastProvider>
      <ConnectionProvider>
        <TreeFixture />
      </ConnectionProvider>
    </ToastProvider>,
  );
  await screen.findByText("Target folder");
  return view;
}
const current = () =>
  JSON.parse(
    screen.getByTestId("connections-state").textContent!,
  ) as Connection[];
async function createChild() {
  fireEvent.contextMenu(screen.getByText("Target folder"));
  fireEvent.click(await screen.findByRole("button", { name: "New subfolder" }));
  return screen.findByTestId("connection-tree-rename-modal");
}

describe("folder New subfolder context action", () => {
  it("creates an empty child of the clicked folder, expands that parent, and uses the existing rename flow", async () => {
    await mounted();
    const dialog = await createChild();
    const added = current().filter(
      (item) => !seeds.some((seed) => seed.id === item.id),
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      parentId: "target",
      isGroup: true,
      expanded: true,
      name: "New Folder",
      hostname: "",
      protocol: "rdp",
      port: 3389,
    });
    expect(added[0].id).not.toBe("");
    expect(Number.isFinite(Date.parse(added[0].createdAt))).toBe(true);
    expect(added[0].updatedAt).toBe(added[0].createdAt);
    expect(added[0]).not.toHaveProperty("password");
    expect(added[0]).not.toHaveProperty("rdpSettings");
    expect(added[0]).not.toHaveProperty("icon");
    expect(current().find((item) => item.id === "target")?.expanded).toBe(true);
    expect(current().find((item) => item.id === "other")).toEqual(seeds[1]);
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Nested infrastructure  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByTestId("connection-tree-rename-modal")).toBeNull(),
    );
    expect(current().find((item) => item.id === added[0].id)).toMatchObject({
      name: "Nested infrastructure",
      parentId: "target",
      isGroup: true,
    });
    expect(screen.getByText("Nested infrastructure")).toBeVisible();
    expect(screen.queryByTestId("connection-tree-item-menu")).toBeNull();
  });

  it("keeps normal New Folder creation when rename is cancelled and generates a fresh ID for each child", async () => {
    await mounted();
    const first = await createChild();
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));
    const second = await createChild();
    fireEvent.click(within(second).getByRole("button", { name: "Cancel" }));
    const children = current().filter((item) => item.parentId === "target");
    expect(children).toHaveLength(2);
    expect(new Set(children.map((item) => item.id)).size).toBe(2);
    expect(
      children.every((item) => item.name === "New Folder" && item.isGroup),
    ).toBe(true);
  });

  it("does not add the folder-only action to a saved connection or empty tree context menu", async () => {
    const { container } = await mounted();
    fireEvent.contextMenu(screen.getByText("Saved endpoint"));
    expect(
      await screen.findByTestId("connection-tree-item-menu"),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "New subfolder" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {});
    fireEvent.contextMenu(container.querySelector('[role="tree"]')!);
    expect(screen.queryByRole("button", { name: "New subfolder" })).toBeNull();
    expect(current()).toHaveLength(seeds.length);
  });
});
