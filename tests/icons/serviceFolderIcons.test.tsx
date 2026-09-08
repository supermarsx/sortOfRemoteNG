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

const FOLDERS = [
  ["folder-directory", "directories"],
  ["folder-file-server", "file servers"],
  ["folder-mail-server", "mail servers"],
  ["folder-container-server", "container servers"],
  ["folder-hypervisor", "hypervisors"],
] as const;

// Exact complete catalog before these six additive folder/container entries.
const PREVIOUS_KEYS =
  "monitor terminal eye phone monitor-play keyboard pointer anydesk rustdesk powershell microsoft-rdp apple-rd vnc serial serial-switch serial-router serial-hardware telnet ftp-server sftp-server scp scp-server filezilla openssh mremoteng ultravnc tightvnc citrix citrix-web microsoft-rd-gateway dameware server server-cog cpu drive laptop smartphone tablet television printer camera container boxes storage-server time-clock biometrics-device mobile-hotspot ups iot-device electrical-iot-device interactive-pdu lighting-equipment file-server smb-server appliance print-server globe network router wifi cable waypoints radio-tower route link share radio freshtomato dns-server time-server isp-router gateway openvpn openvpn-server wireguard wireguard-server bind-server netbox openldap samba custom-vpn apple-vpn microsoft-vpn cisco-vpn proxy-tunnel wired-router snmp porkbun namecheap godaddy gandi ionos cloudflare cloud cloud-cog cloud-upload cloud-download cloud-lightning googlecloud azure hetzner-cloud ovh-cloud digitalocean-cloud oracle-cloud alibaba-cloud tencent-cloud ibm-cloud redhat-cloud linode database database-backup database-zap table mongodb postgresql mysql mariadb mysql-database mongodb-database mariadb-database postgresql-database sql-server mssql sqlpad redis activity bar-chart chart gauge workflow git-branch git-commit package wrench settings code file-code bug test-tube kanban panel bot webhook github git git-server drone-ci drone-ci-server rmm rmm-server meshcentral llm llm-server ai-agent agent-server jenkins jenkins-server github-actions github-actions-server gitlab-ci gitlab-ci-server teamcity teamcity-server circleci circleci-server travisci travisci-server buildkite buildkite-server azure-devops azure-devops-server ansible n8n node-red rundeck puppet gitea minio prometheus prometheus-server elasticsearch elasticsearch-server jira splunk shield shield-check shield-alert lock key-round fingerprint scan-face file-key pfsense opnsense opnsense-router pfsense-router snort suricata zeek wazuh fortinet fortinet-firewall kms-server keepass keepassx password-vault vault bitwarden firewall folder folder-open folder-cog folder-tree folder-lock folder-archive folder-code folder-git folder-sync folder-clock folder-kanban folder-heart folder-work folder-personal folder-remote folder-rdp folder-phone folder-switch folder-router folder-web folder-admin folder-ssh folder-server folder-nas folder-access-point file file-text archive save upload download invoice mail mailbox message messages send bell life-buoy at-sign active-directory postfix mail-server dovecot active-directory-server exchange-server mta-server slack mattermost rocket-chat matrix zulip element mailcow mailcow-server osticket star heart circle circle-dot square triangle diamond hexagon bookmark tag flag pentagon octagon rectangle-horizontal rectangle-vertical triangle-right circle-dashed square-dashed diamond-plus asterisk-shape cross target orbit building office people corporate computer generic-os cross-platform redhat redhat-server centos centos-server ubuntu ubuntu-server fedora macos windows freebsd freebsd-server linux android debian rocky-linux almalinux opensuse windows-server linux-server macos-server virtual-machine hypervisor noip vmware proxmox portainer vmware-server proxmox-server portainer-server container-server virtualization-server kubernetes vsphere vmware-workstation docker docker-server lxd incus hyperv hyperv-server switch access-point nas dell hp supermicro hpe synology synology-nas tplink dlink cisco asus dell-server supermicro-server cisco-access-point tplink-access-point asus-access-point hpe-switch levelone levelone-switch arista arista-switch ibm microsoft netapp apple lenovo brother kyocera xerox epson canon huawei samsung razer clevo fujitsu lg ubiquiti avaya acer msi toshiba juniper mikrotik qnap hp-printer brother-printer kyocera-printer epson-printer xerox-printer canon-printer apple-computer windows-computer lenovo-server lenovo-pc lenovo-laptop dell-laptop hp-laptop macbook razer-laptop asus-laptop clevo-laptop huawei-laptop fujitsu-laptop samsung-laptop lg-laptop acer-laptop msi-laptop toshiba-laptop huawei-olt huawei-access-point huawei-router huawei-switch asus-router cisco-router ubiquiti-access-point ubiquiti-switch avaya-switch ilo juniper-router mikrotik-router qnap-nas lenovo-tablet samsung-tablet apple-tablet asustor arduino raspberry-pi espressif shelly ugreen ugreen-nas schneider-electric schneider-electric-ups vertiv vertiv-ups riello riello-ups apc apc-ups eaton eaton-ups cyberpower cyberpower-ups tripplite tripplite-ups sonoff tuya supermicro-bmc dell-idrac lenovo-xclarity truenas truenas-nas draytek draytek-switch draytek-router intel-amt mikrotik-access-point mikrotik-switch voip pbx-server freepbx freepbx-server asterisk asterisk-server yealink grandstream yealink-phone grandstream-phone cisco-phone ubiquiti-phone iphone android-phone samsung-phone web-server build-server code-server nginx traefikproxy grafana cpanel nginx-server envoy envoy-server google microsoft365 phpmyadmin wordpress joomla website-backend apache reverse-proxy home-assistant esphome tasmota payload-cms drupal ghost strapi directus nextcloud nextcloud-server caddy php php-fpm nginx-proxy-manager nginx-proxy-manager-server google-drive budibase pos erp invoice-server business-analytics-server analytics-server odoo metabase apache-superset redash matomo plausible sap oracle-erp erpnext dolibarr microsoft-dynamics365 metabase-server apache-superset-server redash-server matomo-server plausible-server phc cegid primavera tomcat tomcat-server java nodejs".split(
    /\s+/,
  );

