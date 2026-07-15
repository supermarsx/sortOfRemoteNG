import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultRawSocketSettings } from "../../types/protocols/rawSocket";
import { createRawSocketTranscript } from "../../utils/protocols/rawSocket/transcript";
import type { ConnectionSession } from "../../types/connection/connection";

const { hookMock } = vi.hoisted(() => ({ hookMock: vi.fn() }));

vi.mock("../../hooks/protocol/useRawSocketSession", () => ({
  useRawSocketSession: (...args: unknown[]) => hookMock(...args),
}));

import { RawSocketClient } from "./RawSocketClient";

const session: ConnectionSession = {
  id: "frontend-raw-1",
  connectionId: "connection-raw-1",
  name: "Binary endpoint",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "raw",
  hostname: "binary.example.test",
};

const createModel = (transport: "tcp" | "udp" = "tcp") => ({
  status: "connected" as const,
  error: null,
  backendSessionId: "backend-raw-1",
  settings: createDefaultRawSocketSettings(transport),
  transcript: createRawSocketTranscript(),
  stats: {
    bytesSent: 0,
    bytesReceived: 0,
    framesSent: 0,
    framesReceived: 0,
    datagramsSent: 0,
    datagramsReceived: 0,
    deliveryFailures: 0,
    replayEvictions: 0,
    connectedAtMs: 1,
    lastActivityAtMs: 1,
  },
  localAddress: "127.0.0.1:41000",
  remoteAddress: "127.0.0.1:9000",
  send: vi.fn().mockResolvedValue(undefined),
  shutdownWrite: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  clearTranscript: vi.fn(),
});

beforeEach(() => {
  hookMock.mockReset();
  hookMock.mockReturnValue(createModel());
});

describe("RawSocketClient", () => {
  it("offers labelled binary-safe composer controls and does not locally echo", async () => {
    const model = createModel();
    hookMock.mockReturnValue(model);
    render(<RawSocketClient session={session} />);

    expect(
      screen.getByRole("region", {
        name: "Raw Socket session to binary.example.test",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("log", { name: "Raw Socket transcript" }),
    ).toHaveTextContent("No application payload chunks received or sent yet.");

    fireEvent.change(screen.getByLabelText("Composer format"), {
      target: { value: "hex" },
    });
    fireEvent.change(screen.getByLabelText("Raw Socket payload"), {
      target: { value: "00 ff 80 0a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send payload" }));

    await waitFor(() =>
      expect(model.send).toHaveBeenCalledWith(
        Uint8Array.of(0x00, 0xff, 0x80, 0x0a),
      ),
    );
    expect(screen.getByRole("log")).toHaveTextContent(
      "No application payload chunks received or sent yet.",
    );
  });

  it("renders exact binary entries in hex and labels UDP datagrams", () => {
    const model = createModel("udp");
    model.settings.data.displayEncoding = "hex";
    model.transcript = {
      ...createRawSocketTranscript(),
      entries: [
        {
          id: "backend-raw-1:1",
          sequence: 1,
          timestampMs: 1_700_000_000_000,
          direction: "inbound",
          transport: "udp",
          data: Uint8Array.of(0x00, 0xff, 0x80),
        },
      ],
      totalBytes: 3,
    };
    hookMock.mockReturnValue(model);

    render(<RawSocketClient session={session} />);

    expect(screen.getByRole("log")).toHaveTextContent("00 ff 80");
    expect(screen.getByRole("log")).toHaveTextContent("datagram");
    expect(
      screen.getByRole("button", { name: "Half-close write" }),
    ).toBeDisabled();
  });

  it("exposes clear, half-close, and disconnect actions", async () => {
    const model = createModel();
    hookMock.mockReturnValue(model);
    render(<RawSocketClient session={session} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear transcript" }));
    fireEvent.click(screen.getByRole("button", { name: "Half-close write" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(model.clearTranscript).toHaveBeenCalledOnce();
    await waitFor(() => expect(model.shutdownWrite).toHaveBeenCalledOnce());
    await waitFor(() => expect(model.disconnect).toHaveBeenCalledOnce());
  });
});
