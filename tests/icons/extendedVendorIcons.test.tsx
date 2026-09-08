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

// Explicit latest-request inventory. A role is not satisfied by merely returning
// its manufacturer's bare logo; the role pairs below compare SVG geometry too.
const REQUESTED: readonly (readonly [key: string, search: string])[] = [
  ["fedora", "fedora"],
  ["freshtomato", "FreshTomato"],
  ["asus", "asus"],
  ["asus-router", "asus router"],
  ["printer", "printers"],
  ["hp-printer", "hp printer"],
  ["brother-printer", "brother printer"],
  ["kyocera-printer", "kyocera printer"],
  ["epson-printer", "epson printer"],
  ["brother", "brother"],
  ["kyocera", "kyocera"],
  ["xerox", "xerox"],
  ["epson", "epson"],
  ["yealink", "yealink"],
  ["yealink-phone", "yealink phone"],
  ["macos", "macos"],
  ["windows", "windows"],
  ["apple", "apple"],
  ["apple-computer", "apple computer"],
  ["windows-computer", "windows computer"],
  ["lenovo", "lenovo"],
  ["lenovo-server", "lenovo server"],
  ["lenovo-pc", "lenovo pc"],
  ["rmm", "rmm"],
  ["rmm-server", "rmm server"],
  ["meshcentral", "meshcentral"],
  ["snort", "snort"],
  ["suricata", "suricata"],
  ["zeek", "zeek"],
  ["wazuh", "wazuh"],
  ["dns-server", "dns server"],
  ["time-server", "time server"],
  ["time-clock", "employee time clock"],
  ["biometrics-device", "biometrics device"],
  ["lenovo-laptop", "lenovo laptop"],
  ["dell-laptop", "dell laptop"],
  ["hp-laptop", "hp laptop"],
  ["macbook", "macbook"],
  ["razer-laptop", "razer laptop"],
  ["asus-laptop", "asus laptop"],
  ["clevo-laptop", "clevo laptop"],
  ["huawei", "huawei"],
  ["huawei-olt", "huawei olt"],
  ["huawei-access-point", "huawei access point"],
  ["huawei-router", "huawei router"],
  ["huawei-switch", "huawei switch"],
  ["huawei-laptop", "huawei laptop"],
  ["fujitsu-laptop", "fujitsu laptop"],
  ["iphone", "iphone"],
  ["android-phone", "android phone"],
  ["samsung", "samsung"],
  ["samsung-laptop", "samsung laptop"],
  ["samsung-phone", "samsung phone"],
  ["lg-laptop", "lg laptop"],
  ["grandstream", "grandstream"],
  ["grandstream-phone", "grandstream phone"],
  ["cisco-phone", "cisco phone"],
  ["ubiquiti-access-point", "ubiquiti access point"],
  ["ubiquiti-switch", "ubiquiti switch"],
  ["ubiquiti-phone", "ubiquiti phone"],
  ["mobile-hotspot", "mobile hotspot"],
  ["openvpn", "openvpn"],
  ["openvpn-server", "openvpn server"],
  ["wireguard", "wireguard"],
  ["wireguard-server", "wireguard server"],
  ["opnsense-router", "opnsense router"],
  ["pfsense-router", "pfsense router"],
  ["cisco-router", "cisco router"],
  ["freebsd", "freebsd"],
  ["freebsd-server", "freebsd server"],
  ["ilo", "ilo"],
  ["phpmyadmin", "phpmyadmin"],
  ["wordpress", "wordpress"],
  ["joomla", "joomla"],
  ["website-backend", "website backend"],
  ["llm-server", "llm server"],
  ["llm", "llm"],
  ["agent-server", "agent server"],
  ["ai-agent", "ai agent"],
  ["active-directory", "active directory"],
  ["postfix", "postfix"],
  ["mail-server", "mail server"],
  ["dovecot", "dovecot"],
  ["avaya", "avaya"],
  ["avaya-switch", "avaya switch"],
  ["isp-router", "isp router"],
  ["gateway", "gateway"],
  ["apache", "apache"],
  ["reverse-proxy", "reverse proxy"],
  ["storage-server", "storage server"],
  ["qnap", "qnap"],
  ["qnap-nas", "qnap nas"],
  ["asustor", "asustor"],
  ["apc", "apc"],
  ["ups", "ups machine"],
  ["apc-ups", "apc ups"],
  ["eaton", "eaton"],
  ["eaton-ups", "eaton ups"],
  ["tablet", "tablets"],
  ["lenovo-tablet", "lenovo tablet"],
  ["samsung-tablet", "samsung tablet"],
  ["apple-tablet", "apple tablet"],
  ["arduino", "arduino"],
  ["raspberry-pi", "raspberry pi"],
  ["iot-device", "iot devices"],
  ["ugreen", "ugreen"],
  ["ugreen-nas", "ugreen nas"],
  ["schneider-electric", "schneider electric"],
  ["schneider-electric-ups", "schneider electric ups"],
  ["electrical-iot-device", "electrical iot device"],
  ["interactive-pdu", "interactive pdu"],
  ["lighting-equipment", "lighting equipment"],
];

