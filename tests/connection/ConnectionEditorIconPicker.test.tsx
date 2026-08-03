import React, { useEffect } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { useConnections } from "../../src/contexts/useConnections";
import type { Connection } from "../../src/types/connection/connection";

const i18nMock = vi.hoisted(() => {
  const t = vi.fn(
    (
      key: string,
      fallbackOrOptions?:
        | string
        | ({ defaultValue?: string } & Record<string, unknown>),
      interpolation?: Record<string, unknown>,
    ) => {
      const options =
        typeof fallbackOrOptions === "object"
          ? fallbackOrOptions
          : interpolation;
      const template =
        typeof fallbackOrOptions === "string"
          ? fallbackOrOptions
          : (fallbackOrOptions?.defaultValue ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
        const value = options?.[token];
        return value == null ? match : String(value);
      });
    },
  );
  return {
    t,
    i18n: {
      language: "en",
      changeLanguage: vi.fn(async () => undefined),
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => i18nMock,
}));

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  }),
}));

vi.mock("../../src/components/connection/TagManager", () => ({
  TagManager: () => <div data-testid="icon-test-tag-manager" />,
}));

const ConnectionStateProbe: React.FC<{
  initialConnections?: Connection[];
  onConnections: (connections: Connection[]) => void;
}> = ({ initialConnections, onConnections }) => {
  const { state, dispatch } = useConnections();

  useEffect(() => {
    if (initialConnections) {
      dispatch({ type: "SET_CONNECTIONS", payload: initialConnections });
    }
  }, [dispatch, initialConnections]);

  useEffect(() => {
    onConnections(state.connections);
  }, [onConnections, state.connections]);

  return null;
};

const renderEditor = async (
  props: React.ComponentProps<typeof ConnectionEditor>,
  onConnections: (connections: Connection[]) => void,
  initialConnections?: Connection[],
) => {
  const view = render(
    <ConnectionProvider>
      <ConnectionStateProbe
        initialConnections={initialConnections}
        onConnections={onConnections}
      />
      <ConnectionEditor {...props} />
    </ConnectionProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
};

describe("ConnectionEditor icon persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a stable icon key, restores it on reopen, and clears back to automatic", async () => {
    let latestConnections: Connection[] = [];
    const createClose = vi.fn();
    const firstRender = await renderEditor(
      { isOpen: true, onClose: createClose },
      (connections) => {
        latestConnections = connections;
      },
    );

    fireEvent.change(screen.getByTestId("editor-name"), {
      target: { value: "Icon persistence" },
    });
    fireEvent.change(screen.getByTestId("editor-hostname"), {
      target: { value: "icon.example.test" },
    });
    fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "star" } },
    );
    fireEvent.click(screen.getByRole("option", { name: /Star \(star\)/ }));
    expect(screen.getByText("Manual override")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(createClose).toHaveBeenCalledOnce();
      expect(latestConnections).toHaveLength(1);
    });

    const saved = latestConnections[0];
    expect(saved.icon).toBe("star");
    expect(typeof saved.icon).toBe("string");
    expect(saved).not.toHaveProperty("iconComponent");

    act(() => firstRender.unmount());
    latestConnections = [];
    const reopenedRender = await renderEditor(
      { connection: saved, isOpen: true, onClose: vi.fn() },
      (connections) => {
        latestConnections = connections;
      },
      [saved],
    );

    await waitFor(() => expect(latestConnections).toHaveLength(1));
    fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
    expect(screen.getByText("Manual override")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Current effective icon: Star"),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "star" } },
    );
    expect(
      screen.getByRole("option", { name: /Star \(star\)/ }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Use automatic icon" }));
    await waitFor(() => {
      expect(screen.getByText("Automatic · RDP protocol")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Use automatic icon" }),
      ).toBeDisabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await Promise.resolve();
    });

    await waitFor(async () => {
      expect(latestConnections[0]?.icon).toBeUndefined();
      await Promise.resolve();
    });
    const cleared = latestConnections[0];
    act(() => reopenedRender.unmount());

    const finalRender = await renderEditor(
      { connection: cleared, isOpen: true, onClose: vi.fn() },
      () => {},
      [cleared],
    );
    fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
    expect(
      screen.getByLabelText("Current effective icon: Desktop"),
    ).toBeInTheDocument();
    expect(screen.getByText("Automatic · RDP protocol")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use automatic icon" }),
    ).toBeDisabled();
    act(() => finalRender.unmount());
  });

  it("finds integration icon vocabulary through editor search and focuses the palette", async () => {
    const connection = {
      id: "icon-search",
      name: "Searchable icon",
      protocol: "ssh",
      hostname: "search.example.test",
      port: 22,
      isGroup: false,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    } as Connection;
    const view = await renderEditor(
      { connection, isOpen: true, onClose: vi.fn() },
      () => {},
      [connection],
    );

    const editorSearch = screen.getByRole("combobox", {
      name: "Search connection settings",
    });
    fireEvent.change(editorSearch, { target: { value: "pfSense" } });
    const iconResult = screen.getByRole("option", {
      name: /Organize \/ Connection Icon.*pfSense/i,
    });
    expect(iconResult).toBeInTheDocument();
    fireEvent.click(iconResult);

    await waitFor(() => {
      expect(
        screen.getByTestId("connection-editor-tab-organize"),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        screen.getByRole("combobox", { name: "Search connection icons" }),
      ).toHaveFocus();
    });
    act(() => view.unmount());
  });
});
