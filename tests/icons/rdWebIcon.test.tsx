import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RD_WEB_APPLICATION_ICONS } from "../../src/utils/icons/catalog/rdWebApplications";

describe("RD Web Access identifier", () => {
  it("exports one dedicated searchable, theme-aware vector", () => {
    expect(RD_WEB_APPLICATION_ICONS).toHaveLength(1);
    const definition = RD_WEB_APPLICATION_ICONS[0];
    expect(definition.key).toBe("rd-web-access");
    expect(definition.category).toBe("web-applications");
    expect(definition.keywords).toContain("remoteapp");
    expect(definition.description).toContain("not the official Microsoft logo");
    const Icon = definition.icon;
    const svg = renderToStaticMarkup(
      <Icon aria-label={definition.ariaLabel} />,
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("currentColor");
    expect(svg).toContain("RD Web Access / RemoteApp icon");
    expect(svg).not.toMatch(/<image|fill="#[a-f0-9]+"|stroke="#[a-f0-9]+"/i);
  });
});
