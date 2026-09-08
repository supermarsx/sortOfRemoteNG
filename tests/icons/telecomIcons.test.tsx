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

const REQUESTED = [
  ["meo", "meo"],
  ["vodafone", "vodafone"],
  ["nos", "nos"],
  ["digi", "digi"],
  ["deutsche-telekom", "deustch telekom"],
  ["telecom", "generic telecom"],
  ["viva", "viva"],
  ["orange", "orange"],
  ["uzo", "uzo"],
  ["t-mobile", "t-mobile"],
  ["o2", "o2"],
  ["tele2", "tele2"],
  ["sfr", "sfr"],
  ["altice", "altice"],
  ["att", "at&t"],
  ["three", "three"],
  ["hurricane-electric", "hurricane eletric"],
  ["nowo", "nowo"],
  ["movistar", "movistar"],
  ["mobile-hotspot-alt", "mobile hotspot variant"],
  ["remote-office", "remote office"],
  ["hotspot-5g", "5g hotspot"],
] as const;
// Complete540-key catalog snapshot before this telecom/device addition.
const PREVIOUS_KEYS =
  "monitor terminal eye phone monitor-play keyboard pointer anydesk rustdesk powershell microsoft-rdp apple-rd vnc serial serial-switch serial-router serial-hardware telnet ftp-server sftp-server scp scp-server filezilla openssh mremoteng ultravnc tightvnc citrix citrix-web microsoft-rd-gateway dameware server server-cog cpu drive laptop smartphone tablet television printer camera container boxes storage-server time-clock biometrics-device mobile-hotspot ups iot-device electrical-iot-device interactive-pdu lighting-equipment file-server smb-server appliance print-server container-alt globe network router wifi cable waypoints radio-tower route link share radio freshtomato dns-server time-server isp-router gateway openvpn openvpn-server wireguard wireguard-server bind-server netbox openldap samba custom-vpn apple-vpn microsoft-vpn cisco-vpn proxy-tunnel wired-router snmp porkbun namecheap godaddy gandi ionos cloudflare cloud cloud-cog cloud-upload cloud-download cloud-lightning googlecloud azure hetzner-cloud ovh-cloud digitalocean-cloud oracle-cloud alibaba-cloud tencent-cloud ibm-cloud redhat-cloud linode database database-backup database-zap table mongodb postgresql mysql mariadb mysql-database mongodb-database mariadb-database postgresql-database sql-server mssql sqlpad redis activity bar-chart chart gauge workflow git-branch git-commit package wrench settings code file-code bug test-tube kanban panel bot webhook github git git-server drone-ci drone-ci-server rmm rmm-server meshcentral llm llm-server ai-agent agent-server jenkins jenkins-server github-actions github-actions-server gitlab-ci gitlab-ci-server teamcity teamcity-server circleci circleci-server travisci travisci-server buildkite buildkite-server azure-devops azure-devops-server ansible n8n node-red rundeck puppet gitea minio prometheus prometheus-server elasticsearch elasticsearch-server jira splunk shield shield-check shield-alert lock key-round fingerprint scan-face file-key pfsense opnsense opnsense-router pfsense-router snort suricata zeek wazuh fortinet fortinet-firewall kms-server keepass keepassx password-vault vault bitwarden firewall folder folder-open folder-cog folder-tree folder-lock folder-archive folder-code folder-git folder-sync folder-clock folder-kanban folder-heart folder-work folder-personal folder-remote folder-rdp folder-phone folder-switch folder-router folder-web folder-admin folder-ssh folder-server folder-nas folder-access-point folder-directory folder-file-server folder-mail-server folder-container-server folder-hypervisor file file-text archive save upload download invoice mail mailbox message messages send bell life-buoy at-sign active-directory postfix mail-server dovecot active-directory-server exchange-server mta-server slack mattermost rocket-chat matrix zulip element mailcow mailcow-server osticket star heart circle circle-dot square triangle diamond hexagon bookmark tag flag pentagon octagon rectangle-horizontal rectangle-vertical triangle-right circle-dashed square-dashed diamond-plus asterisk-shape cross target orbit building office people corporate computer generic-os cross-platform redhat redhat-server centos centos-server ubuntu ubuntu-server fedora macos windows freebsd freebsd-server linux android debian rocky-linux almalinux opensuse windows-server linux-server macos-server virtual-machine hypervisor noip vmware proxmox portainer vmware-server proxmox-server portainer-server container-server virtualization-server kubernetes vsphere vmware-workstation docker docker-server lxd incus hyperv hyperv-server switch access-point nas dell hp supermicro hpe synology synology-nas tplink dlink cisco asus dell-server supermicro-server cisco-access-point tplink-access-point asus-access-point hpe-switch levelone levelone-switch arista arista-switch ibm microsoft netapp apple lenovo brother kyocera xerox epson canon huawei samsung razer clevo fujitsu lg ubiquiti avaya acer msi toshiba juniper mikrotik qnap hp-printer brother-printer kyocera-printer epson-printer xerox-printer canon-printer apple-computer windows-computer lenovo-server lenovo-pc lenovo-laptop dell-laptop hp-laptop macbook razer-laptop asus-laptop clevo-laptop huawei-laptop fujitsu-laptop samsung-laptop lg-laptop acer-laptop msi-laptop toshiba-laptop huawei-olt huawei-access-point huawei-router huawei-switch asus-router cisco-router ubiquiti-access-point ubiquiti-switch avaya-switch ilo juniper-router mikrotik-router qnap-nas lenovo-tablet samsung-tablet apple-tablet asustor arduino raspberry-pi espressif shelly ugreen ugreen-nas schneider-electric schneider-electric-ups vertiv vertiv-ups riello riello-ups apc apc-ups eaton eaton-ups cyberpower cyberpower-ups tripplite tripplite-ups sonoff tuya supermicro-bmc dell-idrac lenovo-xclarity truenas truenas-nas draytek draytek-switch draytek-router intel-amt mikrotik-access-point mikrotik-switch voip pbx-server freepbx freepbx-server asterisk asterisk-server yealink grandstream yealink-phone grandstream-phone cisco-phone ubiquiti-phone iphone android-phone samsung-phone web-server build-server code-server nginx traefikproxy grafana cpanel nginx-server envoy envoy-server google microsoft365 phpmyadmin wordpress joomla website-backend apache reverse-proxy home-assistant esphome tasmota payload-cms drupal ghost strapi directus nextcloud nextcloud-server caddy php php-fpm nginx-proxy-manager nginx-proxy-manager-server google-drive budibase pos erp invoice-server business-analytics-server analytics-server odoo metabase apache-superset redash matomo plausible sap oracle-erp erpnext dolibarr microsoft-dynamics365 metabase-server apache-superset-server redash-server matomo-server plausible-server phc cegid primavera tomcat tomcat-server java nodejs".split(
    /\s+/,
  );

