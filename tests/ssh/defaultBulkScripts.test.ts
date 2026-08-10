import { describe, expect, it } from "vitest";
import { defaultBulkScripts } from "../../src/data/defaultBulkScripts";
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
    expect(defaultBulkScripts).toHaveLength(91);

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
    for (const category of ["Cisco IOS", "Arista"]) {
      const discoveryScripts = defaultBulkScripts.filter(
        (script) =>
          script.category === category && !script.id.endsWith("-guarded"),
      );
      expect(discoveryScripts.length).toBeGreaterThanOrEqual(8);
      for (const script of discoveryScripts) {
        for (const command of script.script.split("\n")) {
          expect(command).toMatch(/^show\s/);
        }
      }
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
      "default-arista-eos-save-guarded",
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
