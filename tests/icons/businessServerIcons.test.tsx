import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { BUSINESS_APPLICATION_ICONS } from "../../src/utils/icons/catalog/businessApplications";
import { REMOTE_TOOL_ICONS } from "../../src/utils/icons/catalog/remoteTools";
import { WEB_APPLICATION_ICONS } from "../../src/utils/icons/catalog/webApplications";
import { REMOTE_PROTOCOL_ICONS } from "../../src/utils/icons/catalog/remoteProtocols";

// Canonical keys agreed with each catalog owner. Keep exact named requirements
// separate from bounded additions; broad vendor categories are not exhaustive.
const REQUESTED: readonly (readonly [key: string, query: string])[] = [
  ["docker", "docker"],
  ["docker-server", "docker server"],
  ["smb-server", "smb server"],
  ["file-server", "file server"],
  ["rmm-server", "rmm server"],
  ["phc", "phc"],
  ["primavera", "primavera"],
  ["cegid", "cegid"],
  ["business-analytics-server", "business analytics server"],
  ["analytics-server", "analytics server"],
  ["building", "building"],
  ["office", "office"],
  ["people", "people"],
  ["odoo", "odoo"],
  ["pos", "generic pos"],
  ["erp", "generic erp"],
  ["invoice", "invoice"],
  ["invoice-server", "invoice server"],
  ["truenas", "truenas"],
  ["windows-server", "windows server"],
  ["bind-server", "bind server"],
  ["active-directory-server", "ad server"],
  ["sqlpad", "sqlpad"],
  ["kms-server", "kms server"],
  ["sql-server", "sql server"],
  ["mssql", "mssql"],
  ["microsoft-rdp", "microsoft rdp"],
  ["apple-rd", "apple rd"],
  ["exchange-server", "exchange server"],
  ["mta-server", "mta server"],
  ["slack", "slack"],
  ["payload-cms", "payload cms"],
  ["mremoteng", "mremoteng"],
  ["openssh", "openssh"],
  ["vnc", "generic vnc"],
  ["ultravnc", "ultravnc"],
  ["tightvnc", "tightvnc"],
  ["serial", "serial connections"],
  ["serial-switch", "serial to switch"],
  ["serial-router", "serial to router"],
  ["serial-hardware", "serial to hardware"],
  ["telnet", "telnet"],
  ["supermicro-bmc", "supermicro bmc"],
  ["ilo", "hpe ilo"],
  ["dell-idrac", "dell idrac"],
  ["lenovo-xclarity", "lenovo xclarity"],
  ["lxd", "lxd"],
  ["incus", "incus"],
  ["vsphere", "vsphere"],
  ["vmware-workstation", "vmware workstation"],
  ["netbox", "netbox"],
  ["draytek", "draytek"],
  ["draytek-switch", "draytek switch"],
  ["draytek-router", "draytek router"],
  ["caddy", "caddy web server"],
  ["php", "php"],
  ["php-fpm", "php fpm"],
  ["nginx-proxy-manager", "nginx proxy manager"],
  ["nginx-proxy-manager-server", "nginx proxy manager server"],
  ["mailcow", "mailcow"],
  ["mailcow-server", "mailcow server"],
  ["mail-server", "generic mail server"],
  ["filezilla", "filezilla"],
  ["ftp-server", "ftp server"],
  ["sftp-server", "sftp server"],
  ["scp", "scp"],
  ["scp-server", "scp server"],
  ["google-drive", "google drive"],
  ["nextcloud", "nextcloud"],
  ["nextcloud-server", "nextcloud server"],
  ["prometheus", "prometheus"],
  ["prometheus-server", "prometheus server"],
  ["elasticsearch", "elasticsearch"],
  ["elasticsearch-server", "elasticsearch server"],
  ["keepass", "keepass"],
  ["keepassx", "keepassx"],
  ["password-vault", "password vault"],
  ["vault", "generic vault"],
  ["ansible", "ansible"],
  ["budibase", "budibase"],
  ["jira", "jira"],
  ["osticket", "osticket"],
];

const CURATED = [
  "metabase-server",
  "apache-superset-server",
  "redash-server",
  "matomo-server",
  "plausible-server",
  "metabase",
  "apache-superset",
  "redash",
  "matomo",
  "plausible",
  "sap",
  "oracle-erp",
  "microsoft-dynamics365",
  "erpnext",
  "dolibarr",
  "truenas-nas",
  "mattermost",
  "rocket-chat",
  "matrix",
  "zulip",
  "element",
  "drupal",
  "ghost",
  "strapi",
  "directus",
  "n8n",
  "node-red",
  "rundeck",
  "puppet",
  "openldap",
  "samba",
  "redis",
  "gitea",
  "minio",
] as const;