// ALL 221 catalog keys snapshotted before this expansion, including the prior
// requested infrastructure palette. The persisted contract is a key, not index.
const EXISTING_KEYS =
  `cloud cloud-cog cloud-upload cloud-download cloud-lightning googlecloud azure hetzner-cloud ovh-cloud digitalocean-cloud oracle-cloud alibaba-cloud tencent-cloud ibm-cloud redhat-cloud linode
mail mailbox message messages send bell life-buoy at-sign database database-backup database-zap table mongodb postgresql mysql mariadb mysql-database mongodb-database mariadb-database postgresql-database
activity bar-chart chart gauge workflow git-branch git-commit package wrench settings code file-code bug test-tube kanban panel bot webhook github git git-server drone-ci drone-ci-server
file file-text archive save upload download folder folder-open folder-cog folder-tree folder-lock folder-archive folder-code folder-git folder-sync folder-clock folder-kanban folder-heart folder-work folder-personal folder-remote folder-rdp folder-phone folder-switch folder-router folder-web folder-admin folder-ssh folder-server folder-nas folder-access-point
star heart circle circle-dot square triangle diamond hexagon bookmark tag flag pentagon octagon rectangle-horizontal rectangle-vertical triangle-right circle-dashed square-dashed diamond-plus asterisk-shape cross target orbit
globe network router wifi cable waypoints radio-tower route link share radio computer generic-os cross-platform redhat redhat-server centos centos-server ubuntu ubuntu-server
monitor terminal eye phone monitor-play keyboard pointer anydesk rustdesk powershell shield shield-check shield-alert lock key-round fingerprint scan-face file-key pfsense
server server-cog cpu drive laptop smartphone tablet television printer camera container boxes storage-server switch access-point nas dell hp supermicro hpe synology synology-nas tplink dlink cisco asus dell-server supermicro-server cisco-access-point tplink-access-point asus-access-point hpe-switch levelone levelone-switch arista arista-switch ibm microsoft netapp
virtual-machine hypervisor noip vmware proxmox portainer vmware-server proxmox-server portainer-server container-server virtualization-server kubernetes voip pbx-server freepbx freepbx-server asterisk asterisk-server
web-server build-server code-server nginx traefikproxy grafana cpanel nginx-server envoy envoy-server google microsoft365`.split(
    /\s+/,
  );

const CURATED_EXTRAS = [
  "debian",
  "rocky-linux",
  "almalinux",
  "opensuse",
  "linux",
  "android",
  "opnsense",
  "xerox-printer",
  "acer",
  "msi",
  "toshiba",
  "acer-laptop",
  "msi-laptop",
  "toshiba-laptop",
  "canon",
  "canon-printer",
  "juniper",
  "juniper-router",
  "mikrotik",
  "mikrotik-router",
  "qnap",
  "qnap-nas",
  "fortinet",
  "fortinet-firewall",
  "cyberpower",
  "cyberpower-ups",
  "vertiv",
  "vertiv-ups",
  "tripplite",
  "tripplite-ups",
  "riello",
  "riello-ups",
  "espressif",
  "shelly",
  "sonoff",
  "tuya",
  "home-assistant",
  "esphome",
  "tasmota",
  "jenkins",
  "jenkins-server",
  "github-actions",
  "github-actions-server",
  "gitlab-ci",
  "gitlab-ci-server",
  "teamcity",
  "teamcity-server",
  "circleci",
  "circleci-server",
  "travisci",
  "travisci-server",
  "buildkite",
  "buildkite-server",
  "azure-devops",
  "azure-devops-server",
];

function svgFor(key: string): Element {
  const definition = getConnectionIconDefinition(key);
  expect(definition, `Missing requested key: ${key}`).toBeDefined();
  const markup = renderToStaticMarkup(
    createElement(definition!.icon, {
      size: 24,
      "aria-label": definition!.ariaLabel,
    }),
  );
  return new DOMParser().parseFromString(markup, "image/svg+xml")
    .documentElement;
}

function geometry(key: string): string {
  const svg = svgFor(key);
  // Ignore nonvisual class names so distinct component wrappers alone cannot
  // satisfy the manufacturer's printer/phone/router/server distinction.
  for (const node of Array.from(svg.querySelectorAll("[class]")))
    node.removeAttribute("class");
  return svg.innerHTML;
}

