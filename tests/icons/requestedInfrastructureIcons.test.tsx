import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Folder, FolderOpen, Monitor, Server } from "lucide-react";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";

// Explicit acceptance inventory: keep each requested concept, including separate
// plain-brand and appliance/server roles, visible rather than relying on a count.
const REQUESTED_ICONS: readonly (readonly [key: string, search: string])[] = [
  ["folder-work", "work folder"],
  ["folder-personal", "personal folder"],
  ["folder-remote", "remote connections folder"],
  ["folder-rdp", "rdp folder"],
  ["folder-phone", "phone folder"],
  ["folder-switch", "switches folder"],
  ["folder-router", "routers folder"],
  ["folder-web", "web folder"],
  ["folder-admin", "admin folder"],
  ["folder-ssh", "ssh folder"],
  ["folder-server", "server folder"],
  ["folder-nas", "nas folder"],
  ["folder-access-point", "access point folder"],
  ["nas", "nas"],
  ["storage-server", "storage server"],
  ["access-point", "access point"],
  ["hetzner-cloud", "hetzner cloud"],
  ["ovh-cloud", "ovh cloud"],
  ["synology-nas", "synology nas"],
  ["synology", "synology"],
  ["tplink", "tplink"],
  ["dlink", "dlink"],
  ["cisco", "cisco"],
  ["hpe", "hpe"],
  ["hp", "hp"],
  ["dell", "dell"],
  ["digitalocean-cloud", "digital ocean cloud"],
  ["oracle-cloud", "oracle cloud"],
  ["alibaba-cloud", "alibaba cloud"],
  ["redhat", "redhat"],
  ["redhat-server", "redhat server"],
  ["centos", "centos"],
  ["centos-server", "centos server"],
  ["ubuntu", "ubuntu"],
  ["ubuntu-server", "ubuntu server"],
  ["mysql", "mysql"],
  ["mysql-database", "mysql database"],
  ["mongodb-database", "mongodb database"],
  ["mariadb", "mariadb"],
  ["mariadb-database", "mariadb database"],
  ["postgresql-database", "postgres database"],
  ["linode", "linode"],
  ["github", "github"],
  ["git-server", "git server"],
  ["drone-ci", "drone ci"],
  ["drone-ci-server", "droneci server"],
  ["portainer", "portainer"],
  ["portainer-server", "portainer server"],
  ["container-server", "container server"],
  ["vmware-server", "vmware server"],
  ["vmware", "vmware"],
  ["proxmox-server", "proxmox server"],
  ["proxmox", "proxmox"],
  ["virtualization-server", "virtualization server"],
  ["kubernetes", "kubernetes"],
  ["supermicro-server", "supermicro server"],
  ["dell-server", "dell server"],
  ["cisco-access-point", "cisco access point"],
  ["tplink-access-point", "tplink access point"],
  ["asus-access-point", "asus access point"],
  ["hpe-switch", "hpe switch"],
  ["levelone", "level one"],
  ["levelone-switch", "level one switch"],
  ["arista", "arista"],
  ["arista-switch", "arista switch"],
  ["freepbx", "freepbx"],
  ["freepbx-server", "freepbx server"],
  ["asterisk", "asterisk"],
  ["asterisk-server", "asterisk server"],
  ["nginx-server", "nginx server"],
  ["envoy", "envoy"],
  ["envoy-server", "envoy server"],
  ["tencent-cloud", "tencent cloud"],
  ["ibm-cloud", "ibm cloud"],
  ["ibm", "ibm"],
  ["microsoft", "microsoft"],
  ["microsoft365", "microsoft365"],
  ["redhat-cloud", "redhat cloud"],
  ["netapp", "netapp"],
  ["google", "google"],
];

// Existing saved keys before this expansion (not catalog positions/categories).
const EXISTING_KEYS =
  `cloud cloud-cog cloud-upload cloud-download cloud-lightning googlecloud azure
mail mailbox message messages send bell life-buoy at-sign database database-backup database-zap table mongodb postgresql
activity bar-chart chart gauge workflow git-branch git-commit package wrench settings code file-code bug test-tube kanban panel bot webhook
folder folder-open file file-text archive save upload download star heart circle circle-dot square triangle diamond hexagon bookmark tag flag
globe network router wifi cable waypoints radio-tower route link share radio computer generic-os cross-platform
monitor terminal eye phone monitor-play keyboard pointer anydesk rustdesk powershell shield shield-check shield-alert lock key-round fingerprint scan-face file-key pfsense
server server-cog cpu drive laptop smartphone tablet television printer camera container boxes switch access-point nas dell hp supermicro
virtual-machine hypervisor noip vmware proxmox portainer voip pbx-server freepbx web-server build-server code-server nginx traefikproxy grafana cpanel
folder-cog folder-tree folder-lock folder-archive folder-code folder-git folder-sync folder-clock folder-kanban folder-heart`.split(
    /\s+/,
  );

