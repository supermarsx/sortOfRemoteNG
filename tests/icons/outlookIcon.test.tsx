import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { BRAND_ICONS } from "../../src/utils/icons/brand";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import ApplicationIconSuggestion from "../../src/components/connectionEditor/httpOptions/ApplicationIconSuggestion";

describe("Outlook connection icon", () => {
  it.each(["Outlook", "OWA", "Exchange Outlook", "Outlook Web Access"])(
    "is searchable by %s",
    (query) => {
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        "outlook",
      );
    },
  );

  it.each(["#f8fafc", "#172033"])(
    "renders a bundled vector with theme color %s",
    (color) => {
      const entry = getConnectionIconDefinition("outlook")!;
      expect(entry.icon).toBe(BRAND_ICONS.microsoftoutlook);
      const Icon = entry.icon;
      const { container } = render(
        <Icon size={16} color={color} aria-label="Outlook" />,
      );
      expect(container.querySelector("svg")).toHaveAttribute(
        "viewBox",
        "0 0 24 24",
      );
      expect(container.querySelector("svg")).toHaveAttribute("width", "16");
      expect(container.querySelector("svg")).toHaveAttribute("stroke", color);
      expect(container.querySelector("path")).toHaveAttribute(
        "fill",
        "currentColor",
      );
      expect(
        container.querySelector("img,image,text,script,foreignObject,use"),
      ).toBeNull();
    },
  );

  it.each(["exchange-owa", "outlook-online"])(
    "suggests Outlook for %s without changing saved custom choices",
    (id) => {
      const saved = {
        protocol: "https",
        icon: "star",
        httpApplication: { version: 1, id, loginMode: "manual" },
      } satisfies Partial<Connection>;
      expect(getHttpApplicationIconSuggestion(saved)?.icon.key).toBe("outlook");
      expect(resolveEffectiveConnectionIcon(saved).key).toBe("star");
      expect(
        resolveEffectiveConnectionIcon({ ...saved, icon: "outlook" }).icon,
      ).toBe(BRAND_ICONS.microsoftoutlook);
    },
  );

  it("keeps the Exchange administration icon distinct", () => {
    expect(
      getHttpApplicationIconSuggestion({
        protocol: "https",
        httpApplication: {
          version: 1,
          id: "exchange-ecp",
          loginMode: "manual",
        },
      })?.icon.key,
    ).toBe("exchange");
  });

  it("applies the suggested OWA icon only on explicit selection", () => {
    function Fixture() {
      const [formData, setFormData] = useState<Partial<Connection>>({
        protocol: "https",
        icon: "star",
        httpApplication: {
          version: 1,
          id: "exchange-owa",
          loginMode: "manual",
        },
      });
      return (
        <>
          <ApplicationIconSuggestion
            formData={formData}
            setFormData={setFormData}
          />
          <output data-testid="selected-icon">{formData.icon}</output>
        </>
      );
    }
    render(<Fixture />);
    expect(screen.getByTestId("selected-icon")).toHaveTextContent("star");
    fireEvent.click(screen.getByRole("button", { name: "Use suggested icon" }));
    expect(screen.getByTestId("selected-icon")).toHaveTextContent("outlook");
    expect(
      screen.getByRole("button", { name: "Suggested icon selected" }),
    ).toBeDisabled();
  });
});