function svgFor(key: string) {
  const entry = getConnectionIconDefinition(key);
  expect(entry, key).toBeDefined();
  const svg = new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry!.icon)),
    "image/svg+xml",
  ).documentElement;
  expect(svg.tagName).toBe("svg");
  expect(svg.querySelector("image, text, use, foreignObject")).toBeNull();
  return svg;
}
function geometry(key: string) {
  const svg = svgFor(key);
  for (const node of Array.from(svg.querySelectorAll("[class]")))
    node.removeAttribute("class");
  return svg.innerHTML;
}

describe("service folder and alternate container icons", () => {
  it.each(FOLDERS)(
    "renders %s with a folder frame and supports plural %s",
    (key, query) => {
      const svg = svgFor(key);
      expect(
        svg.querySelector('[data-role-frame="folder"] path'),
      ).not.toBeNull();
      const inset = svg.querySelector("svg");
      expect(inset).not.toBeNull();
      expect(inset!.querySelector("path, rect, circle")).not.toBeNull();
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        key,
      );
      expect(
        filterConnectionIcons("folder " + query).map((entry) => entry.key),
      ).toContain(key);
    },
  );
  it("keeps all five service folders geometrically distinct", () => {
    const markup = FOLDERS.map(([key]) => geometry(key));
    expect(new Set(markup).size).toBe(FOLDERS.length);
    for (const value of markup) expect(value).not.toBe(geometry("folder"));
  });
  it("provides a genuinely different alternate container", () => {
    expect(geometry("container-alt")).not.toBe(geometry("container"));
    expect(
      filterConnectionIcons("container").map((entry) => entry.key),
    ).toEqual(expect.arrayContaining(["container", "container-alt"]));
  });
  it.each([...FOLDERS.map(([key]) => key), "container-alt"])(
    "preserves explicit group selection %s across JSON and normalization",
    (key) => {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "group",
            name: "Services",
            protocol: "rdp",
            isGroup: true,
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
    },
  );
  it("preserves every existing key and automatic folder behavior", () => {
    expect(PREVIOUS_KEYS).toHaveLength(534);
    const current = CONNECTION_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(current).size).toBe(current.length);
    for (const key of PREVIOUS_KEYS)
      expect(getConnectionIconDefinition(key)?.key, key).toBe(key);
    for (const icon of [undefined, "unknown-folder"])
      expect(
        resolveEffectiveConnectionIcon({
          protocol: "rdp",
          isGroup: true,
          icon,
        }),
      ).toMatchObject({ key: "folder", source: "folder" });
  });
});