// ALL 387 pre-expansion keys, including both previous icon request rounds.
// This is a persistence snapshot, not a catalog-index or category-order lock.
const EXISTING_KEYS =
  `cloud cloud-cog cloud-upload cloud-download cloud-lightning googlecloud azure hetzner-cloud ovh-cloud digitalocean-cloud oracle-cloud alibaba-cloud tencent-cloud ibm-cloud redhat-cloud linode
mail mailbox message messages send bell life-buoy at-sign active-directory postfix mail-server dovecot database database-backup database-zap table mongodb postgresql mysql mariadb mysql-database mongodb-database mariadb-database postgresql-database
activity bar-chart chart gauge workflow git-branch git-commit package wrench settings code file-code bug test-tube kanban panel bot webhook github git git-server drone-ci drone-ci-server rmm rmm-server meshcentral llm llm-server ai-agent agent-server jenkins jenkins-server github-actions github-actions-server gitlab-ci gitlab-ci-server teamcity teamcity-server circleci circleci-server travisci travisci-server buildkite buildkite-server azure-devops azure-devops-server
file file-text archive save upload download folder folder-open folder-cog folder-tree folder-lock folder-archive folder-code folder-git folder-sync folder-clock folder-kanban folder-heart folder-work folder-personal folder-remote folder-rdp folder-phone folder-switch folder-router folder-web folder-admin folder-ssh folder-server folder-nas folder-access-point
star heart circle circle-dot square triangle diamond hexagon bookmark tag flag pentagon octagon rectangle-horizontal rectangle-vertical triangle-right circle-dashed square-dashed diamond-plus asterisk-shape cross target orbit
globe network router wifi cable waypoints radio-tower route link share radio freshtomato dns-server time-server isp-router gateway openvpn openvpn-server wireguard wireguard-server
computer generic-os cross-platform redhat redhat-server centos centos-server ubuntu ubuntu-server fedora macos windows freebsd freebsd-server linux android debian rocky-linux almalinux opensuse
monitor terminal eye phone monitor-play keyboard pointer anydesk rustdesk powershell shield shield-check shield-alert lock key-round fingerprint scan-face file-key pfsense opnsense opnsense-router pfsense-router snort suricata zeek wazuh fortinet fortinet-firewall
server server-cog cpu drive laptop smartphone tablet television printer camera container boxes storage-server time-clock biometrics-device mobile-hotspot ups iot-device electrical-iot-device interactive-pdu lighting-equipment
switch access-point nas dell hp supermicro hpe synology synology-nas tplink dlink cisco asus dell-server supermicro-server cisco-access-point tplink-access-point asus-access-point hpe-switch levelone levelone-switch arista arista-switch ibm microsoft netapp
apple lenovo brother kyocera xerox epson canon huawei samsung razer clevo fujitsu lg ubiquiti avaya acer msi toshiba juniper mikrotik qnap hp-printer brother-printer kyocera-printer epson-printer xerox-printer canon-printer apple-computer windows-computer lenovo-server lenovo-pc lenovo-laptop dell-laptop hp-laptop macbook razer-laptop asus-laptop clevo-laptop huawei-laptop fujitsu-laptop samsung-laptop lg-laptop acer-laptop msi-laptop toshiba-laptop huawei-olt huawei-access-point huawei-router huawei-switch asus-router cisco-router ubiquiti-access-point ubiquiti-switch avaya-switch ilo juniper-router mikrotik-router qnap-nas
lenovo-tablet samsung-tablet apple-tablet asustor arduino raspberry-pi espressif shelly ugreen ugreen-nas schneider-electric schneider-electric-ups vertiv vertiv-ups riello riello-ups apc apc-ups eaton eaton-ups cyberpower cyberpower-ups tripplite tripplite-ups sonoff tuya
virtual-machine hypervisor noip vmware proxmox portainer vmware-server proxmox-server portainer-server container-server virtualization-server kubernetes voip pbx-server freepbx freepbx-server asterisk asterisk-server yealink grandstream yealink-phone grandstream-phone cisco-phone ubiquiti-phone iphone android-phone samsung-phone
web-server build-server code-server nginx traefikproxy grafana cpanel nginx-server envoy envoy-server google microsoft365 phpmyadmin wordpress joomla website-backend apache reverse-proxy home-assistant esphome tasmota`.split(
    /\s+/,
  );

function svgFor(key: string) {
  const definition = getConnectionIconDefinition(key);
  expect(definition, `Missing requested icon: ${key}`).toBeDefined();
  const markup = renderToStaticMarkup(
    createElement(definition!.icon, { size: 24 }),
  );
  return new DOMParser().parseFromString(markup, "image/svg+xml")
    .documentElement;
}

