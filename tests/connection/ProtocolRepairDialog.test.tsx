import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import { ToastContext } from "../../src/contexts/ToastContext";
import {
  ProtocolRepairDialog,
  ProtocolRepairNotice,
} from "../../src/components/connection/ProtocolRepairDialog";
import {
  PROTOCOL_REPAIR_IGNORED_KEY,
  PROTOCOL_REPAIR_NOTIFIED_PREFIX,
} from "../../src/hooks/connection/useProtocolRepair";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = typeof fallback === "string" ? fallback : _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(`{{${k}}}`, String(v));
        }
      }
      return out;
    },
  }),
}));

function conn(partial: Partial<Connection> & { id: string }): Connection {
  return {
    name: partial.id,
    protocol: "rdp",
    hostname: "host.local",
    port: 3389,
    isGroup: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Connection;
}

const suspicious: Connection[] = [
  conn({ id: "a", name: "Portal", port: 443 }),
  conn({
    id: "b",
    name: "Router",
    hostname: "http://router.local/x",
    port: 3389,
  }),
  conn({ id: "c", name: "Desktop", port: 3389 }),
];

const toastFn = () => vi.fn((_message: string, _duration?: number) => "id");
const toast = {
  success: toastFn(),
  error: toastFn(),
  warning: toastFn(),
  info: toastFn(),
};

function renderWith(
  ui: React.ReactElement,
  connections: Connection[],
  dispatch = vi.fn(),
) {
  const value = {
    state: { connections },
    dispatch,
  } as unknown as ConnectionContextType;
  const utils = render(
    <ToastContext.Provider value={{ toast, removeAll: vi.fn() }}>
      <ConnectionContext.Provider value={value}>
        {ui}
      </ConnectionContext.Provider>
    </ToastContext.Provider>,
  );
  return { ...utils, dispatch };
}

describe("ProtocolRepairDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    renderWith(
      <ProtocolRepairDialog isOpen={false} onClose={vi.fn()} />,
      suspicious,
    );
    expect(screen.queryByTestId("protocol-repair-dialog")).toBeNull();
  });

  it("lists only suspicious rows, all checked by default", () => {
    renderWith(<ProtocolRepairDialog isOpen onClose={vi.fn()} />, suspicious);
    expect(screen.getByTestId("protocol-repair-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("protocol-repair-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("protocol-repair-row-b")).toBeInTheDocument();
    expect(screen.queryByTestId("protocol-repair-row-c")).toBeNull();
    expect(screen.getByTestId("protocol-repair-check-a")).toBeChecked();
    expect(screen.getByTestId("protocol-repair-check-b")).toBeChecked();
    expect(screen.getByTestId("protocol-repair-apply")).toHaveTextContent(
      "Fix selected (2)",
    );
  });

  it("applies only the checked rows and never touches the others", () => {
    const onClose = vi.fn();
    const { dispatch } = renderWith(
      <ProtocolRepairDialog isOpen onClose={onClose} />,
      suspicious,
    );
    fireEvent.click(screen.getByTestId("protocol-repair-check-a"));
    expect(screen.getByTestId("protocol-repair-apply")).toHaveTextContent(
      "Fix selected (1)",
    );
    fireEvent.click(screen.getByTestId("protocol-repair-apply"));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: "UPDATE_CONNECTION",
      payload: {
        id: "b",
        protocol: "http",
        port: 80,
        hostname: "router.local",
      },
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
    // One suggestion remains unfixed, so the dialog stays open.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after fixing everything", () => {
    const onClose = vi.fn();
    const { dispatch } = renderWith(
      <ProtocolRepairDialog isOpen onClose={onClose} />,
      suspicious,
    );
    fireEvent.click(screen.getByTestId("protocol-repair-apply"));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignore removes the row and persists the id", () => {
    const { dispatch } = renderWith(
      <ProtocolRepairDialog isOpen onClose={vi.fn()} />,
      suspicious,
    );
    fireEvent.click(screen.getByTestId("protocol-repair-ignore-a"));
    expect(screen.queryByTestId("protocol-repair-row-a")).toBeNull();
    expect(screen.getByTestId("protocol-repair-row-b")).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem(PROTOCOL_REPAIR_IGNORED_KEY)!),
    ).toEqual(["a"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("shows the empty state with a disabled apply button when nothing is suspicious", () => {
    renderWith(<ProtocolRepairDialog isOpen onClose={vi.fn()} />, [
      suspicious[2],
    ]);
    expect(screen.getByTestId("protocol-repair-empty")).toBeInTheDocument();
    expect(screen.getByTestId("protocol-repair-apply")).toBeDisabled();
  });

  it("offers to un-ignore from the empty state", () => {
    window.localStorage.setItem(
      PROTOCOL_REPAIR_IGNORED_KEY,
      JSON.stringify(["a", "b"]),
    );
    renderWith(<ProtocolRepairDialog isOpen onClose={vi.fn()} />, suspicious);
    expect(screen.getByTestId("protocol-repair-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("protocol-repair-reset-ignored"));
    expect(screen.getByTestId("protocol-repair-row-a")).toBeInTheDocument();
    expect(window.localStorage.getItem(PROTOCOL_REPAIR_IGNORED_KEY)).toBeNull();
  });
});

describe("ProtocolRepairNotice", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("toasts once per database id when suspicious connections exist", () => {
    const { rerender } = renderWith(
      <ProtocolRepairNotice databaseId="db1" />,
      suspicious,
    );
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info.mock.calls[0][0]).toContain("2 connection(s)");
    expect(
      window.localStorage.getItem(`${PROTOCOL_REPAIR_NOTIFIED_PREFIX}db1`),
    ).toBeTruthy();

    rerender(
      <ToastContext.Provider value={{ toast, removeAll: vi.fn() }}>
        <ConnectionContext.Provider
          value={
            {
              state: { connections: suspicious },
              dispatch: vi.fn(),
            } as unknown as ConnectionContextType
          }
        >
          <ProtocolRepairNotice databaseId="db1" />
        </ConnectionContext.Provider>
      </ToastContext.Provider>,
    );
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("stays silent without a database id or without suspicious rows", () => {
    renderWith(<ProtocolRepairNotice databaseId={null} />, suspicious);
    renderWith(<ProtocolRepairNotice databaseId="db2" />, [suspicious[2]]);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
