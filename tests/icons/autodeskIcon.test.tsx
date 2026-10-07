import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { autodesk } from "../../src/utils/icons/brand";
import {
  getConnectionIconDefinition,
  getConnectionIconsByCategory,
} from "../../src/utils/icons/connectionIconCatalog";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

describe("Autodesk connection icon", () => {
  it("registers a searchable Autodesk mark in the web application catalog", () => {
    const definition = getConnectionIconDefinition("autodesk")!;
    expect(definition).toMatchObject({
      key: "autodesk",
      label: "Autodesk",
      category: "web-applications",
      ariaLabel: "Autodesk icon",
      icon: autodesk,
    });
    expect(definition.keywords).toEqual(
      expect.arrayContaining([
        "autodesk account",
        "autocad",
        "revit",
        "fusion",
      ]),
    );
    expect(getConnectionIconsByCategory("web-applications")).toContain(
      definition,
    );
  });

  it("renders the vendored theme-aware vector without external images", () => {
    const Icon = getConnectionIconDefinition("autodesk")!.icon;
    const { container } = render(<Icon size={24} aria-label="Autodesk" />);
    expect(container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );
    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(container.querySelector("path")).toHaveAttribute(
      "fill",
      "currentColor",
    );
    expect(container.querySelector("path")).toHaveAttribute("stroke", "none");
    expect(container.querySelector("image,img,text,foreignObject")).toBeNull();
  });

  it.each(["http", "https"] as const)(
    "suggests Autodesk for its existing Account profile over %s",
    (protocol) => {
      const connection = {
        protocol,
        httpApplication: {
          version: 1 as const,
          id: "autodesk",
          loginMode: "manual" as const,
        },
      };
      expect(getHttpApplicationIconSuggestion(connection)).toMatchObject({
        applicationId: "autodesk",
        applicationLabel: "Autodesk Account",
        icon: getConnectionIconDefinition("autodesk"),
      });
      expect(resolveEffectiveConnectionIcon(connection).source).toBe(
        "protocol",
      );
      expect(connection).not.toHaveProperty("icon");
    },
  );

  it.each(["star", "custom:existing-art"])(
    "leaves the saved icon %s unchanged when offering the suggestion",
    (icon) => {
      const connection = {
        protocol: "https" as const,
        icon,
        httpApplication: {
          version: 1 as const,
          id: "autodesk",
          loginMode: "manual" as const,
        },
      };
      const before = JSON.stringify(connection);
      expect(getHttpApplicationIconSuggestion(connection)?.icon.key).toBe(
        "autodesk",
      );
      expect(JSON.stringify(connection)).toBe(before);
      if (icon === "star") {
        expect(resolveEffectiveConnectionIcon(connection)).toMatchObject({
          key: "star",
          source: "override",
        });
      }
    },
  );
});
