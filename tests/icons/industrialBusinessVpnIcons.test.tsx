import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_ICON_CATALOG,
  CONNECTION_ICON_CATEGORIES,
  getConnectionIconDefinition,
  type ConnectionIconKey,
} from "../../src/utils/icons/connectionIconCatalog";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import {
  PROTOCOL_ICON_DEFAULTS,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";
import { integrationRegistry } from "../../src/types/integrations/registry";

const DEVICES = [
  "stream",
  "stream-server",
  "sensor",
  "vehicle",
  "inventory",
  "stock",
  "restaurant",
  "proximity-sensor",
  "motorcycle",
  "rfid",
  "payment-system",
  "hvac",
  "temperature-gauge",
  "pressure-gauge",
  "level-gauge",
  "speed-gauge",
  "power-gauge",
  "mdm",
  "mdm-mobile",
  "mdm-fleet",
  "digital-clock",
  "remote-display",
  "remote-display-wall",
  "remote-projector",
  "card-reader",
  "high-voltage",
  "safety-system",
  "alarm",
  "fire-extinguisher",
  "analog-screen",
  "analog-controller",
  "controller",
  "traffic-lights",
  "speaker",
  "speaker-array",
  "offgrid-controller",
  "grid-controller",
  "fan",
  "mini-server",
  "mini-server-tower",
  "mini-server-rack",
  "mini-server-cluster",
  "access-control",
  "access-control-keypad",
  "access-control-biometric",
  "access-control-rfid",
] as const;
const BUSINESS = [
  "api",
  "api-server",
  "rest",
  "graphql",
  "hr-system",
  "crm",
  "salesforce",
  "hubspot",
  "zoho",
  "pipedrive",
] as const;
const BUILDINGS = [
  "warehouse",
  "building-store",
  "building-supermarket",
  "building-office",
  "building-hospital",
  "building-school",
  "building-hotel",
  "building-restaurant",
  "building-factory",
  "building-house",
  "building-apartment",
  "building-bank",
  "building-government",
  "building-datacenter",
  "building-garage",
] as const;
const VPN = [
  "pptp",
  "pptp-server",
  "pptp-vpn",
  "ipsec",
  "ipsec-server",
  "l2tp",
  "l2tp-server",
  "ikev2",
  "ikev2-server",
  "sstp",
  "sstp-server",
  "ssl-vpn",
  "ssl-vpn-server",
  "zerotier",
  "zerotier-vpn",
  "tailscale",
  "tailscale-vpn",
  "netbird",
  "netbird-vpn",
  "twingate",
  "twingate-vpn",
  "nebula",
  "nebula-vpn",
  "softether",
  "softether-vpn",
] as const;
const PROVIDERS = [
  "meo",
  "vodafone",
  "nos",
  "digi",
  "deutsche-telekom",
  "viva",
  "orange",
  "uzo",
  "t-mobile",
  "o2",
  "tele2",
  "sfr",
  "altice",
  "att",
  "three",
  "hurricane-electric",
  "nowo",
  "movistar",
  "telecom",
  "porkbun",
  "namecheap",
  "godaddy",
  "gandi",
  "ionos",
  "cloudflare",
  "noip",
] as const;
const REQUESTED = [
  ...DEVICES,
  ...BUSINESS,
  ...BUILDINGS,
  ...VPN,
] as const satisfies readonly ConnectionIconKey[];
// Exact catalog before this independent industrial / VPN / ISP addition.
const PREVIOUS_KEYS =
  "monitor terminal eye phone monitor-play keyboard pointer anydesk rustdesk powershell microsoft-rdp apple-rd vnc serial serial-switch serial-router serial-hardware telnet ftp-server sftp-server scp scp-server filezilla openssh mremoteng ultravnc tightvnc citrix citrix-web microsoft-rd-gateway dameware ssh https raw-socket rlogin ftp sftp smb spice xdmcp nomachine x2go server server-cog cpu drive laptop smartphone tablet television printer camera container boxes storage-server time-clock biometrics-device mobile-hotspot ups iot-device electrical-iot-device interactive-pdu lighting-equipment file-server smb-server appliance print-server container-alt mobile-hotspot-alt hotspot-5g remote-office server-rack server-tower server-blade ip-camera ip-camera-bullet ip-camera-dome ip-camera-ptz dvr nvr development-server development-workstation gpu-farm storage-farm rendering-server render-workstation globe network router wifi cable waypoints radio-tower route link share radio freshtomato dns-server time-server isp-router gateway openvpn openvpn-server wireguard wireguard-server bind-server netbox openldap samba custom-vpn apple-vpn microsoft-vpn cisco-vpn proxy-tunnel wired-router snmp porkbun namecheap godaddy gandi ionos cloudflare router-rack router-edge router-wireless ddwrt ddwrt-router telecom vodafone deutsche-telekom orange o2 att movistar t-mobile meo nos digi viva uzo tele2 sfr altice three hurricane-electric nowo heroku scaleway cloud cloud-cog cloud-upload cloud-download cloud-lightning googlecloud azure hetzner-cloud ovh-cloud digitalocean-cloud oracle-cloud alibaba-cloud tencent-cloud ibm-cloud redhat-cloud linode database database-backup database-zap table mongodb postgresql mysql mariadb mysql-database mongodb-database mariadb-database postgresql-database sql-server mssql sqlpad redis activity bar-chart chart gauge workflow git-branch git-commit package wrench settings code file-code bug test-tube kanban panel bot webhook github git git-server drone-ci drone-ci-server rmm rmm-server meshcentral llm llm-server ai-agent agent-server jenkins jenkins-server github-actions github-actions-server gitlab-ci gitlab-ci-server teamcity teamcity-server circleci circleci-server travisci travisci-server buildkite buildkite-server azure-devops azure-devops-server ansible n8n node-red rundeck puppet gitea minio prometheus prometheus-server elasticsearch elasticsearch-server jira splunk shield shield-check shield-alert lock key-round fingerprint scan-face file-key pfsense opnsense opnsense-router pfsense-router snort suricata zeek wazuh fortinet fortinet-firewall kms-server keepass keepassx password-vault vault bitwarden firewall folder folder-open folder-cog folder-tree folder-lock folder-archive folder-code folder-git folder-sync folder-clock folder-kanban folder-heart folder-work folder-personal folder-remote folder-rdp folder-phone folder-switch folder-router folder-web folder-admin folder-ssh folder-server folder-nas folder-access-point folder-directory folder-file-server folder-mail-server folder-container-server folder-hypervisor file file-text archive save upload download invoice mail mailbox message messages send bell life-buoy at-sign active-directory postfix mail-server dovecot active-directory-server exchange-server mta-server slack mattermost rocket-chat matrix zulip element mailcow mailcow-server osticket star heart circle circle-dot square triangle diamond hexagon bookmark tag flag pentagon octagon rectangle-horizontal rectangle-vertical triangle-right circle-dashed square-dashed diamond-plus asterisk-shape cross target orbit building office people corporate emoji-smile emoji-laugh emoji-wink emoji-sad emoji-angry emoji-surprised emoji-cool emoji-thinking emoji-thumbs-up emoji-thumbs-down emoji-party emoji-fire heart-filled heart-broken star-filled circle-filled square-filled triangle-filled diamond-filled arrow-up arrow-down arrow-left arrow-right lightning check-circle prohibited clover sparkles sun moon clock battery-charging power transfer mail-plus payment-card pie-chart company-healthcare company-education company-finance company-insurance company-retail company-manufacturing company-construction company-logistics company-hospitality company-restaurant company-agriculture company-government company-legal company-technology company-telecom company-energy computer generic-os cross-platform redhat redhat-server centos centos-server ubuntu ubuntu-server fedora macos windows freebsd freebsd-server linux android debian rocky-linux almalinux opensuse windows-server linux-server macos-server virtual-machine hypervisor noip vmware proxmox portainer vmware-server proxmox-server portainer-server container-server virtualization-server kubernetes vsphere vmware-workstation docker docker-server lxd incus hyperv hyperv-server switch access-point nas dell hp supermicro hpe synology synology-nas tplink dlink cisco asus dell-server supermicro-server cisco-access-point tplink-access-point asus-access-point hpe-switch levelone levelone-switch arista arista-switch ibm microsoft netapp apple lenovo brother kyocera xerox epson canon huawei samsung razer clevo fujitsu lg ubiquiti avaya acer msi toshiba juniper mikrotik qnap hp-printer brother-printer kyocera-printer epson-printer xerox-printer canon-printer apple-computer windows-computer lenovo-server lenovo-pc lenovo-laptop dell-laptop hp-laptop macbook razer-laptop asus-laptop clevo-laptop huawei-laptop fujitsu-laptop samsung-laptop lg-laptop acer-laptop msi-laptop toshiba-laptop huawei-olt huawei-access-point huawei-router huawei-switch asus-router cisco-router ubiquiti-access-point ubiquiti-switch avaya-switch ilo juniper-router mikrotik-router qnap-nas lenovo-tablet samsung-tablet apple-tablet asustor arduino raspberry-pi espressif shelly ugreen ugreen-nas schneider-electric schneider-electric-ups vertiv vertiv-ups riello riello-ups apc apc-ups eaton eaton-ups cyberpower cyberpower-ups tripplite tripplite-ups sonoff tuya supermicro-bmc dell-idrac lenovo-xclarity truenas truenas-nas draytek draytek-switch draytek-router intel-amt mikrotik-access-point mikrotik-switch access-point-ceiling access-point-wall switch-managed switch-poe switch-fiber hetzner ovh digitalocean alibabacloud exchange intel bind reolink hikvision dahua axis hanwha uniview amcrest reolink-camera hikvision-camera dahua-camera axis-camera hanwha-camera uniview-camera amcrest-camera tplink-camera ubiquiti-camera reolink-nvr hikvision-dvr dahua-dvr voip pbx-server freepbx freepbx-server asterisk asterisk-server yealink grandstream yealink-phone grandstream-phone cisco-phone ubiquiti-phone iphone android-phone samsung-phone haproxy web-server build-server code-server nginx traefikproxy grafana cpanel nginx-server envoy envoy-server google microsoft365 phpmyadmin wordpress joomla website-backend apache reverse-proxy home-assistant esphome tasmota payload-cms drupal ghost strapi directus nextcloud nextcloud-server caddy php php-fpm nginx-proxy-manager nginx-proxy-manager-server google-drive budibase pos erp invoice-server business-analytics-server analytics-server odoo metabase apache-superset redash matomo plausible sap oracle-erp erpnext dolibarr microsoft-dynamics365 metabase-server apache-superset-server redash-server matomo-server plausible-server phc cegid primavera tomcat tomcat-server java nodejs".split(
    /\s+/,
  );

function svgFor(key: string) {
  const entry = getConnectionIconDefinition(key);
  expect(entry, key).toBeDefined();
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(entry!.icon, { size: 24 }),
  );
  const svg = container.querySelector("svg")!;
  expect(svg, key).not.toBeNull();
  expect(svg.getAttribute("viewBox"), key).toBe("0 0 24 24");
  expect(
    svg.querySelector("path,rect,circle,line,ellipse,polygon,polyline"),
    key,
  ).not.toBeNull();
  expect(svg.querySelector("text,image,use,foreignObject"), key).toBeNull();
  return svg;
}
function geometry(svg: Element) {
  const clone = svg.cloneNode(true) as Element;
  for (const node of Array.from(clone.querySelectorAll("[class]")))
    node.removeAttribute("class");
  return clone.innerHTML;
}
describe("industrial, business, VPN and ISP icon additions", () => {
  it("covers the complete bounded 96-icon request without duplicate keys", () => {
    expect(DEVICES).toHaveLength(46);
    expect(BUSINESS).toHaveLength(10);
    expect(BUILDINGS).toHaveLength(15);
    expect(VPN).toHaveLength(25);
    expect(REQUESTED).toHaveLength(96);
    expect(new Set(REQUESTED).size).toBe(96);
    const keys = CONNECTION_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it.each(REQUESTED)(
    "renders and finds %s without fonts or external images",
    (key) => {
      expect(geometry(svgFor(key))).not.toBe("");
      expect(
        filterConnectionIcons(key.replace(/-/g, " ")).map((entry) => entry.key),
      ).toContain(key);
    },
  );
  it.each(REQUESTED)(
    "round-trips explicit %s for a connection and a folder",
    (key) => {
      for (const isGroup of [false, true]) {
        const restored = normalizeAdvancedProtocolConnection(
          JSON.parse(
            JSON.stringify({
              id: "industrial-icon",
              name: "Industrial icon",
              protocol: "ssh",
              icon: key,
              isGroup,
            }),
          ),
        );
        expect(restored.icon).toBe(key);
        expect(
          resolveEffectiveConnectionIcon({
            ...restored,
            protocol: restored.protocol ?? "ssh",
          }),
        ).toMatchObject({ key, source: "override" });
      }
    },
  );
  it("preserves all 680 existing keys and the unchanged runtime protocol surfaces", () => {
    expect(PREVIOUS_KEYS).toHaveLength(680);
    for (const key of PREVIOUS_KEYS)
      expect(getConnectionIconDefinition(key)?.key, key).toBe(key);
    expect(Object.keys(PROTOCOL_ICON_DEFAULTS)).toHaveLength(37);
    expect(integrationRegistry).toHaveLength(27);
    for (const protocol of Object.keys(PROTOCOL_ICON_DEFAULTS)) {
      expect(
        resolveEffectiveConnectionIcon({ protocol, isGroup: true }),
      ).toMatchObject({ key: "folder", source: "folder" });
    }
  });
  it.each([
    ["odoo", "CRM"],
    ["microsoft-dynamics365", "CRM"],
    ["temperature-gauge", "temperature"],
    ["pressure-gauge", "pressure"],
    ["level-gauge", "level"],
    ["speed-gauge", "speed"],
    ["power-gauge", "power"],
    ["hr-system", "human resources"],
    ["rfid", "RFID"],
    ["hvac", "HVAC"],
    ["ssl-vpn", "TLS VPN"],
    ["pptp-vpn", "PPTP VPN"],
    ["openvpn", "OpenVPN"],
    ["wireguard", "WireGuard"],
  ])("finds %s through natural wording %s", (key, query) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });
  it.each([
    [...BUILDINGS],
    ["mdm", "mdm-mobile", "mdm-fleet"],
    [
      "mini-server",
      "mini-server-tower",
      "mini-server-rack",
      "mini-server-cluster",
    ],
    [
      "access-control",
      "access-control-keypad",
      "access-control-biometric",
      "access-control-rfid",
    ],
    [
      "temperature-gauge",
      "pressure-gauge",
      "level-gauge",
      "speed-gauge",
      "power-gauge",
    ],
    ["remote-display", "remote-display-wall", "remote-projector"],
    ["analog-screen", "analog-controller", "controller"],
    ["speaker", "speaker-array"],
    ["offgrid-controller", "grid-controller"],
    ["stream", "stream-server"],
    ["api", "api-server"],
    ["pptp", "pptp-server", "pptp-vpn"],
    ["ipsec", "ipsec-server"],
    ["l2tp", "l2tp-server"],
    ["ikev2", "ikev2-server"],
    ["sstp", "sstp-server"],
    ["ssl-vpn", "ssl-vpn-server"],
    ["zerotier", "zerotier-vpn"],
    ["tailscale", "tailscale-vpn"],
    ["netbird", "netbird-vpn"],
    ["twingate", "twingate-vpn"],
    ["nebula", "nebula-vpn"],
    ["softether", "softether-vpn"],
  ])("keeps the %s family geometrically distinct", (...keys) => {
    expect(new Set(keys.map((key) => geometry(svgFor(key)))).size).toBe(
      keys.length,
    );
  });
  it("routes providers to their own section while leaving cloud and network devices separate", () => {
    expect(CONNECTION_ICON_CATEGORIES).toHaveLength(24);
    const providers = CONNECTION_ICON_CATALOG.filter((entry) =>
      ["isp-providers", "hosting-providers", "domain-registrars"].includes(
        entry.category,
      ),
    );
    expect(
      providers
        .filter((entry) => (PROVIDERS as readonly string[]).includes(entry.key))
        .map((entry) => entry.key)
        .sort(),
    ).toEqual([...PROVIDERS].sort());
    for (const key of ["googlecloud", "azure", "hetzner-cloud", "ovh-cloud"])
      expect(getConnectionIconDefinition(key)?.category, key).toBe("cloud");
    for (const key of VPN)
      expect(getConnectionIconDefinition(key)?.category, key).toBe("network");
    for (const key of DEVICES)
      expect(getConnectionIconDefinition(key)?.category, key).toBe(
        "servers-devices",
      );
    for (const key of BUSINESS)
      expect(getConnectionIconDefinition(key)?.category, key).toBe(
        "web-applications",
      );
    for (const key of BUILDINGS)
      expect(getConnectionIconDefinition(key)?.category, key).toBe(
        "business-shapes",
      );
  });
  it("renders the real provider section and selects a provider without changing protocol", () => {
    const onChange = vi.fn();
    render(
      <ConnectionIconPicker
        connection={{ protocol: "ssh" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      {
        target: { value: "vodafone" },
      },
    );
    const section = screen.getByRole("button", {
      name: /ISPs & providers/,
    });
    expect(section).toHaveAttribute("aria-expanded", "true");
    const provider = screen.getByRole("option", {
      name: "Vodafone (vodafone)",
    });
    expect(geometry(provider.querySelector("svg")!)).toBe(
      geometry(svgFor("vodafone")),
    );
    fireEvent.click(provider);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("vodafone");
    expect(within(section.parentElement!).queryByText("Cloud")).toBeNull();
  });
});
