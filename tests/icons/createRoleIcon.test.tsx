import React, { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Terminal } from "lucide-react";
import {
  createRoleIcon,
  type IconRole,
} from "../../src/utils/icons/createRoleIcon";
import { createBrandIcon } from "../../src/utils/icons/brand/createBrandIcon";
import { FOLDER_ICONS } from "../../src/utils/icons/catalog/folders";

const roles: IconRole[] = [
  "folder",
  "server",
  "management-server",
  "database",
  "access-point",
  "switch",
  "router",
  "wired-router",
  "nas",
  "cloud",
  "printer",
  "laptop",
  "desktop",
  "remote-desktop",
  "phone",
  "desk-phone",
  "olt",
  "wall-terminal",
  "tablet",
  "ups",
  "pdu",
  "iot",
  "firewall",
  "vpn",
  "camera",
  "recorder",
];

describe("role icon composites", () => {
  it("matches Lucide's decorative default without hiding explicitly accessible icons", () => {
    const Icon = createRoleIcon("AccessibleRole", "server", Terminal);
    render(
      <>
        <Icon data-testid="decorative" />
        <Icon data-testid="explicit" aria-hidden={false} />
        <Icon data-testid="labelled" aria-label="SSH server" />
        <Icon data-testid="titled">
          <title>SSH server</title>
        </Icon>
      </>,
    );
    expect(screen.getByTestId("decorative")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("explicit")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    expect(screen.getByTestId("labelled")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByTestId("titled")).not.toHaveAttribute("aria-hidden");
  });

  it.each(roles)(
    "renders the %s frame and mark as self-contained vectors",
    (role) => {
      const Icon = createRoleIcon(`Test${role}`, role, Terminal);
      const { container } = render(
        <Icon size={16} aria-label={`${role} terminal`} />,
      );
      const svg = screen.getByLabelText(`${role} terminal`);
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("width", "16");
      expect(svg).toHaveAttribute("height", "16");
      expect(
        svg.querySelector(`[data-role-frame="${role}"]`),
      ).not.toBeEmptyDOMElement();
      const glyph = svg.querySelector("svg");
      expect(glyph).toHaveAttribute("aria-hidden", "true");
      expect(glyph).toHaveAttribute("focusable", "false");
      expect(Number(glyph?.getAttribute("x"))).toBeGreaterThanOrEqual(0);
      expect(Number(glyph?.getAttribute("y"))).toBeGreaterThanOrEqual(0);
      expect(
        Number(glyph?.getAttribute("x")) + Number(glyph?.getAttribute("width")),
      ).toBeLessThanOrEqual(24);
      expect(
        Number(glyph?.getAttribute("y")) +
          Number(glyph?.getAttribute("height")),
      ).toBeLessThanOrEqual(24);
      expect(
        container.querySelector("image, text, foreignObject, use"),
      ).toBeNull();
    },
  );

  it("keeps role silhouettes genuinely distinct, not just their labels", () => {
    const frames = roles.map((role) => {
      const Icon = createRoleIcon(`Shape${role}`, role, Terminal);
      const { container, unmount } = render(<Icon />);
      const geometry = container.querySelector("[data-role-frame]")?.innerHTML;
      unmount();
      return geometry;
    });
    expect(new Set(frames).size).toBe(roles.length);
  });

  it.each([14, 16, 24, 32])(
    "keeps the remote-desktop frame and inset stable at %spx",
    (size) => {
      const Icon = createRoleIcon(
        "RemoteDesktopSizing",
        "remote-desktop",
        Terminal,
      );
      const { container } = render(<Icon size={size} />);
      const svg = container.firstElementChild;
      expect(svg).toHaveAttribute("width", String(size));
      expect(svg).toHaveAttribute("height", String(size));
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg?.querySelector("svg")).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg?.querySelector("svg")).toHaveAttribute("width", "12");
      expect(svg?.querySelector("svg")).toHaveAttribute("height", "11");
      expect(
        svg?.querySelector('[data-role-frame="remote-desktop"] path'),
      ).toHaveAttribute("d", "M5 20h14m-3-3 3 3-3 3M8 17l-3 3 3 3");
    },
  );

  it("forwards the SVG ref, accessibility, sizing, color and stroke contract", () => {
    const Icon = createRoleIcon("AccessibleFolder", "folder", Terminal);
    const ref = createRef<SVGSVGElement>();
    render(
      <Icon
        ref={ref}
        size={16}
        color="#369abc"
        strokeWidth={3}
        absoluteStrokeWidth
        className="text-primary"
        role="img"
        aria-label="SSH folder"
      >
        <title>Secure shell folder</title>
      </Icon>,
    );
    const svg = screen.getByRole("img", { name: "SSH folder" });
    expect(ref.current).toBe(svg);
    expect(svg).toHaveClass("text-primary", "sor-role-icon-folder");
    expect(svg).toHaveAttribute("color", "#369abc");
    expect(svg).toHaveAttribute("stroke", "#369abc");
    expect(svg).toHaveAttribute("stroke-width", "4.5");
    expect(svg.querySelector("title")).toHaveTextContent("Secure shell folder");
  });

  it("preserves solid brand glyphs and current-color fills inside the frame", () => {
    const Mark = createBrandIcon("TestBrand", "M3 3h18v18H3Z");
    const Icon = createRoleIcon("BrandedServer", "server", Mark);
    const { container } = render(<Icon color="#a43a72" />);
    const mark = container.querySelector("svg svg path");
    expect(mark).toHaveAttribute("d", "M3 3h18v18H3Z");
    expect(mark).toHaveAttribute("fill", "currentColor");
    expect(mark).toHaveAttribute("stroke", "none");
    expect(container.firstElementChild).toHaveAttribute("color", "#a43a72");
  });

  it("gives every requested folder type a different inset glyph", () => {
    const keys = [
      "folder-work",
      "folder-personal",
      "folder-remote",
      "folder-rdp",
      "folder-phone",
      "folder-switch",
      "folder-router",
      "folder-web",
      "folder-admin",
      "folder-ssh",
      "folder-server",
      "folder-nas",
      "folder-access-point",
    ];
    const marks = keys.map((key) => {
      const definition = FOLDER_ICONS.find(
        (candidate) => candidate.key === key,
      );
      expect(definition, key).toBeDefined();
      if (!definition) throw new Error(`Missing requested folder ${key}`);
      const Icon = definition.icon;
      const { container, unmount } = render(<Icon size={16} />);
      expect(
        container.querySelector('[data-role-frame="folder"]'),
      ).toBeInTheDocument();
      const geometry = container.querySelector("svg svg")?.innerHTML;
      unmount();
      return geometry;
    });
    expect(new Set(marks).size).toBe(keys.length);
  });
});
