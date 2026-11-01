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
import { folderSubtree } from "../../src/components/connection/connectionTree/helpers";

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

function TreeFixture({
  onNewConnection,
  initialConnections = seeds,
}: {
  onNewConnection?: (parentId: string) => void;
  initialConnections?: Connection[];
}) {
  const { state, dispatch } = useConnections();
  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: initialConnections });
    dispatch({ type: "SELECT_CONNECTION", payload: seeds[1] });
  }, [dispatch, initialConnections]);
  return (
    <>
      <ConnectionTree
        onNewConnection={onNewConnection}
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
async function mounted(
  onNewConnection?: (parentId: string) => void,
  initialConnections = seeds,
) {
  const view = render(
    <ToastProvider>
      <ConnectionProvider>
        <TreeFixture
          onNewConnection={onNewConnection}
          initialConnections={initialConnections}
        />
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
  it("opens a new connection draft for the clicked folder without persisting or copying anything", async () => {
    const onNewConnection = vi.fn();
    await mounted(onNewConnection);
    fireEvent.contextMenu(screen.getByText("Target folder"));
    fireEvent.click(
      await screen.findByRole("button", { name: "New connection" }),
    );
    expect(onNewConnection).toHaveBeenCalledExactlyOnceWith("target");
    expect(current()).toEqual(seeds);
    expect(screen.queryByTestId("connection-tree-item-menu")).toBeNull();
    fireEvent.contextMenu(screen.getByText("Saved endpoint"));
    expect(screen.queryByRole("button", { name: "New connection" })).toBeNull();
  });
  it("creates an empty child of the clicked folder, expands that parent, and uses the existing rename flow", async () => {
    await mounted();
    const dialog = await createChild();
    expect(
      within(dialog).getByRole("dialog", { name: "Rename Connection" }),
    ).toBeVisible();
    const title = within(dialog).getByText("Rename Connection");
    const closeButton = within(dialog).getByRole("button", { name: "Close" });
    expect(title).toHaveClass("sor-modal-title");
    expect(title).not.toHaveClass("absolute");
    expect(closeButton.parentElement).toHaveClass("sor-modal-header-actions");
    expect(
      title.compareDocumentPosition(closeButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

describe("folder subtree expansion context actions", () => {
  const folder = (
    id: string,
    name: string,
    parentId: string,
    expanded = false,
  ): Connection => ({
    id,
    name,
    parentId,
    expanded,
    isGroup: true,
    protocol: "rdp",
    hostname: "",
    port: 3389,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const nested = [
    ...seeds,
    folder("child", "Nested folder", "target"),
    folder("grandchild", "Deep folder", "child"),
    folder("sibling", "Sibling folder", "target", true),
    folder("other-child", "Unrelated nested folder", "other"),
    {
      ...seeds[2],
      id: "deep-endpoint",
      name: "Deep endpoint",
      parentId: "grandchild",
      expanded: true,
    },
    {
      ...seeds[2],
      id: "other-endpoint",
      name: "Unrelated endpoint",
      parentId: "other",
    },
  ];
  it("expands and collapses the clicked folder and all loaded descendant folders while preserving unrelated branches", async () => {
    await mounted(undefined, nested);
    expect(screen.queryByText("Nested folder")).toBeNull();
    expect(screen.getByText("Unrelated endpoint")).toBeVisible();
    fireEvent.contextMenu(screen.getByText("Target folder"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Expand all" }),
    );
    expect(screen.getByText("Deep endpoint")).toBeVisible();
    expect(screen.queryByTestId("connection-tree-item-menu")).toBeNull();
    for (const id of ["target", "child", "grandchild", "sibling"])
      expect(current().find((row) => row.id === id)?.expanded).toBe(true);
    for (const id of [
      "other",
      "other-child",
      "other-endpoint",
      "deep-endpoint",
      "endpoint",
    ])
      expect(current().find((row) => row.id === id)).toEqual(
        nested.find((row) => row.id === id),
      );
    fireEvent.contextMenu(screen.getByText("Target folder"));
    expect(
      await screen.findByRole("menuitem", { name: "Expand all" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all" }));
    expect(screen.queryByText("Nested folder")).toBeNull();
    expect(screen.queryByText("Deep endpoint")).toBeNull();
    expect(screen.getByText("Unrelated endpoint")).toBeVisible();
    for (const id of ["target", "child", "grandchild", "sibling"])
      expect(current().find((row) => row.id === id)?.expanded).toBe(false);
    for (const id of [
      "other",
      "other-child",
      "other-endpoint",
      "deep-endpoint",
      "endpoint",
    ])
      expect(current().find((row) => row.id === id)).toEqual(
        nested.find((row) => row.id === id),
      );
  });

  it("includes empty folders themselves and disables actions that would make no change", async () => {
    await mounted();
    fireEvent.contextMenu(screen.getByText("Target folder"));
    expect(
      await screen.findByRole("menuitem", { name: "Collapse all" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Expand all" }));
    expect(current().find((row) => row.id === "target")?.expanded).toBe(true);
    fireEvent.contextMenu(screen.getByText("Target folder"));
    expect(
      await screen.findByRole("menuitem", { name: "Expand all" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all" }));
    expect(current().find((row) => row.id === "target")?.expanded).toBe(false);
  });

  it("hides folder expansion commands and their divider for endpoints and the background menu", async () => {
    const { container } = await mounted();
    fireEvent.contextMenu(screen.getByText("Saved endpoint"));
    const menu = await screen.findByTestId("connection-tree-item-menu");
    expect(
      within(menu).queryByRole("menuitem", { name: "Expand all" }),
    ).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", { name: "Collapse all" }),
    ).toBeNull();
    expect(within(menu).queryByRole("separator")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {});
    fireEvent.contextMenu(container.querySelector('[role="tree"]')!);
    expect(screen.queryByRole("menuitem", { name: "Expand all" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Collapse all" })).toBeNull();
  });

  it("bounds traversal of malformed cycles and ignores non-folder roots and descendants", () => {
    const cyclic = [
      folder("one", "One", "two"),
      folder("two", "Two", "one"),
      { ...seeds[2], parentId: "one" },
    ];
    expect(folderSubtree(cyclic, "one").map((row) => row.id)).toEqual([
      "one",
      "two",
    ]);
    expect(folderSubtree(cyclic, "endpoint")).toEqual([]);
    expect(folderSubtree(cyclic, "missing")).toEqual([]);
  });
});
