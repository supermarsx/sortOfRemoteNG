import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../src/i18n";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";
import { NetworkDiscovery } from "../src/components/NetworkDiscovery";

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
    expect(screen.getByText("Network Discovery")).toBeInTheDocument();

    await i18n.changeLanguage("es");
    rerender(
      <I18nextProvider i18n={i18n}>
        <ConnectionProvider>
          <NetworkDiscovery isOpen onClose={() => {}} />
        </ConnectionProvider>
      </I18nextProvider>,
    );
    expect(screen.getByText("Descubrimiento de Red")).toBeInTheDocument();
  });
});
