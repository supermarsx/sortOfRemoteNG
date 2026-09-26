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
import { Sidebar } from "../../src/components/connection/Sidebar";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";

vi.mock("../../src/contexts/useConnections", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/contexts/useConnections")>();
  return {
    useConnections: () => ({
      ...actual.useConnections(),
      databaseAvailability: {
        status: "ready",
        databaseId: "folder-focus",
        generation: 1,
      },
    }),
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      fallback ?? (key === "connections.newFolder" ? "New Folder" : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: async () => [] }));

function Fixture() {
  const { state, dispatch } = useConnections();
  React.useEffect(() => {
    dispatch({
      type: "SET_CONNECTIONS",
      payload: [
        {
          id: "parent",
          name: "Parent folder",
          protocol: "rdp",
          hostname: "",
          port: 3389,
          isGroup: true,
          expanded: true,
          createdAt: "2026-09-26",
          updatedAt: "2026-09-26",
        },
      ],
    });
  }, [dispatch]);
  return (
    <>
      <Sidebar
        sidebarPosition="left"
        onToggleSidebarPosition={() => {}}
        onNewConnection={() => {}}
        onEditConnection={() => {}}
        onDeleteConnection={() => {}}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onDiagnostics={() => {}}
        onSessionDetach={() => {}}
        onShowPasswordDialog={() => {}}
        enableConnectionReorder={false}
        noCollection={false}
      />
      <output data-testid="folder-state">
        {JSON.stringify(state.connections)}
      </output>
    </>
  );
}

describe("new folder name focus", () => {
  it.each(["toolbar", "tree"])(
    "selects the whole name from %s, preserves edits and focus, and selects again on reopen",
    async (source) => {
      const typeIntoSelection = (input: HTMLInputElement, text: string) => {
        expect(input).toHaveFocus();
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? 0;
        fireEvent.change(input, {
          target: {
            value: input.value.slice(0, start) + text + input.value.slice(end),
          },
        });
      };
      render(
        <React.StrictMode>
          <ToastProvider>
            <ConnectionProvider>
              <Fixture />
            </ConnectionProvider>
          </ToastProvider>
        </React.StrictMode>,
      );
      const open = async () => {
        if (source === "tree") {
          fireEvent.contextMenu(await screen.findByText("Parent folder"));
          fireEvent.click(
            await screen.findByRole("button", { name: "New subfolder" }),
          );
        } else {
          fireEvent.click(screen.getByTitle("New Folder"));
        }
        const dialog = await screen.findByRole("dialog", {
          name: "Rename Connection",
        });
        const input = within(dialog).getByRole("textbox") as HTMLInputElement;
        await waitFor(() => {
          expect(input).toHaveFocus();
          expect(input.selectionStart).toBe(0);
          expect(input.selectionEnd).toBe("New Folder".length);
        });
        return { dialog, input };
      };

      const { dialog, input } = await open();
      typeIntoSelection(input, "Infrastructure");
      expect(input).toHaveValue("Infrastructure");
      input.setSelectionRange(3, 3);
      typeIntoSelection(input, "X");
      expect(input).toHaveValue("InfXrastructure");
      const save = within(dialog).getByRole("button", { name: "Save" });
      save.focus();
      // Exercise a sidebar rerender while focus belongs to a dialog button.
      fireEvent.change(screen.getByTestId("sidebar-search"), {
        target: { value: "parent" },
      });
      await act(async () => {
        await new Promise(requestAnimationFrame);
      });
      expect(save).toHaveFocus();
      expect(input).toHaveValue("InfXrastructure");
      fireEvent.keyDown(save, { key: "Tab" });
      expect(
        within(dialog).getByRole("button", { name: "Close" }),
      ).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, {
        key: "Tab",
        shiftKey: true,
      });
      expect(save).toHaveFocus();
      fireEvent.click(save);
      expect(screen.getByTestId("folder-state").textContent).toContain(
        "InfXrastructure",
      );

      const reopened = await open();
      typeIntoSelection(reopened.input, "Discard this rename");
      fireEvent.keyDown(reopened.input, { key: "Escape" });
      expect(reopened.dialog).not.toBeInTheDocument();
      const again = await open();
      expect(again.input).toHaveValue("New Folder");
    },
  );
});