const ADDITIONAL_SHAPES = [
  "pentagon",
  "octagon",
  "rectangle-horizontal",
  "rectangle-vertical",
  "triangle-right",
  "circle-dashed",
  "square-dashed",
  "diamond-plus",
  "asterisk-shape",
  "cross",
  "target",
  "orbit",
];

function iconSvg(key: string): string {
  const definition = getConnectionIconDefinition(key);
  expect(definition, `Missing requested icon: ${key}`).toBeDefined();
  return renderToStaticMarkup(
    createElement(definition!.icon, {
      size: 24,
      "aria-label": definition!.ariaLabel,
    }),
  );
}

function drawing(key: string): string {
  // Compare visible children, not component names or SVG classes: two wrappers
  // around the same glyph are not distinct role variants.
  const document = new DOMParser().parseFromString(
    iconSvg(key),
    "image/svg+xml",
  );
  return document.documentElement.innerHTML.replace(/\sclass="[^"]*"/g, "");
}

describe("requested infrastructure icon coverage", () => {
  it("gives every requested folder role a distinct visible glyph", () => {
    const folderDrawings = REQUESTED_ICONS.filter(([key]) =>
      key.startsWith("folder-"),
    ).map(([key]) => drawing(key));
    expect(new Set(folderDrawings).size).toBe(folderDrawings.length);
  });

  it.each(ADDITIONAL_SHAPES)("adds the bounded shape %s", (key) => {
    expect(getConnectionIconDefinition(key)?.category).toBe("generic-shapes");
    expect(
      filterConnectionIcons(key.replace(/-/g, " ")).map(
        (definition) => definition.key,
      ),
    ).toContain(key);
    expect(iconSvg(key)).toContain("<svg");
  });

  it.each(REQUESTED_ICONS)(
    "renders and discovers %s using %s",
    (key, query) => {
      const svg = new DOMParser().parseFromString(
        iconSvg(key),
        "image/svg+xml",
      );
      expect(svg.documentElement.tagName).toBe("svg");
      expect(svg.documentElement.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(
        svg.querySelector(
          "path, rect, circle, ellipse, polygon, polyline, line, text",
        ),
      ).not.toBeNull();
      expect(
        filterConnectionIcons(query).map((definition) => definition.key),
      ).toContain(key);
    },
  );

  it.each([
    ["hetzenr cloud", "hetzner-cloud"],
    ["promxox server", "proxmox-server"],
    ["postegres databse", "postgresql-database"],
    ["postgres database", "postgresql-database"],
    ["mongodb databse", "mongodb-database"],
  ])("recognizes the supplied alias %s", (query, key) => {
    expect(
      filterConnectionIcons(query).map((definition) => definition.key),
    ).toContain(key);
  });

  it("retains unique keys and the original folder and infrastructure glyphs", () => {
    const keys = CONNECTION_ICON_CATALOG.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of EXISTING_KEYS) {
      expect(
        getConnectionIconDefinition(key)?.key,
        `Existing saved icon ${key}`,
      ).toBe(key);
    }
    for (const [key, component] of Object.entries({
      folder: Folder,
      "folder-open": FolderOpen,
      monitor: Monitor,
      server: Server,
    })) {
      expect(getConnectionIconDefinition(key)?.icon).toBe(component);
    }
  });

  it.each(REQUESTED_ICONS.filter(([key]) => key.startsWith("folder-")))(
    "round-trips explicit group icon %s",
    (key) => {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "group",
            name: "Group",
            isGroup: true,
            protocol: "rdp",
            icon: key,
          }),
        ),
      );
      expect(restored.icon).toBe(key);
      expect(restored.isGroup).toBe(true);
      expect(
        resolveEffectiveConnectionIcon({
          ...restored,
          protocol: restored.protocol ?? "rdp",
        }),
      ).toMatchObject({ key, source: "override" });
      expect(
        resolveEffectiveConnectionIcon({
          ...restored,
          icon: undefined,
          protocol: restored.protocol ?? "rdp",
        }),
      ).toMatchObject({ key: "folder", source: "folder" });
    },
  );

  it.each([
    ["redhat", "redhat-server"],
    ["centos", "centos-server"],
    ["ubuntu", "ubuntu-server"],
    ["mysql", "mysql-database"],
    ["mongodb", "mongodb-database"],
    ["mariadb", "mariadb-database"],
    ["postgresql", "postgresql-database"],
    ["synology", "synology-nas"],
    ["drone-ci", "drone-ci-server"],
    ["portainer", "portainer-server"],
    ["vmware", "vmware-server"],
    ["proxmox", "proxmox-server"],
    ["supermicro", "supermicro-server"],
    ["dell", "dell-server"],
    ["cisco", "cisco-access-point"],
    ["tplink", "tplink-access-point"],
    ["hpe", "hpe-switch"],
    ["levelone", "levelone-switch"],
    ["arista", "arista-switch"],
    ["freepbx", "freepbx-server"],
    ["asterisk", "asterisk-server"],
    ["nginx", "nginx-server"],
    ["envoy", "envoy-server"],
  ])("gives %s and %s visibly different SVG geometry", (brand, role) => {
    expect(drawing(role)).not.toBe(drawing(brand));
  });
});
