import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n, { loadLanguage } from "../../src/i18n";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { NetworkDiscovery } from "../../src/components/network/NetworkDiscovery";
import {
  getDiscoveredServiceLabel,
  NetworkScanner,
} from "../../src/utils/network/networkScanner";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

beforeEach(() => {
  invokeMock.mockResolvedValue([]);
});

afterEach(() => {
  invokeMock.mockReset();
  vi.restoreAllMocks();
});

const renderWithProviders = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ConnectionProvider>
        <NetworkDiscovery isOpen onClose={() => {}} />
      </ConnectionProvider>
    </I18nextProvider>,
  );

describe("NetworkDiscovery i18n", () => {
  it("labels only banner-confirmed VNC as raw RFB over TCP", () => {
    expect(
      getDiscoveredServiceLabel({
        port: 5900,
        protocol: "vnc",
        service: "vnc",
        banner: "RFB 003.008",
      }),
    ).toBe("VNC (RFB/TCP)");
    expect(
      getDiscoveredServiceLabel({
        port: 5900,
        protocol: "unknown",
        service: "unknown",
      }),
    ).toBe("UNKNOWN");
  });

  it("renders service-aware results from the bounded scanner", async () => {
    await i18n.changeLanguage("en-US");
    invokeMock.mockResolvedValue(["192.0.2.10", "192.0.2.11"]);
    const scan = vi.spyOn(NetworkScanner.prototype, "scanNetwork").mockResolvedValue([
      {
        ip: "192.0.2.10",
        openPorts: [5999],
        services: [
          {
            port: 5999,
            protocol: "vnc",
            service: "vnc",
            version: "003.008",
            banner: "RFB 003.008",
          },
        ],
        responseTime: 12,
      },
    ]);
    renderWithProviders();

    fireEvent.click(screen.getByRole("button", { name: "Start Scan" }));

    expect(await screen.findByText("VNC (RFB/TCP)")).toBeInTheDocument();
    expect(screen.getByText("Port 5999")).toBeInTheDocument();
    expect(screen.getByText("192.0.2.11")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("scan_network", {
      subnet: "192.168.1.0/24",
      maxConcurrent: 50,
    });
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({
        customPorts: expect.objectContaining({ vnc: [5900, 5901, 5902] }),
        probeStrategies: expect.objectContaining({ vnc: ["rfb"] }),
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("stops promptly and aborts the active scanner run", async () => {
    await i18n.changeLanguage("en-US");
    let resolvePing: ((value: string[]) => void) | undefined;
    invokeMock.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolvePing = resolve;
      }),
    );
    let activeSignal: AbortSignal | undefined;
    vi.spyOn(NetworkScanner.prototype, "scanNetwork").mockImplementation(
      (_config, _onProgress, signal) =>
        new Promise((resolve) => {
          activeSignal = signal;
          signal?.addEventListener(
            "abort",
            () =>
              resolve([
                {
                  ip: "192.0.2.99",
                  openPorts: [5900],
                  services: [
                    {
                      port: 5900,
                      protocol: "vnc",
                      service: "vnc",
                      banner: "RFB 003.008",
                    },
                  ],
                  responseTime: 10,
                },
              ]),
            { once: true },
          );
        }),
    );
    renderWithProviders();
    fireEvent.click(screen.getByRole("button", { name: "Start Scan" }));

    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(activeSignal?.aborted).toBe(false);
    fireEvent.click(stop);

    await waitFor(() => expect(activeSignal?.aborted).toBe(true));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument(),
    );
    resolvePing?.(["192.0.2.77"]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("192.0.2.99")).not.toBeInTheDocument();
    expect(screen.queryByText("192.0.2.77")).not.toBeInTheDocument();
  });

  it("renders translated text when switching locales", async () => {
    await i18n.changeLanguage("en-US");
    const { rerender } = renderWithProviders();
    expect(await screen.findByText("Network Discovery")).toBeInTheDocument();

    await act(async () => {
      await loadLanguage("es-ES");
      await i18n.changeLanguage("es-ES");
    });
    rerender(
      <I18nextProvider i18n={i18n}>
        <ConnectionProvider>
          <NetworkDiscovery isOpen onClose={() => {}} />
        </ConnectionProvider>
      </I18nextProvider>,
    );
    expect(
      await screen.findByText("Descubrimiento de Red"),
    ).toBeInTheDocument();

    await act(async () => {
      await loadLanguage("fr-FR");
      await i18n.changeLanguage("fr-FR");
    });
    rerender(
      <I18nextProvider i18n={i18n}>
        <ConnectionProvider>
          <NetworkDiscovery isOpen onClose={() => {}} />
        </ConnectionProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByText("Découverte du Réseau")).toBeInTheDocument();

    await act(async () => {
      await loadLanguage("pt-PT");
      await i18n.changeLanguage("pt-PT");
    });
    rerender(
      <I18nextProvider i18n={i18n}>
        <ConnectionProvider>
          <NetworkDiscovery isOpen onClose={() => {}} />
        </ConnectionProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByText("Deteção de Rede")).toBeInTheDocument();
  });
});
