import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RawSocketOptions } from "../../src/components/connectionEditor/rawSocket/RawSocketOptions";
import {
  createDefaultRawSocketSettings,
  type RawSocketSettingsV1,
} from "../../src/types/protocols/rawSocket";

function Harness({ initial }: { initial: RawSocketSettingsV1 }) {
  const [settings, setSettings] = useState(initial);
  return <RawSocketOptions value={settings} onChange={setSettings} />;
}

describe("RawSocketOptions", () => {
  it("renders five named, non-accordion regions with an honest payload-socket boundary", () => {
    render(
      <RawSocketOptions
        value={createDefaultRawSocketSettings()}
        onChange={vi.fn()}
        targetHost="echo.example.test"
        targetPort={9000}
      />,
    );
    for (const name of [
      "Connection",
      "Data",
      "TLS",
      "Network Path",
      "Advanced",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /Connection/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/does not inject packets/i)).toBeInTheDocument();
    expect(screen.getByText(/echo\.example\.test:9000/)).toBeInTheDocument();
  });

  it("normalizes TCP-only fields away when transport changes to UDP", () => {
    const onChange = vi.fn();
    const initial = createDefaultRawSocketSettings();
    initial.tls.mode = "direct";
    initial.data.tcpFraming = { mode: "fixed_length", frameBytes: 4 };
    render(<RawSocketOptions value={initial} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Transport"), {
      target: { value: "udp" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ transport: "udp" }),
        tls: expect.objectContaining({ mode: "disabled" }),
        data: expect.objectContaining({ tcpFraming: { mode: "none" } }),
        advanced: expect.objectContaining({
          tcpNoDelay: false,
          tcpKeepaliveMs: null,
        }),
      }),
    );
  });

  it("shows datagram and DTLS constraints for UDP without TCP framing controls", () => {
    render(
      <RawSocketOptions
        value={createDefaultRawSocketSettings("udp")}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/zero-length datagrams/i)).toBeInTheDocument();
    expect(screen.getByText(/DTLS is not supported/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("TCP framing")).not.toBeInTheDocument();
    expect(screen.getByLabelText("TLS mode")).toBeDisabled();
  });

  it("allows TCP TLS configuration but clearly surfaces fail-closed runtime status", () => {
    render(<Harness initial={createDefaultRawSocketSettings()} />);
    fireEvent.change(screen.getByLabelText("TLS mode"), {
      target: { value: "starttls_manual" },
    });
    expect(screen.getByLabelText("TLS server name")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Certificate trust policy"),
    ).toBeInTheDocument();
    expect(screen.getByText(/rejects upgrade requests/i)).toBeInTheDocument();
  });

  it("summarizes unsupported routed UDP paths without offering a silent bypass", () => {
    render(
      <RawSocketOptions
        value={createDefaultRawSocketSettings("udp")}
        onChange={vi.fn()}
        networkRoutes={["socks5", "http_connect"]}
        sections={["network-path"]}
      />,
    );
    expect(
      screen.getByText(/SOCKS5 UDP Associate is not implemented/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot carry UDP datagrams/i)).toBeInTheDocument();
    expect(
      screen.getByText(/never ignores a configured route/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Connection" }),
    ).not.toBeInTheDocument();
  });

  it("updates framing through labeled controls and supports section-level composition", () => {
    render(
      <RawSocketOptions
        value={createDefaultRawSocketSettings()}
        onChange={vi.fn()}
        sections={["data"]}
      />,
    );
    expect(screen.getByRole("region", { name: "Data" })).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Advanced" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("TCP framing")).toBeInTheDocument();
  });
});