function geometry(key: string) {
  const entry = getConnectionIconDefinition(key);
  expect(entry, key).toBeDefined();
  const svg = new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry!.icon, { size: 24 })),
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

describe("telecom providers and connectivity devices", () => {
  it.each(REQUESTED)("renders and finds %s using %s", (key, query) => {
    expect(geometry(key)).not.toBe("");
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });
  it.each(REQUESTED)("persists %s for both an endpoint and a folder", (key) => {
    for (const isGroup of [false, true]) {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "telecom",
            name: "Telecom",
            protocol: "ssh",
            isGroup,
            icon: key,
          }),
        ),
      );
      expect(restored.icon).toBe(key);
      expect(restored.isGroup).toBe(isGroup);
      expect(restored).not.toHaveProperty("iconComponent");
      expect(
        resolveEffectiveConnectionIcon({
          ...restored,
          protocol: restored.protocol ?? "ssh",
        }),
      ).toMatchObject({ key, source: "override" });
    }
  });
  it.each([
    ["deutsche telekom", "deutsche-telekom"],
    ["deustch telekom", "deutsche-telekom"],
    ["hurricane electric", "hurricane-electric"],
    ["hurricane eletric", "hurricane-electric"],
    ["at and t", "att"],
    ["t mobile", "t-mobile"],
  ])("recognizes telecom alias %s", (query, key) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });
  it.each([
    ["mobile-hotspot", "mobile-hotspot-alt"],
    ["mobile-hotspot", "hotspot-5g"],
    ["mobile-hotspot-alt", "hotspot-5g"],
    ["office", "remote-office"],
    ["remote-office", "mobile-hotspot-alt"],
    ["remote-office", "hotspot-5g"],
  ])("gives %s and %s distinct geometry", (base, variant) => {
    expect(geometry(base)).not.toBe(geometry(variant));
  });
  it("preserves all540 previous keys and existing automatic choices", () => {
    expect(PREVIOUS_KEYS).toHaveLength(540);
    const keys = CONNECTION_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of PREVIOUS_KEYS)
      expect(getConnectionIconDefinition(key)?.key, key).toBe(key);
    expect(
      resolveEffectiveConnectionIcon({ protocol: "ssh", isGroup: false }),
    ).toMatchObject({ key: "ssh", source: "protocol" });
    expect(
      resolveEffectiveConnectionIcon({ protocol: "ssh", isGroup: true }),
    ).toMatchObject({ key: "folder", source: "folder" });
    expect(
      resolveEffectiveConnectionIcon({
        protocol: "ssh",
        isGroup: true,
        icon: "missing-telecom",
      }),
    ).toMatchObject({ key: "folder", source: "folder" });
  });
});
