/**
 * Source of truth for the simple-icons marks vendored into this repository.
 *
 * `simple-icons` is a **devDependency only** and is never imported at runtime.
 * `scripts/sync-brand-icons.mjs` reads this list, extracts each mark's single SVG
 * path from `node_modules/simple-icons/icons/<slug>.svg`, and writes
 * `generatedBrandIcons.ts`. Shipping the extracted paths as ordinary first-party
 * source keeps the bundler out of the picture entirely: nothing can silently pull
 * in the 5 MB simple-icons barrel, and the vendored paths are also *smaller* than
 * the tree-shaken package because they drop the title/slug/source/hex metadata.
 *
 * Every slug below is verified to exist and to be a **single-path** icon. The
 * generator fails loudly when a slug is absent from the installed simple-icons,
 * so an upstream removal — which is exactly how the Microsoft, Amazon and Oracle
 * families disappeared — surfaces as a red build instead of a missing icon.
 *
 * To add a mark: append its slug here, run `npm run icons:brand:generate`, and
 * commit the regenerated module. Marks that simple-icons does not carry are
 * hand-authored in `handAuthoredBrandIcons.ts` instead.
 *
 * Grouping mirrors the connection-icon catalog categories that consume each mark;
 * a slug appears once even when several catalog entries reuse it (for example
 * `hp` serves the HP server, switch, iLO and printer entries).
 */
export const BRAND_ICON_SLUGS = [
  // Operating systems
  "alpinelinux",
  "android",
  "apple",
  "centos",
  "dotnet",
  "freebsd",
  "linux",
  "macos",
  "ubuntu",

  // Virtualization, containers and cloud
  "cloudflare",
  "googlecloud",
  "kubernetes",
  "portainer",
  "proxmox",
  "vmware",

  // Vendors and hardware
  "asus",
  "cisco",
  "dell",
  "hp",
  "kyocera",
  "mikrotik",
  "supermicro",
  "synology",
  "tplink",

  // Web and applications
  "apache",
  "bitwarden",
  "cpanel",
  "drone",
  "elasticsearch",
  "gitlab",
  "grafana",
  "letsencrypt",
  "nextcloud",
  "nginx",
  "phpmyadmin",
  "splunk",
  "traefikproxy",

  // Databases
  "mariadb",
  "mongodb",
  "mysql",
  "postgresql",
  "redis",
  "sqlite",

  // Voice and telephony
  "asterisk",
  "vodafone",

  // Communication
  "dovecot",

  // Network
  "openvpn",

  // Security
  "opnsense",
  "pfsense",

  // Remote protocols
  "anydesk",
  "citrix",
  "filezilla",
  "rustdesk",
  "teamviewer",
] as const;

/** A slug known to be vendored into `generatedBrandIcons.ts`. */
export type BrandIconSlug = (typeof BRAND_ICON_SLUGS)[number];