function geometry(key: string) {
  const svg = svgFor(key);
  for (const node of Array.from(svg.querySelectorAll("[class]")))
    node.removeAttribute("class");
  return svg.innerHTML;
}

describe("business and server icon requirements", () => {
  it("exposes the new leaf modules through their existing category arrays", () => {
    for (const entry of BUSINESS_APPLICATION_ICONS) {
      expect(entry.category).toBe("web-applications");
      expect(WEB_APPLICATION_ICONS).toContain(entry);
      expect(getConnectionIconDefinition(entry.key)).toBe(entry);
    }
    for (const entry of REMOTE_TOOL_ICONS) {
      expect(entry.category).toBe("remote-protocols");
      expect(REMOTE_PROTOCOL_ICONS).toContain(entry);
      expect(getConnectionIconDefinition(entry.key)).toBe(entry);
    }
  });

  it.each(REQUESTED)(
    "renders and finds requested %s using %s",
    (key, query) => {
      const svg = svgFor(key);
      expect(svg.tagName).toBe("svg");
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(
        svg.querySelector(
          "path, rect, circle, ellipse, polygon, polyline, line",
        ),
      ).not.toBeNull();
      expect(svg.querySelector("image, text, use, foreignObject")).toBeNull();
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        key,
      );
    },
  );

  it.each(CURATED)("includes the bounded addition %s", (key) => {
    expect(
      svgFor(key).querySelector(
        "path, rect, circle, ellipse, polygon, polyline, line",
      ),
    ).not.toBeNull();
    expect(
      filterConnectionIcons(key.replace(/-/g, " ")).map((entry) => entry.key),
    ).toContain(key);
  });

  it("preserves all 387 previous keys and keeps the complete catalog unique", () => {
    expect(EXISTING_KEYS).toHaveLength(387);
    const keys = CONNECTION_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of EXISTING_KEYS)
      expect(getConnectionIconDefinition(key)?.key, key).toBe(key);
  });

  it.each([...REQUESTED.map(([key]) => key), ...CURATED])(
    "round-trips selected %s through JSON and normalization",
    (key) => {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "endpoint",
            name: "Endpoint",
            protocol: "ssh",
            isGroup: false,
            icon: key,
          }),
        ),
      );
      expect(restored.icon).toBe(key);
      expect(typeof restored.icon).toBe("string");
      expect(restored).not.toHaveProperty("iconComponent");
      expect(
        resolveEffectiveConnectionIcon({
          ...restored,
          protocol: restored.protocol ?? "ssh",
        }),
      ).toMatchObject({ key, source: "override" });
    },
  );

  it.each([
    ["analytics sevrer", "analytics-server"],
    ["business analytics", "business-analytics-server"],
    ["point of sale", "pos"],
    ["enterprise resource planning", "erp"],
    ["smb file server", "smb-server"],
    ["apple rd", "apple-rd"],
    ["mssql", "mssql"],
    ["microsoft sql server", "mssql"],
    ["AD server", "active-directory-server"],
    ["vshphere", "vsphere"],
    ["drautek", "draytek"],
    ["drautek switch", "draytek-switch"],
    ["drautek router", "draytek-router"],
    ["prometherus", "prometheus"],
    ["prometherus server", "prometheus-server"],
    ["selasticsearch", "elasticsearch"],
    ["selasticsearch server", "elasticsearch-server"],
    ["passowrd vault", "password-vault"],
  ])("recognizes alias %s", (query, key) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });

  it.each([
    ["metabase", "metabase-server"],
    ["apache-superset", "apache-superset-server"],
    ["redash", "redash-server"],
    ["matomo", "matomo-server"],
    ["plausible", "plausible-server"],
    ["docker", "docker-server"],
    ["truenas", "truenas-nas"],
    ["invoice", "invoice-server"],
    ["windows", "windows-server"],
    ["windows", "microsoft-rdp"],
    ["apple", "apple-rd"],
    ["active-directory", "active-directory-server"],
    ["serial", "serial-switch"],
    ["serial", "serial-router"],
    ["serial", "serial-hardware"],
    ["supermicro-server", "supermicro-bmc"],
    ["dell-server", "dell-idrac"],
    ["lenovo-server", "lenovo-xclarity"],
    ["draytek", "draytek-switch"],
    ["draytek", "draytek-router"],
    ["nginx-proxy-manager", "nginx-proxy-manager-server"],
    ["mailcow", "mailcow-server"],
    ["scp", "scp-server"],
    ["nextcloud", "nextcloud-server"],
    ["prometheus", "prometheus-server"],
    ["elasticsearch", "elasticsearch-server"],
    ["keepass", "keepassx"],
  ])("gives %s and %s different SVG geometry", (base, role) => {
    expect(geometry(base)).not.toBe(geometry(role));
  });
});