describe("extended vendor icon request", () => {
  it.each(CURATED_EXTRAS)("includes the bounded extra %s", (key) => {
    expect(svgFor(key).tagName).toBe("svg");
    expect(
      filterConnectionIcons(key.replace(/-/g, " ")).map((entry) => entry.key),
    ).toContain(key);
  });

  it.each(REQUESTED)("renders and finds %s with %s", (key, query) => {
    const svg = svgFor(key);
    expect(svg.tagName).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(
      svg.querySelector("path, rect, circle, ellipse, polygon, polyline, line"),
    ).not.toBeNull();
    expect(svg.querySelector("image, foreignObject, use, text")).toBeNull();
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });

  it("preserves all previous keys without duplicates", () => {
    expect(EXISTING_KEYS).toHaveLength(221);
    const keys = CONNECTION_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of EXISTING_KEYS) {
      expect(
        getConnectionIconDefinition(key)?.key,
        `Preserved key ${key}`,
      ).toBe(key);
    }
  });

  it.each(REQUESTED)(
    "round-trips the selected %s key without serializing SVG",
    (key) => {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "connection",
            name: "Endpoint",
            protocol: "rdp",
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
          protocol: restored.protocol ?? "rdp",
        }),
      ).toMatchObject({ key, source: "override" });
    },
  );

  it.each([
    ["smasung", "samsung"],
    ["smasung phone", "samsung-phone"],
    ["fresh tomato", "freshtomato"],
    ["NTP", "time-server"],
    ["employee check in", "time-clock"],
    ["time check in employees", "time-clock"],
    ["biometric checkin", "biometrics-device"],
    ["HPE iLO", "ilo"],
    ["DNS", "dns-server"],
    ["raspbery pi", "raspberry-pi"],
    ["chneider eletric", "schneider-electric"],
    ["chneider eletric ups", "schneider-electric-ups"],
  ])("recognizes useful alias %s", (query, key) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });

  it.each([
    ["asus", "asus-router"],
    ["asus", "asus-laptop"],
    ["hp", "hp-printer"],
    ["brother", "brother-printer"],
    ["kyocera", "kyocera-printer"],
    ["epson", "epson-printer"],
    ["yealink", "yealink-phone"],
    ["apple", "apple-computer"],
    ["windows", "windows-computer"],
    ["lenovo", "lenovo-server"],
    ["lenovo", "lenovo-pc"],
    ["lenovo", "lenovo-laptop"],
    ["hp", "hp-laptop"],
    ["dell", "dell-laptop"],
    ["apple", "macbook"],
    ["apple", "iphone"],
    ["huawei", "huawei-olt"],
    ["huawei", "huawei-access-point"],
    ["huawei", "huawei-router"],
    ["huawei", "huawei-switch"],
    ["huawei", "huawei-laptop"],
    ["samsung", "samsung-phone"],
    ["samsung", "samsung-laptop"],
    ["grandstream", "grandstream-phone"],
    ["cisco", "cisco-phone"],
    ["cisco", "cisco-router"],
    ["avaya", "avaya-switch"],
    ["rmm", "rmm-server"],
    ["openvpn", "openvpn-server"],
    ["wireguard", "wireguard-server"],
    ["freebsd", "freebsd-server"],
    ["llm", "llm-server"],
    ["ai-agent", "agent-server"],
    ["xerox", "xerox-printer"],
    ["acer", "acer-laptop"],
    ["msi", "msi-laptop"],
    ["toshiba", "toshiba-laptop"],
    ["android", "android-phone"],
    ["opnsense", "opnsense-router"],
    ["pfsense", "pfsense-router"],
    ["canon", "canon-printer"],
    ["juniper", "juniper-router"],
    ["mikrotik", "mikrotik-router"],
    ["qnap", "qnap-nas"],
    ["fortinet", "fortinet-firewall"],
    ["apc", "apc-ups"],
    ["eaton", "eaton-ups"],
    ["schneider-electric", "schneider-electric-ups"],
    ["cyberpower", "cyberpower-ups"],
    ["vertiv", "vertiv-ups"],
    ["tripplite", "tripplite-ups"],
    ["riello", "riello-ups"],
    ["lenovo", "lenovo-tablet"],
    ["samsung", "samsung-tablet"],
    ["apple", "apple-tablet"],
    ["ugreen", "ugreen-nas"],
    ["jenkins", "jenkins-server"],
    ["github-actions", "github-actions-server"],
    ["gitlab-ci", "gitlab-ci-server"],
    ["teamcity", "teamcity-server"],
    ["circleci", "circleci-server"],
    ["travisci", "travisci-server"],
    ["buildkite", "buildkite-server"],
    ["azure-devops", "azure-devops-server"],
  ])("renders %s and %s with different geometry", (base, role) => {
    expect(geometry(role)).not.toBe(geometry(base));
  });
});
