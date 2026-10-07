import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

const devices = [
  {
    key: "vnc-printer",
    label: "VNC printer",
    role: "printer",
    aliases: ["printer vnc", "vnc multifunction"],
  },
  {
    key: "vnc-iot-device",
    label: "VNC IoT device",
    role: "iot",
    aliases: ["vnc iot device", "vnc internet of things", "vnc embedded"],
  },
  {
    key: "vnc-phone",
    label: "VNC phone",
    role: "phone",
    aliases: ["phone vnc device", "vnc smartphone", "vnc mobile"],
  },
] as const;

describe.each(devices)("$label", ({ key, label, role, aliases }) => {
  it("registers a unique, searchable remote protocol choice", () => {
    expect(getConnectionIconDefinition(key)).toMatchObject({
      key,
      label,
      category: "remote-protocols",
      ariaLabel: `${label} icon`,
    });
    expect(
      CONNECTION_ICON_CATALOG.filter((entry) => entry.key === key),
    ).toHaveLength(1);
    for (const query of [
      key,
      label.toUpperCase(),
      ...aliases,
      "rfb",
      "screen sharing",
      "virtual network computing",
    ]) {
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        key,
      );
    }
  });

  it.each([16, 24, 32])(
    "renders a device frame with the existing VNC vector at %ipx",
    (size) => {
      const Icon = getConnectionIconDefinition(key)!.icon;
      const VNC = getConnectionIconDefinition("vnc")!.icon;
      const { container } = render(<Icon size={size} aria-label={label} />);
      const { container: base } = render(<VNC />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("height")).toBe(String(size));
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("aria-label")).toBe(label);
      expect(svg.querySelector(`[data-role-frame="${role}"]`)).not.toBeNull();
      expect(svg.querySelector("image,img,foreignObject,text")).toBeNull();
      const glyph = svg.querySelector("svg")!;
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      expect(glyph.innerHTML).toBe(base.querySelector("svg")!.innerHTML);
    },
  );

  it.each([false, true])(
    "preserves the saved override after normalization (folder=%s)",
    (isGroup) => {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: key,
            name: label,
            protocol: "vnc",
            isGroup,
            icon: key,
          }),
        ),
      );
      expect(restored.icon).toBe(key);
      expect(
        resolveEffectiveConnectionIcon({
          ...restored,
          protocol: restored.protocol ?? "vnc",
        }),
      ).toMatchObject({
        key,
        source: "override",
        overrideState: "valid",
        icon: getConnectionIconDefinition(key)!.icon,
      });
    },
  );
});

it("keeps the device silhouettes distinct and the automatic VNC default intact", () => {
  const frames = devices.map(({ key }) => {
    const Icon = getConnectionIconDefinition(key)!.icon;
    const { container } = render(<Icon />);
    return container.querySelector("[data-role-frame]")!.innerHTML;
  });
  expect(new Set(frames).size).toBe(3);
  const icons = ["vnc", ...devices.map(({ key }) => key)].map(
    (key) => getConnectionIconDefinition(key)!.icon,
  );
  expect(new Set(icons).size).toBe(4);
  expect(resolveEffectiveConnectionIcon({ protocol: "vnc" })).toMatchObject({
    key: "vnc",
    source: "protocol",
  });
});
