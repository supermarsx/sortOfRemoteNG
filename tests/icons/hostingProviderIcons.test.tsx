import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { BRAND_ICONS } from "../../src/utils/icons/brand";

const REQUESTED = [
  ["display-multi-screen", "multi-screen", "servers-devices"],
  ["dns-pt", "dns.pt", "domain-registrars"],
  ["dominios-pt", "dominios.pt", "domain-registrars"],
  ["ptisp", "ptisp", "hosting-providers"],
  ["ptservidor", "ptservidor", "hosting-providers"],
  ["webtuga", "webtuga", "hosting-providers"],
  ["amen-pt", "amen.pt", "domain-registrars"],
  ["hetzner", "hetzner.com", "cloud"],
  ["ovh", "ovhcloud", "cloud"],
  ["scaleway", "scaleway.com", "cloud"],
  ["time4vps", "time4vps", "hosting-providers"],
  ["hostinger", "hostinger", "hosting-providers"],
  ["netcup", "netcup", "hosting-providers"],
  ["upcloud", "upcloud", "hosting-providers"],
  ["wpengine", "wpengine", "hosting-providers"],
  ["bluehost", "bluehost", "hosting-providers"],
  ["freenom", "freenom", "domain-registrars"],
  ["rackspace", "rackspace", "hosting-providers"],
  ["namesilo", "namesilo", "domain-registrars"],
  ["wix", "wix.com", "hosting-providers"],
  ["network-solutions", "network solutions", "domain-registrars"],
  ["spaceship", "spaceship registrar", "domain-registrars"],
  ["noip", "no-ip", "domain-registrars"],
  ["dynamic-dns", "dynamicDNS", "domain-registrars"],
  ["sapo", "sapo.pt", "isp-providers"],
  ["cogent", "cogent communications", "isp-providers"],
  ["claranet", "clara net", "isp-providers"],
  ["isp", "generic isp", "isp-providers"],
  ["putty", "putty", "remote-protocols"],
  ["contabo", "contabo", "hosting-providers"],
  ["vultr", "vultr", "hosting-providers"],
  ["ec2-instance", "ec2 instance", "cloud"],
  ["hostgator", "hostgator", "hosting-providers"],
  ["exoscale", "exoscale", "hosting-providers"],
] as const;

function svg(key: string, size = 24) {
  const definition = getConnectionIconDefinition(key)!;
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(definition.icon, {
        size,
        color: "#2899bd",
        "aria-label": definition.ariaLabel,
      }),
    ),
    "image/svg+xml",
  ).documentElement;
}

describe("hosting, registrar and ISP expansion", () => {
  it.each(REQUESTED)(
    "finds and restores %s from %s in %s",
    (key, query, category) => {
      expect(
        CONNECTION_ICON_CATALOG.filter((entry) => entry.key === key),
      ).toHaveLength(1);
      expect(getConnectionIconDefinition(key)?.category).toBe(category);
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        key,
      );
      expect(
        resolveEffectiveConnectionIcon(
          JSON.parse(JSON.stringify({ protocol: "ssh", icon: key })),
        ),
      ).toMatchObject({ key, source: "override" });
    },
  );
  it.each(REQUESTED)(
    "keeps %s a themed local unframed vector at16/24/32px",
    (key) => {
      for (const size of [16, 24, 32]) {
        const node = svg(key, size);
        expect(node.getAttribute("width")).toBe(String(size));
        expect(node.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(node.getAttribute("stroke")).toBe("#2899bd");
        expect(node.getAttribute("aria-label")).toBeTruthy();
        expect(
          node.querySelector(
            "text,image,use,script,foreignObject,[data-role-frame]",
          ),
        ).toBeNull();
        expect(node.querySelector("path,rect,polygon")).not.toBeNull();
      }
    },
  );
  it("keeps existing registrar keys browsable beside the new registrars", () => {
    for (const key of [
      "porkbun",
      "namecheap",
      "godaddy",
      "gandi",
      "cloudflare",
      "noip",
    ])
      expect(getConnectionIconDefinition(key)?.category).toBe(
        "domain-registrars",
      );
    expect(getConnectionIconDefinition("ionos")?.category).toBe(
      "hosting-providers",
    );
    expect(filterConnectionIcons("no ip").map((entry) => entry.key)).toContain(
      "noip",
    );
    expect(
      filterConnectionIcons("domínios.pt").map((entry) => entry.key),
    ).toContain("dominios-pt");
  });
  it("does not invent duplicate persisted aliases or assume Level4 means Level3", () => {
    for (const alias of ["ovhcloud", "no-ip", "wix.com", "level4", "level3"])
      expect(getConnectionIconDefinition(alias)).toBeUndefined();
  });
  it("discloses fallback artwork instead of publishing it as official branding", () => {
    for (const key of ["dns-pt", "time4vps", "network-solutions", "cogent"]) {
      const entry = getConnectionIconDefinition(key)!;
      expect(entry.description).toContain("app-authored");
      expect(entry.description).toContain("not an official logo");
      expect(Object.values(BRAND_ICONS)).not.toContain(entry.icon);
    }
    expect(getConnectionIconDefinition("freenom")?.description).toContain(
      "historical",
    );
    expect(getConnectionIconDefinition("bluehost")?.description).toContain(
      "2019",
    );
  });
  it("preserves Claranet's independent relative-path origins", () => {
    expect(getConnectionIconDefinition("noip")?.description).toContain(
      "traced from its raster",
    );
    expect(svg("noip").innerHTML).not.toBe(svg("dynamic-dns").innerHTML);
    expect(getConnectionIconDefinition("amen-pt")?.description).toContain(
      "traced from its raster",
    );
    const paths = [...svg("claranet").querySelectorAll("path")];
    expect(paths).toHaveLength(3);
    expect(paths.map((p) => p.getAttribute("d")?.slice(0, 6))).toEqual([
      "m24.49",
      "m36.37",
      "m25.64",
    ]);
    for (const p of paths)
      expect(p.getAttribute("transform")).toBe("translate(0 0.5) scale(0.5)");
  });
  it("preserves EC2 and SAPO knockout rules and crops wordmarks without off-canvas paths", () => {
    expect(
      svg("ec2-instance").querySelector("path")?.getAttribute("fill-rule"),
    ).toBe("evenodd");
    expect(svg("sapo").querySelector("path")?.getAttribute("fill-rule")).toBe(
      "evenodd",
    );
    expect(svg("dominios-pt").querySelector("path")?.getAttribute("d")).toMatch(
      /^M23\.11/,
    );
    expect(svg("rackspace").querySelector("path")?.getAttribute("d")).toMatch(
      /^M10\.0488 13\.2054 l1\.0282/,
    );
    expect(
      svg("freenom").querySelector("path")?.getAttribute("d"),
    ).not.toContain("M43 19.4");
  });
});
