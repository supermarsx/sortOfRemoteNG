import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n, { loadLanguage } from "../src/i18n";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";
import { NetworkDiscovery } from "../src/components/network/NetworkDiscovery";

const renderWithProviders = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ConnectionProvider>
        <NetworkDiscovery isOpen onClose={() => {}} />
      </ConnectionProvider>
    </I18nextProvider>,
  );

describe("NetworkDiscovery i18n", () => {
  it("renders translated text when switching locales", async () => {
    await i18n.changeLanguage("en");
    const { rerender } = renderWithProviders();
    expect(await screen.findByText("Network Discovery")).toBeInTheDocument();

    await act(async () => {
      await loadLanguage("es");
      await i18n.changeLanguage("es");
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
      await loadLanguage("fr");
      await i18n.changeLanguage("fr");
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
