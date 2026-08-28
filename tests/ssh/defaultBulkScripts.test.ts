import { describe, expect, it } from "vitest";
import { defaultBulkScripts } from "../../src/data/defaultBulkScripts";
import {
  decorateBulkScript,
  isDestructiveBulkScript,
} from "../../src/hooks/ssh/bulkScriptLibrary";
import { containsLikelySecretText } from "../../src/utils/storage/appDataJsonStore";

const byId = (id: string) => {
  const script = defaultBulkScripts.find((candidate) => candidate.id === id);
  expect(script, `missing default bulk script ${id}`).toBeDefined();
  return script!;
};

const EXTRA_EMBEDDED_CREDENTIAL_PATTERNS = [
  /\b(?:password|passwd|passphrase|secret|token|api[_-]?key|authorization)\b\s*[:=]\s*(?!["']?(?:[$%{<]|\[?redacted\b))(?:(?:"[^"]{3,}")|(?:'[^']{3,}')|(?:[^\s;#]{3,}))/i,
  /(?:--password|--passwd|--passphrase|--secret|--token|--api[_-]?key|--authorization)(?:=|\s+)(?![$%{<])(?:"[^"]+"|'[^']+'|\S+)/i,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i,
];

const containsEmbeddedCredential = (value: string): boolean =>
  containsLikelySecretText(value) ||
  EXTRA_EMBEDDED_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));

describe("default bulk SSH script catalog", () => {
  it("has stable, unique, complete catalog records", () => {
    expect(defaultBulkScripts).toHaveLength(151);

    const ids = defaultBulkScripts.map((script) => script.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const script of defaultBulkScripts) {
      expect(script.id).toMatch(/^default-[a-z0-9-]+$/);
      expect(script.name.trim()).not.toBe("");
      expect(script.description.trim()).not.toBe("");
      expect(script.category.trim()).not.toBe("");
      expect(script.script.trim()).not.toBe("");
      expect(Number.isNaN(Date.parse(script.createdAt))).toBe(false);
      expect(script.updatedAt).toBe(script.createdAt);
    }
  });

  it("covers the required cross-platform operational areas", () => {
    const categories = new Set(
      defaultBulkScripts.map((script) => script.category),
    );
    for (const category of [
      "System",
      "Packages",
      "Network",
      "Files",
      "Media",
      "Logs",
      "Mail",
      "Security",
      "Web",
      "Development",
      "Services",
      "Maintenance",
      "DNS",
      "VPN",
      "Virtualization",
      "Cisco IOS",
      "HPE",
      "Arista",
      "Android",
    ]) {
      expect(categories).toContain(category);
    }

    const requiredScripts = [
      "default-package-update-linux",
      "default-package-update-brew",
      "default-package-update-choco",
      "default-package-update-winget",
      "default-traceroute-cloudflare-posix",
      "default-broken-symlinks",
      "default-duplicate-files",
      "default-empty-files",
      "default-sha256-check",
      "default-image-resize",
      "default-archive-extract",
      "default-postfix-queue-reset",
      "default-network-interface-reset-posix",
      "default-network-interface-reset-windows",
      "default-reboot-posix",
      "default-reboot-windows",
      "default-audio-extract",
      "default-audio-search",
      "default-log-discovery-posix",
      "default-mail-stack-health",
      "default-fail2ban-status",
      "default-letsencrypt-audit",
      "default-proxy-config-validation",
      "default-git-repository-audit",
      "default-service-discovery-posix",
      "default-service-discovery-windows",
      "default-windows11-debloat-audit",
      "default-macos-debloat-audit",
      "default-dns-diagnostics-posix",
      "default-dns-diagnostics-windows",
      "default-vpn-inventory-posix",
      "default-vpn-inventory-windows",
      "default-virtualization-linux",
      "default-virtualization-macos",
      "default-virtualization-windows",
      "default-cisco-ios-version-inventory",
      "default-cisco-ios-running-config-audit",
      "default-cisco-ios-save-guarded",
      "default-hpe-comware-version-inventory",
      "default-hpe-comware-config-save-guarded",
      "default-hpe-aruba-cx-version-inventory",
      "default-hpe-aruba-cx-config-save-guarded",
      "default-arista-eos-version-inventory",
      "default-arista-eos-mlag",
      "default-arista-eos-save-guarded",
      "default-android-device-security",
      "default-android-termux-update-audit",
      "default-android-debloat-guarded",
    ];

    for (const id of requiredScripts) byId(id);
  });

  it("detects every supported package manager before applying updates", () => {
    const packageCatalog = defaultBulkScripts
      .filter((script) => script.category === "Packages")
      .map((script) => script.script)
      .join("\n");

    for (const manager of [
      "apt-get",
      "dnf",
      "yum",
      "zypper",
      "pacman",
      "apk",
      "brew",
    ]) {
      expect(packageCatalog).toContain(`command -v ${manager}`);
    }
    expect(packageCatalog).toContain("Get-Command choco");
    expect(packageCatalog).toContain("Get-Command winget");

    for (const id of [
      "default-package-update-linux",
      "default-package-update-brew",
      "default-package-update-choco",
      "default-package-update-winget",
    ]) {
      const script = byId(id).script;
      expect(script).toContain("APPLY_PACKAGE_UPDATES");
      expect(script).toContain("Refusing:");
      expect(script).toMatch(/exit 2/i);
    }
  });

  it.each([
    ["default-remove-tree-posix", "CONFIRM_RECURSIVE_REMOVE", /rm -rf --/],
    [
      "default-postfix-queue-reset",
      "CONFIRM_POSTFIX_QUEUE_RESET",
      /postsuper -d ALL/,
    ],
    [
      "default-network-interface-reset-posix",
      "CONFIRM_NETWORK_RESET",
      /(?:nmcli device disconnect|ip link set)/,
    ],
    [
      "default-network-interface-reset-windows",
      "CONFIRM_NETWORK_RESET",
      /Restart-NetAdapter/,
    ],
    ["default-reboot-posix", "CONFIRM_REBOOT", /shutdown -r now/],
    ["default-reboot-windows", "CONFIRM_REBOOT", /Restart-Computer/],
    [
      "default-service-restart-posix",
      "CONFIRM_SERVICE_RESTART",
      /systemctl restart/,
    ],
    [
      "default-service-restart-windows",
      "CONFIRM_SERVICE_RESTART",
      /Restart-Service/,
    ],
    [
      "default-windows11-remove-optional-app",
      "CONFIRM_WINDOWS_APP_REMOVAL",
      /Remove-AppxPackage/,
    ],
    ["default-macos-trash-app", "CONFIRM_MACOS_APP_TRASH", /mv --/],
    ["default-openvpn-restart", "CONFIRM_OPENVPN_RESTART", /systemctl restart/],
    [
      "default-android-termux-update-guarded",
      "APPLY_TERMUX_UPDATES",
      /(?:pkg|apt-get) update/,
    ],
    [
      "default-android-debloat-guarded",
      "CONFIRM_ANDROID_DISABLE",
      /pm disable-user/,
    ],
    [
      "default-android-cache-trim-guarded",
      "CONFIRM_ANDROID_CACHE_TRIM",
      /pm trim-caches/,
    ],
  ])("guards %s before its disruptive action", (id, guard, action) => {
    const script = byId(id).script;
    const guardIndex = script.indexOf(guard);
    const actionIndex = script.search(action);

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(script).toContain("Refusing:");
    expect(script).toMatch(/exit 2/i);
    expect(actionIndex).toBeGreaterThan(guardIndex);
  });

  it("applies extra path and debloat safety constraints", () => {
    const posixRemoval = byId("default-remove-tree-posix").script;
    expect(posixRemoval).toContain('case "$REMOVE_TREE_PATH"');
    expect(posixRemoval).toContain("/|.|..");
    expect(posixRemoval).toContain('[ -L "$REMOVE_TREE_PATH" ]');
    expect(posixRemoval).toContain(
      'TARGET_REAL=$(CDPATH= cd -P -- "$REMOVE_TREE_PATH"',
    );
    expect(posixRemoval).toContain('[ "$TARGET_REAL" = "/" ]');
    expect(posixRemoval).toContain('rm -rf -- "$TARGET_REAL"');
    expect(posixRemoval).not.toContain('rm -rf -- "$REMOVE_TREE_PATH"');

    const windowsAudit = byId("default-windows11-debloat-audit").script;
    expect(windowsAudit).not.toMatch(
      /Remove-AppxPackage|Set-ItemProperty|Disable-WindowsOptionalFeature/,
    );

    const windowsRemovalApp = byId(
      "default-windows11-remove-optional-app",
    ).script;
    expect(windowsRemovalApp).toContain("$allowed");
    expect(windowsRemovalApp).not.toContain("-AllUsers");
    expect(windowsRemovalApp).not.toContain("Remove-AppxProvisionedPackage");

    const macAudit = byId("default-macos-debloat-audit").script;
    expect(macAudit).not.toMatch(/\brm\s+-|defaults\s+write/);

    const macTrash = byId("default-macos-trash-app").script;
    expect(macTrash).toContain("/Applications/*.app");
    expect(macTrash).toContain('APP_REAL=$(CDPATH= cd -P -- "$MACOS_APP_PATH"');
    expect(macTrash).toContain('[ "$APP_PARENT" != "/Applications" ]');
    expect(macTrash).toContain('mv -- "$APP_REAL" "$DESTINATION"');
    expect(macTrash).toContain("$HOME/.Trash");
    expect(macTrash).not.toMatch(/\brm\s+-/);
  });

  it("rejects archive traversal, links, and special files before extraction", () => {
    const archive = byId("default-archive-extract").script;
    expect(archive).toContain("CONFIRM_ARCHIVE_EXTRACTION");
    expect(archive).toContain("Destination already exists");
    expect(archive).toContain("Unsafe archive path detected");
    expect(archive).toContain("stat.S_IFLNK");
    expect(archive).toContain("member.isfile() or member.isdir()");
    expect(archive).toContain("open(target, 'xb')");
    expect(archive).toContain('mkdir -m 700 "$EXTRACT_DEST"');
    expect(archive).not.toMatch(/\b(?:tar -xf|unzip .* -d|extractall)\b/);
    expect(archive.indexOf("for member in members:")).toBeLessThan(
      archive.indexOf("make_directory(destination)"),
    );
  });

  it("requires a successful Postfix queue preview before deleting mail", () => {
    const postfixReset = byId("default-postfix-queue-reset").script;
    const previewIndex = postfixReset.indexOf("postqueue -p");
    const deleteIndex = postfixReset.indexOf("postsuper -d ALL");

    expect(postfixReset).toContain("postqueue not found; refusing");
    expect(postfixReset).toContain("Queue preview failed; refusing deletion");
    expect(previewIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(previewIndex);
  });

  it("uses platform-valid media and virtualization commands", () => {
    const imageResize = byId("default-image-resize").script;
    expect(imageResize).toContain("IMAGE_SIZE_NORMALIZED");
    expect(imageResize).toContain("^[0-9]+x[0-9]+$");
    expect(imageResize).toContain("sips --resampleHeightWidth");
    expect(imageResize).not.toContain("sips --resampleHeightWidthMax");

    const audioSearch = byId("default-audio-search").script;
    expect(audioSearch).toContain("-exec ls -lh {} \\;");
    expect(audioSearch).not.toContain("ls -lhT");

    const windowsVirtualization = byId("default-virtualization-windows").script;
    expect(windowsVirtualization).toContain("ForEach-Object");
    expect(windowsVirtualization).toContain("-FeatureName $_");
    expect(windowsVirtualization).not.toMatch(
      /-FeatureName\s+Microsoft-Hyper-V-All,/,
    );
  });

  it("detects a live systemd runtime before selecting systemctl", () => {
    for (const id of [
      "default-service-discovery-posix",
      "default-service-restart-posix",
      "default-openvpn-restart",
    ]) {
      expect(byId(id).script).toContain(
        "command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]",
      );
    }
  });

  it("keeps portable fallbacks reachable and credential-bearing remotes redacted", () => {
    const diskUsage = byId("default-2").script;
    expect(diskUsage).toContain("if du -x -h -d 1");
    expect(diskUsage).not.toMatch(/tail -n 20\s*\|\|\s*du/);

    const gitAudit = byId("default-git-repository-audit").script;
    expect(gitAudit).toContain("remote -v | sed -E");
    expect(gitAudit).toContain("[redacted]");
  });

  it("keeps Cisco IOS and Arista discovery scripts read-only", () => {
    const ciscoDiscovery = defaultBulkScripts.filter(
      (script) =>
        script.category === "Cisco IOS" && !script.id.endsWith("-guarded"),
    );
    expect(ciscoDiscovery.length).toBeGreaterThanOrEqual(8);
    for (const script of ciscoDiscovery) {
      for (const command of script.script.split("\n")) {
        expect(command).toMatch(/^show\s/);
      }
    }

    // Arista read-only scripts are classified by content rather than by an id
    // suffix: they may open with `enable`, but must never reach configuration
    // mode or run an operational command that mutates live switch state.
    const aristaDiscovery = defaultBulkScripts.filter(
      (script) =>
        script.category === "Arista" && !script.id.endsWith("-guarded"),
    );
    expect(aristaDiscovery.length).toBeGreaterThanOrEqual(8);
    for (const script of aristaDiscovery) {
      for (const command of script.script.split("\n")) {
        if (command.trim() === "") continue;
        expect(command, `${script.id}: ${command}`).toMatch(
          /^(?:enable$|show\s)/,
        );
      }
      expect(
        decorateBulkScript(script),
        `${script.id} must not prompt for confirmation`,
      ).toMatchObject({ type: "arista", risk: "standard" });
    }

    // ...and the converse: every Arista script that does mutate anything is
    // flagged, so the confirmation prompt actually fires.
    const aristaGuarded = defaultBulkScripts.filter(
      (script) =>
        script.category === "Arista" && script.id.endsWith("-guarded"),
    );
    expect(aristaGuarded.length).toBeGreaterThanOrEqual(20);
    for (const script of aristaGuarded) {
      expect(decorateBulkScript(script), script.id).toMatchObject({
        type: "arista",
        risk: "destructive",
      });
    }
  });

  it("keeps HPE Comware and Aruba CX dialects explicit and separate", () => {
    const hpeScripts = defaultBulkScripts.filter(
      (script) => script.category === "HPE",
    );
    const comware = hpeScripts.filter((script) =>
      script.id.startsWith("default-hpe-comware-"),
    );
    const arubaCx = hpeScripts.filter((script) =>
      script.id.startsWith("default-hpe-aruba-cx-"),
    );

    expect(comware.length).toBeGreaterThanOrEqual(6);
    expect(arubaCx.length).toBeGreaterThanOrEqual(6);
    expect(comware.every((script) => script.name.includes("HPE Comware"))).toBe(
      true,
    );
    expect(
      arubaCx.every((script) => script.name.includes("HPE Aruba CX")),
    ).toBe(true);

    for (const script of comware.filter(
      (candidate) => !candidate.id.endsWith("-guarded"),
    )) {
      expect(script.script).toMatch(/^display\s/m);
      expect(script.script).not.toMatch(/^show\s/m);
    }
    for (const script of arubaCx.filter(
      (candidate) => !candidate.id.endsWith("-guarded"),
    )) {
      expect(script.script).toMatch(/^show\s/m);
      expect(script.script).not.toMatch(/^display\s/m);
    }

    const comwareInterfaces = byId("default-hpe-comware-interfaces").script;
    expect(comwareInterfaces).toContain("display interface brief description");
    expect(comwareInterfaces).not.toMatch(/^display interface description$/m);

    const arubaConfig = byId("default-hpe-aruba-cx-config-save-guarded").script;
    expect(arubaConfig).toContain(
      "checkpoint diff startup-config running-config",
    );
    expect(arubaConfig).not.toContain("show running-config diff");
  });

  it("ships network-device save and config actions disabled by default", () => {
    for (const id of [
      "default-cisco-ios-save-guarded",
      "default-hpe-comware-config-save-guarded",
      "default-hpe-aruba-cx-config-save-guarded",
    ]) {
      const script = byId(id).script;
      expect(script).toContain("CONFIRM_SAVE_REQUIRED");
      expect(script).not.toMatch(/^(?:copy\s+|save(?:\s|$))/m);
      expect(script).toMatch(/^[!#] (?:copy\s+|save(?:\s|$))/m);
    }

    const ciscoConfig = byId(
      "default-cisco-ios-interface-config-guarded",
    ).script;
    expect(ciscoConfig).toContain("CONFIRM_CONFIG_REQUIRED");
    expect(ciscoConfig).not.toMatch(/^configure terminal$/m);
    expect(ciscoConfig).toMatch(/^! configure terminal$/m);
  });

  it("ships the operator's Arista commands verbatim and runnable", () => {
    // Each entry: id, the exact command block the operator supplied.
    const verbatim: Array<[string, string[]]> = [
      [
        "default-arista-eos-transceiver-service-emc-guarded",
        ["service unsupported-transceiver EMC 677096c7", "wr mem"],
      ],
      [
        "default-arista-eos-transceiver-flash-enable-guarded",
        ["bash", "touch /mnt/flash/enable3px", "sudo reboot"],
      ],
      ["default-arista-eos-vlan-create-guarded", ["vlan 101", "   name VOICE"]],
      ["default-arista-eos-vlan-delete-guarded", ["no vlan 101", "show vlan"]],
      [
        "default-arista-eos-access-port-guarded",
        [
          "interface Ethernet10",
          "   description VOICE-DEVICE",
          "   switchport mode access",
          "   switchport access vlan 101",
          "   no shutdown",
          "show interfaces Ethernet10 switchport",
          "show interfaces Ethernet10 status",
        ],
      ],
      [
        "default-arista-eos-access-port-range-guarded",
        ["interface Ethernet1-24", "show vlan 101", "show interfaces status"],
      ],
      [
        "default-arista-eos-trunk-port-guarded",
        [
          "interface Ethernet52",
          "   description UPLINK",
          "   switchport mode trunk",
          "   switchport trunk native vlan 1",
          "   switchport trunk allowed vlan 1,101,303,351",
        ],
      ],
      [
        "default-arista-eos-trunk-vlan-add-guarded",
        ["   switchport trunk allowed vlan add 101"],
      ],
      [
        "default-arista-eos-trunk-vlan-remove-guarded",
        ["   switchport trunk allowed vlan remove 101"],
      ],
      [
        "default-arista-eos-port-shutdown-guarded",
        ["interface Ethernet29", "   shutdown"],
      ],
      [
        "default-arista-eos-port-range-shutdown-guarded",
        ["interface Ethernet29-48", "   shutdown", "show interfaces status"],
      ],
      [
        "default-arista-eos-port-no-shutdown-guarded",
        ["interface Ethernet29", "   no shutdown"],
      ],
      [
        "default-arista-eos-svi-static-guarded",
        ["ip routing", "interface Vlan303", "   ip address 10.15.27.1/24"],
      ],
      [
        "default-arista-eos-svi-dhcp-guarded",
        ["interface Vlan303", "   ip address dhcp"],
      ],
      [
        "default-arista-eos-default-route-guarded",
        ["ip route 0.0.0.0/0 10.15.27.254", "show ip route 0.0.0.0/0"],
      ],
      [
        "default-arista-eos-management-dhcp-guarded",
        ["interface Management1", "   ip address dhcp"],
      ],
      ["default-arista-eos-show-vlans", ["show vlan", "show vlan brief"]],
      ["default-arista-eos-show-vlan", ["show vlan 101"]],
      [
        "default-arista-eos-show-port-switchport",
        ["show interfaces Ethernet52 switchport"],
      ],
      ["default-arista-eos-show-mac-table", ["show mac address-table"]],
      [
        "default-arista-eos-show-mac-table-vlan",
        ["show mac address-table vlan 101"],
      ],
      [
        "default-arista-eos-find-mac",
        ["show mac address-table address 0011.2233.4455"],
      ],
      ["default-arista-eos-find-ip-arp", ["show arp | include 10.10.10.50"]],
      [
        "default-arista-eos-clear-mac-table-guarded",
        ["clear mac address-table dynamic", "show mac address-table"],
      ],
      [
        "default-arista-eos-clear-port-counters-guarded",
        [
          "clear counters Ethernet52/1",
          "show interfaces Ethernet52/1 counters",
          "show interfaces Ethernet52/1 phy detail",
        ],
      ],
      [
        "default-arista-eos-port-diagnostics",
        [
          "show interfaces Ethernet52/1 phy detail",
          "show interfaces Ethernet52/1 transceiver",
          "show running-config interfaces Ethernet52/1",
          "show logging | include Ethernet52",
        ],
      ],
      [
        "default-arista-eos-interface-error-counters",
        ["show interfaces counters errors"],
      ],
      [
        "default-arista-eos-port-counters",
        ["show interfaces Ethernet52/1 counters"],
      ],
      ["default-arista-eos-show-lldp-neighbors", ["show lldp neighbors"]],
      [
        "default-arista-eos-show-lldp-neighbors-detail",
        ["show lldp neighbors detail"],
      ],
      [
        "default-arista-eos-port-occupancy",
        [
          "show interfaces Ethernet10 status",
          "show lldp neighbors Ethernet10 detail",
          "show mac address-table interface Ethernet10",
        ],
      ],
      [
        "default-arista-eos-environment-temperature",
        ["show environment temperature"],
      ],
      ["default-arista-eos-environment-cooling", ["show environment cooling"]],
      ["default-arista-eos-environment-power", ["show environment power"]],
      ["default-arista-eos-environment-all", ["show environment all"]],
    ];

    for (const [id, commands] of verbatim) {
      const script = byId(id).script;
      for (const command of commands) {
        // Exact line match: their values must survive, unindented and unaltered.
        expect(
          script.split("\n"),
          `${id} must contain the exact line ${JSON.stringify(command)}`,
        ).toContain(command);
      }
      // Their real values are never replaced by a placeholder.
      expect(script, id).not.toMatch(/<[A-Z_]+>/);
    }
  });

  it("gives Arista config scripts the EOS CLI shape their context requires", () => {
    const configScripts = defaultBulkScripts.filter(
      (script) =>
        script.category === "Arista" &&
        script.script.includes("configure terminal"),
    );
    expect(configScripts.length).toBeGreaterThanOrEqual(20);

    for (const script of configScripts) {
      const body = script.script.split("\n");
      // EOS CLI context: enter enable, then config mode, close it, persist it.
      expect(body[0], script.id).toBe("enable");
      expect(body[1], script.id).toBe("configure terminal");
      // `end` closes a sub-mode. The transceiver service scripts set a global
      // config line with no sub-block, and the operator's own command sequence
      // goes straight from it to `wr mem` — shipped verbatim rather than
      // "corrected" with an `end` they did not write.
      if (body.some((line) => /^\s+\S/.test(line))) {
        expect(body, script.id).toContain("end");
      }
      expect(
        body.some((line) => line === "write memory" || line === "wr mem"),
        `${script.id} must persist its change`,
      ).toBe(true);
      // Every config change verifies itself with a trailing show.
      expect(body[body.length - 1], script.id).toMatch(/^show\s/);
      // Config mode is the EOS CLI, never the underlying bash shell.
      expect(script.script, script.id).not.toMatch(/^bash$/m);
    }
  });

  it("keeps the two transceiver methods in their own execution contexts", () => {
    const flash = byId("default-arista-eos-transceiver-flash-enable-guarded");
    // Method A leaves the EOS CLI for the underlying Linux shell and reboots.
    expect(flash.script.split("\n")).toEqual([
      "enable",
      "",
      "bash",
      "",
      "touch /mnt/flash/enable3px",
      "sudo reboot",
    ]);
    expect(flash.script).not.toContain("configure terminal");
    expect(flash.name).toContain("REBOOTS SWITCH");
    expect(flash.description).toContain("SERVICE AFFECTING");
    expect(decorateBulkScript(flash).risk).toBe("destructive");

    // Method B stays in the EOS CLI and never touches bash.
    const emc = byId("default-arista-eos-transceiver-service-emc-guarded");
    expect(emc.script).toContain(
      "service unsupported-transceiver EMC 677096c7",
    );
    expect(emc.script).not.toMatch(/^bash$/m);
    expect(emc.script).not.toContain("reboot");
    expect(decorateBulkScript(emc).risk).toBe("destructive");
    // The label/key pairing is explained rather than presented as universal.
    expect(emc.description).toContain("only with the label EMC");

    // ...and the parameterised sibling carries no concrete key.
    const custom = byId(
      "default-arista-eos-transceiver-service-custom-guarded",
    );
    expect(custom.script).toContain(
      "service unsupported-transceiver <LABEL> <KEY>",
    );
    expect(custom.script).not.toContain("677096c7");
    expect(custom.description).toContain("no universal value");
  });

  it("parameterises Arista variants completely, leaving no concrete values behind", () => {
    // id -> [placeholders it must use, literals it must not retain]
    const parameterised: Array<[string, string[], string[]]> = [
      ["default-arista-eos-show-vlan-custom", ["<VLAN_ID>"], ["101"]],
      [
        "default-arista-eos-show-port-switchport-custom",
        ["<INTERFACE>"],
        ["Ethernet52"],
      ],
      ["default-arista-eos-show-mac-table-vlan-custom", ["<VLAN_ID>"], ["101"]],
      [
        "default-arista-eos-find-mac-custom",
        ["<MAC_ADDRESS>"],
        ["0011.2233.4455"],
      ],
      [
        "default-arista-eos-find-ip-arp-custom",
        ["<IP_ADDRESS>"],
        ["10.10.10.50"],
      ],
      [
        "default-arista-eos-port-counters-custom",
        ["<INTERFACE>"],
        ["Ethernet52/1"],
      ],
      [
        "default-arista-eos-port-occupancy-custom",
        ["<INTERFACE>"],
        ["Ethernet10"],
      ],
      [
        "default-arista-eos-clear-port-counters-custom-guarded",
        ["<INTERFACE>"],
        ["Ethernet52/1"],
      ],
      [
        "default-arista-eos-vlan-create-custom-guarded",
        ["<VLAN_ID>", "<VLAN_NAME>"],
        ["101", "VOICE"],
      ],
      ["default-arista-eos-vlan-delete-custom-guarded", ["<VLAN_ID>"], ["101"]],
      [
        "default-arista-eos-access-port-custom-guarded",
        ["<INTERFACE>", "<DESCRIPTION>", "<VLAN_ID>"],
        ["Ethernet10", "VOICE-DEVICE", "101"],
      ],
      [
        "default-arista-eos-access-port-range-custom-guarded",
        ["<INTERFACE_RANGE>", "<VLAN_ID>"],
        ["Ethernet1-24", "101"],
      ],
      [
        "default-arista-eos-trunk-port-custom-guarded",
        ["<INTERFACE>", "<DESCRIPTION>", "<NATIVE_VLAN>", "<ALLOWED_VLANS>"],
        ["Ethernet52", "UPLINK", "1,101,303,351"],
      ],
      [
        "default-arista-eos-trunk-vlan-add-custom-guarded",
        ["<INTERFACE>", "<VLAN_ID>"],
        ["Ethernet52", "101"],
      ],
      [
        "default-arista-eos-trunk-vlan-remove-custom-guarded",
        ["<INTERFACE>", "<VLAN_ID>"],
        ["Ethernet52", "101"],
      ],
      [
        "default-arista-eos-port-shutdown-custom-guarded",
        ["<INTERFACE>"],
        ["Ethernet29"],
      ],
      [
        "default-arista-eos-port-range-shutdown-custom-guarded",
        ["<INTERFACE_RANGE>"],
        ["Ethernet29-48"],
      ],
      [
        "default-arista-eos-port-no-shutdown-custom-guarded",
        ["<INTERFACE>"],
        ["Ethernet29"],
      ],
      [
        "default-arista-eos-port-range-no-shutdown-custom-guarded",
        ["<INTERFACE_RANGE>"],
        ["Ethernet29-48"],
      ],
      [
        "default-arista-eos-svi-static-custom-guarded",
        ["<VLAN_ID>", "<IP_CIDR>"],
        ["303", "10.15.27.1/24"],
      ],
      ["default-arista-eos-svi-dhcp-custom-guarded", ["<VLAN_ID>"], ["303"]],
      [
        "default-arista-eos-static-route-custom-guarded",
        ["<PREFIX>", "<NEXT_HOP>"],
        ["10.15.27.254"],
      ],
    ];

    for (const [id, placeholders, literals] of parameterised) {
      const script = byId(id);
      for (const placeholder of placeholders) {
        expect(script.script, `${id} must use ${placeholder}`).toContain(
          placeholder,
        );
        // The description documents each token, since there is no variable UI.
        expect(
          script.description,
          `${id} must document ${placeholder}`,
        ).toContain(placeholder);
      }
      for (const literal of literals) {
        expect(
          script.script,
          `${id} must not retain the concrete value ${literal}`,
        ).not.toContain(literal);
      }
      expect(script.name, id).toContain("(Custom)");
    }

    // Every placeholder token used anywhere is documented in its description.
    for (const script of defaultBulkScripts.filter(
      (candidate) => candidate.category === "Arista",
    )) {
      for (const token of script.script.match(/<[A-Z_]+>/g) ?? []) {
        expect(script.description, `${script.id} / ${token}`).toContain(token);
      }
    }
  });

  it("substitutes Arista placeholders into every position, pipes included", () => {
    const substitute = (script: string, values: Record<string, string>) =>
      script.replace(/<([A-Z_]+)>/g, (match, name: string) => {
        expect(values, `unexpected placeholder ${match}`).toHaveProperty(name);
        return values[name];
      });

    // The EOS `| include` filter is interpreted by the switch CLI, not a shell.
    // Substituting after the pipe must leave the filter intact.
    const arp = substitute(
      byId("default-arista-eos-find-ip-arp-custom").script,
      {
        IP_ADDRESS: "10.10.10.50",
      },
    );
    expect(arp).toBe(byId("default-arista-eos-find-ip-arp").script);
    expect(arp).toContain("show arp | include 10.10.10.50");

    // The diagnostics bundle keeps the log filter separate from the interface:
    // syslog references the parent port, not the breakout lane.
    const diagnostics = byId(
      "default-arista-eos-port-diagnostics-custom",
    ).script;
    expect(diagnostics).toContain("show logging | include <LOG_FILTER>");
    expect(diagnostics).not.toContain("show logging | include <INTERFACE>");
    const resolved = substitute(diagnostics, {
      INTERFACE: "Ethernet52/1",
      LOG_FILTER: "Ethernet52",
    });
    expect(resolved).toBe(byId("default-arista-eos-port-diagnostics").script);
    expect(resolved).toContain("show logging | include Ethernet52");
    expect(resolved).not.toContain("show logging | include Ethernet52/1");

    // A single-token substitution reproduces the ready-to-run script exactly.
    for (const [customId, plainId, values] of [
      [
        "default-arista-eos-vlan-create-custom-guarded",
        "default-arista-eos-vlan-create-guarded",
        { VLAN_ID: "101", VLAN_NAME: "VOICE" },
      ],
      [
        "default-arista-eos-trunk-vlan-add-custom-guarded",
        "default-arista-eos-trunk-vlan-add-guarded",
        { INTERFACE: "Ethernet52", VLAN_ID: "101" },
      ],
      [
        "default-arista-eos-port-range-shutdown-custom-guarded",
        "default-arista-eos-port-range-shutdown-guarded",
        { INTERFACE_RANGE: "Ethernet29-48" },
      ],
      [
        "default-arista-eos-static-route-custom-guarded",
        "default-arista-eos-default-route-guarded",
        { PREFIX: "0.0.0.0/0", NEXT_HOP: "10.15.27.254" },
      ],
    ] as Array<[string, string, Record<string, string>]>) {
      expect(
        substitute(byId(customId).script, values),
        `${customId} must resolve to ${plainId}`,
      ).toBe(byId(plainId).script);
    }
  });

  it("classifies Arista scripts by what they actually do, not by their prefix", () => {
    // Operational `clear` commands mutate live state without configure
    // terminal; grouping them with the `show` scripts would be wrong.
    for (const id of [
      "default-arista-eos-clear-mac-table-guarded",
      "default-arista-eos-clear-port-counters-guarded",
      "default-arista-eos-clear-port-counters-custom-guarded",
    ]) {
      const script = byId(id);
      expect(script.script, id).not.toContain("configure terminal");
      expect(script.script, id).not.toContain("write memory");
      expect(decorateBulkScript(script).risk, id).toBe("destructive");
      expect(script.description, id).toContain("NOT read-only");
    }

    // The two `clear` scripts have different kinds of risk, and say so.
    expect(
      byId("default-arista-eos-clear-mac-table-guarded").description,
    ).toMatch(/self-healing/);
    expect(
      byId("default-arista-eos-clear-port-counters-guarded").description,
    ).toMatch(/zero traffic impact/);

    // The highest-consequence scripts name their consequence.
    expect(
      byId("default-arista-eos-management-dhcp-guarded").description,
    ).toContain("MOST DANGEROUS SCRIPT IN THIS LIBRARY");
    expect(byId("default-arista-eos-trunk-port-guarded").description).toContain(
      "REPLACES the allowed list",
    );
    expect(
      byId("default-arista-eos-trunk-vlan-add-guarded").description,
    ).toContain("appends");
    // Range scripts state how many ports they touch.
    expect(
      byId("default-arista-eos-port-range-shutdown-guarded").description,
    ).toContain("20 ports");
    expect(
      byId("default-arista-eos-access-port-range-guarded").description,
    ).toContain("24 live ports");
    // The global scope of `ip routing` is called out separately from the SVI.
    expect(byId("default-arista-eos-svi-static-guarded").description).toContain(
      "GLOBAL, switch-wide",
    );
  });

  it("treats reboot-class commands as destructive behind privilege, keyword, and comment prefixes", () => {
    // A shipped reboot script must never be classified like a read-only one.
    expect(isDestructiveBulkScript(byId("default-reboot-posix").script)).toBe(
      true,
    );
    for (const command of [
      "sudo reboot",
      "doas reboot",
      "sudo -n poweroff",
      "! sudo reboot",
      "# sudo halt",
      'if [ "$(id -u)" -eq 0 ]; then shutdown -r now; fi',
      "for host in a b; do reboot; done",
    ]) {
      expect(isDestructiveBulkScript(command), command).toBe(true);
    }
    // Merely naming a reboot in prose or a guard variable is not a reboot.
    for (const command of [
      "show version",
      "# no reboot is required for this change",
      'if [ "${CONFIRM_REBOOT:-}" != "REBOOT" ]; then exit 2; fi',
    ]) {
      expect(isDestructiveBulkScript(command), command).toBe(false);
    }
  });

  it("covers Android read-only audits and guarded reversible maintenance", () => {
    const androidScripts = defaultBulkScripts.filter(
      (script) => script.category === "Android",
    );
    expect(androidScripts.length).toBeGreaterThanOrEqual(10);

    for (const id of [
      "default-android-device-security",
      "default-android-properties",
      "default-android-battery-storage-memory",
      "default-android-network-dns",
      "default-android-package-inventory",
      "default-android-processes-services",
      "default-android-logs",
      "default-android-termux-update-audit",
    ]) {
      expect(byId(id).script).not.toMatch(
        /pm disable-user|pm trim-caches|pkg update|apt-get update|\brm\s+-/,
      );
    }

    const debloat = byId("default-android-debloat-guarded").script;
    expect(debloat).toContain("Refusing protected core package");
    expect(debloat).toContain(
      '"${CONFIRM_ANDROID_DISABLE:-}" != "$ANDROID_PACKAGE"',
    );
    expect(debloat).toContain("Root or Android shell UID 2000 is required");
    expect(debloat).toContain("CONFIRM_ANDROID_SYSTEM_PACKAGE");
    expect(debloat).toContain("com.android.providers.settings");
    expect(debloat).toContain("com.android.phone");
    expect(debloat).toContain("pm disable-user --user 0");
    expect(debloat).toContain("pm enable --user 0");

    const cacheTrim = byId("default-android-cache-trim-guarded").script;
    expect(cacheTrim).toContain("ANDROID_CACHE_TARGET");
    expect(cacheTrim).toContain("^[0-9]+[KMGkmg]?$");
    expect(cacheTrim).toContain("Root or Android shell UID 2000 is required");
    expect(cacheTrim).not.toMatch(/\brm\s+-/);
  });

  it.each([
    "PASSWORD=hunter2-fixture",
    '$env:ApiKey = "fixture-api-key"',
    "curl --token fixture-command-token",
    "Authorization: Bearer fixtureBearerToken123",
    "https://fixture-user:fixture-password@example.invalid/repository",
    "-----BEGIN PRIVATE KEY-----",
  ])("detects representative embedded credential form %#", (fixture) => {
    expect(containsEmbeddedCredential(fixture)).toBe(true);
  });

  it("does not embed credentials in any individual default script", () => {
    for (const script of defaultBulkScripts) {
      expect(
        containsEmbeddedCredential(script.script),
        `embedded credential pattern in ${script.id}`,
      ).toBe(false);
    }
  });
});
