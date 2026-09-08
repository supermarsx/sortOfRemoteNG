import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import {
  PROTOCOL_ICON_DEFAULTS,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";

// Exact requests plus the agreed bounded registrar set; existing keys are reused.
const REQUESTED = [
  ["hyperv", "hyperv"],
  ["hyperv-server", "hyperv server"],
  ["bitwarden", "bitwarden"],
  ["tomcat", "tomcat"],
  ["tomcat-server", "tomcat server"],
  ["java", "java"],
  ["nodejs", "nodejs"],
  ["linux", "linux"],
  ["linux-server", "linux server"],
  ["macos-server", "macos server"],
  ["corporate", "corporate"],
  ["sql-server", "sql server"],
  ["intel-amt", "intel amt"],
  ["citrix", "citrix"],
  ["citrix-web", "citrix web"],
  ["dameware", "dameware"],
  ["custom-vpn", "custom vpn"],
  ["apple-vpn", "apple vpn"],
  ["microsoft-vpn", "microsoft vpn"],
  ["cisco-vpn", "cisco vpn"],
  ["proxy-tunnel", "proxy tunnel"],
  ["microsoft", "microsoft"],
  ["microsoft-rd-gateway", "microsoft rd gateway"],
  ["appliance", "appliance"],
  ["snmp", "snmp"],
  ["splunk", "splunk"],
  ["porkbun", "porkbun"],
  ["cloudflare", "cloudflare"],
  ["namecheap", "namecheap"],
  ["godaddy", "godaddy"],
  ["gandi", "gandi"],
  ["ionos", "ionos"],
  ["firewall", "firewall"],
  ["wired-router", "generic router variant"],
  ["print-server", "print server"],
  ["mikrotik", "mikrotik"],
  ["mikrotik-router", "mikrotik router"],
  ["mikrotik-access-point", "mikrotik access point"],
  ["mikrotik-switch", "mikrotik switch"],
] as const;

// All 500 keys captured before this platform/network expansion. Preserve earlier
// business, remote-management, vendor and folder selections across persistence.
const EXISTING_KEYS =
  `monitor terminal eye phone monitor-play keyboard pointer anydesk rustdesk powershell microsoft-rdp apple-rd vnc serial serial-switch serial-router serial-hardware telnet ftp-server sftp-server scp scp-server filezilla openssh mremoteng ultravnc tightvnc server server-cog cpu drive laptop smartphone tablet television printer camera container boxes storage-server time-clock biometrics-device mobile-hotspot ups iot-device electrical-iot-device interactive-pdu lighting-equipment file-server smb-server globe network router wifi cable waypoints radio-tower route link share radio freshtomato dns-server time-server isp-router gateway openvpn openvpn-server wireguard wireguard-server bind-server netbox openldap samba cloud cloud-cog cloud-upload cloud-download cloud-lightning googlecloud azure hetzner-cloud ovh-cloud digitalocean-cloud oracle-cloud alibaba-cloud tencent-cloud ibm-cloud redhat-cloud linode database database-backup database-zap table mongodb postgresql mysql mariadb mysql-database mongodb-database mariadb-database postgresql-database sql-server mssql sqlpad redis activity bar-chart chart gauge workflow git-branch git-commit package wrench settings code file-code bug test-tube kanban panel bot webhook github git git-server drone-ci drone-ci-server rmm rmm-server meshcentral llm llm-server ai-agent agent-server jenkins jenkins-server github-actions github-actions-server gitlab-ci gitlab-ci-server teamcity teamcity-server circleci circleci-server travisci travisci-server buildkite buildkite-server azure-devops azure-devops-server ansible n8n node-red rundeck puppet gitea minio prometheus prometheus-server elasticsearch elasticsearch-server jira shield shield-check shield-alert lock key-round fingerprint scan-face file-key pfsense opnsense opnsense-router pfsense-router snort suricata zeek wazuh fortinet fortinet-firewall kms-server keepass keepassx password-vault vault folder folder-open folder-cog folder-tree folder-lock folder-archive folder-code folder-git folder-sync folder-clock folder-kanban folder-heart folder-work folder-personal folder-remote folder-rdp folder-phone folder-switch folder-router folder-web folder-admin folder-ssh folder-server folder-nas folder-access-point file file-text archive save upload download invoice mail mailbox message messages send bell life-buoy at-sign active-directory postfix mail-server dovecot active-directory-server exchange-server mta-server slack mattermost rocket-chat matrix zulip element mailcow mailcow-server osticket star heart circle circle-dot square triangle diamond hexagon bookmark tag flag pentagon octagon rectangle-horizontal rectangle-vertical triangle-right circle-dashed square-dashed diamond-plus asterisk-shape cross target orbit building office people computer generic-os cross-platform redhat redhat-server centos centos-server ubuntu ubuntu-server fedora macos windows freebsd freebsd-server linux android debian rocky-linux almalinux opensuse windows-server virtual-machine hypervisor noip vmware proxmox portainer vmware-server proxmox-server portainer-server container-server virtualization-server kubernetes vsphere vmware-workstation docker docker-server lxd incus switch access-point nas dell hp supermicro hpe synology synology-nas tplink dlink cisco asus dell-server supermicro-server cisco-access-point tplink-access-point asus-access-point hpe-switch levelone levelone-switch arista arista-switch ibm microsoft netapp apple lenovo brother kyocera xerox epson canon huawei samsung razer clevo fujitsu lg ubiquiti avaya acer msi toshiba juniper mikrotik qnap hp-printer brother-printer kyocera-printer epson-printer xerox-printer canon-printer apple-computer windows-computer lenovo-server lenovo-pc lenovo-laptop dell-laptop hp-laptop macbook razer-laptop asus-laptop clevo-laptop huawei-laptop fujitsu-laptop samsung-laptop lg-laptop acer-laptop msi-laptop toshiba-laptop huawei-olt huawei-access-point huawei-router huawei-switch asus-router cisco-router ubiquiti-access-point ubiquiti-switch avaya-switch ilo juniper-router mikrotik-router qnap-nas lenovo-tablet samsung-tablet apple-tablet asustor arduino raspberry-pi espressif shelly ugreen ugreen-nas schneider-electric schneider-electric-ups vertiv vertiv-ups riello riello-ups apc apc-ups eaton eaton-ups cyberpower cyberpower-ups tripplite tripplite-ups sonoff tuya supermicro-bmc dell-idrac lenovo-xclarity truenas truenas-nas draytek draytek-switch draytek-router voip pbx-server freepbx freepbx-server asterisk asterisk-server yealink grandstream yealink-phone grandstream-phone cisco-phone ubiquiti-phone iphone android-phone samsung-phone web-server build-server code-server nginx traefikproxy grafana cpanel nginx-server envoy envoy-server google microsoft365 phpmyadmin wordpress joomla website-backend apache reverse-proxy home-assistant esphome tasmota payload-cms drupal ghost strapi directus nextcloud nextcloud-server caddy php php-fpm nginx-proxy-manager nginx-proxy-manager-server google-drive budibase pos erp invoice-server business-analytics-server analytics-server odoo metabase apache-superset redash matomo plausible sap oracle-erp erpnext dolibarr microsoft-dynamics365 metabase-server apache-superset-server redash-server matomo-server plausible-server phc cegid primavera`.split(
    /\s+/,
  );

function geometry(key: string) {
  const definition = getConnectionIconDefinition(key);
  expect(definition, `Missing requested ${key}`).toBeDefined();
  const markup = renderToStaticMarkup(
    createElement(definition!.icon, { size: 24 }),
  );
  const svg = new DOMParser().parseFromString(
    markup,
    "image/svg+xml",
  ).documentElement;
  expect(svg.tagName).toBe("svg");
  expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(
    svg.querySelector("path, rect, circle, ellipse, polygon, polyline, line"),
  ).not.toBeNull();
  expect(svg.querySelector("image, text, use, foreignObject")).toBeNull();
  for (const node of Array.from(svg.querySelectorAll("[class]")))
    node.removeAttribute("class");
  return svg.innerHTML;
}

describe("platform and network icon requests", () => {
  it.each(REQUESTED)("renders and finds %s using %s", (key, query) => {
    expect(geometry(key)).not.toBe("");
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });

  it.each(REQUESTED)(
    "persists explicit %s without changing its meaning",
    (key) => {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "platform",
            name: "Platform",
            protocol: "rdp",
            isGroup: false,
            icon: key,
          }),
        ),
      );
      expect(restored.icon).toBe(key);
      expect(restored).not.toHaveProperty("iconComponent");
      expect(
        resolveEffectiveConnectionIcon({
          ...restored,
          protocol: restored.protocol ?? "rdp",
        }),
      ).toMatchObject({ key, source: "override" });
    },
  );

  it("preserves all 500 existing keys without duplicate keys", () => {
    expect(EXISTING_KEYS).toHaveLength(500);
    const keys = CONNECTION_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of EXISTING_KEYS)
      expect(getConnectionIconDefinition(key)?.key, key).toBe(key);
  });

  it.each([
    ["hyperv", "hyperv-server"],
    ["tomcat", "tomcat-server"],
    ["linux", "linux-server"],
    ["macos", "macos-server"],
    ["citrix", "citrix-web"],
    ["apple", "apple-vpn"],
    ["microsoft", "microsoft-vpn"],
    ["cisco", "cisco-vpn"],
    ["microsoft-rdp", "microsoft-rd-gateway"],
    ["router", "wired-router"],
    ["firewall", "wired-router"],
    ["printer", "print-server"],
    ["mikrotik", "mikrotik-access-point"],
    ["mikrotik", "mikrotik-switch"],
    ["mikrotik-router", "mikrotik-switch"],
  ])("distinguishes %s from %s by SVG geometry", (base, role) => {
    expect(geometry(base)).not.toBe(geometry(role));
  });

  it.each([
    ["generic linux", "linux"],
    ["generic corporate", "corporate"],
    ["microsoft generic", "microsoft"],
    ["generic snmp", "snmp"],
    ["generic firewall", "firewall"],
    ["generic print server", "print-server"],
    ["microsoft remtoe desktop gateway", "microsoft-rd-gateway"],
    ["gneeric appliance", "appliance"],
    ["hyper-v", "hyperv"],
    ["hyper v server", "hyperv-server"],
    ["node js", "nodejs"],
    ["macOS server", "macos-server"],
    ["MS RD gateway", "microsoft-rd-gateway"],
    ["active management technology", "intel-amt"],
    ["mikrotik ap", "mikrotik-access-point"],
  ])("recognizes %s", (query, key) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });

  it("uses the requested protocol-native defaults while preserving saved keys", () => {
    expect(PROTOCOL_ICON_DEFAULTS).toEqual({
      rdp: "microsoft-rdp",
      ssh: "ssh",
      ard: "apple-rd",
      serial: "serial",
      vnc: "vnc",
      anydesk: "anydesk",
      http: "globe",
      https: "https",
      telnet: "telnet",
      raw: "raw-socket",
      rlogin: "rlogin",
      mysql: "mysql",
      mongodb: "mongodb",
      postgresql: "postgresql",
      spice: "spice",
      xdmcp: "xdmcp",
      x2go: "x2go",
      nx: "nomachine",
      ftp: "ftp",
      sftp: "sftp",
      scp: "scp",
      winrm: "powershell",
      rustdesk: "rustdesk",
      smb: "smb",
      gcp: "googlecloud",
      azure: "azure",
      "ibm-csp": "ibm-cloud",
      "digital-ocean": "digitalocean",
      heroku: "heroku",
      scaleway: "scaleway",
      linode: "linode",
      ovhcloud: "ovh",
      idrac: "dell-idrac",
      ilo: "ilo",
      lenovo: "lenovo-xclarity",
      supermicro: "supermicro-bmc",
      "voip-phone": "voip",
    });
  });
});
