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
 * verified against publisher assets in `handAuthoredBrandIcons.ts` instead, or
 * represented by an explicitly described generic catalog glyph.
 *
 * Grouping mirrors the connection-icon catalog categories that consume each mark;
 * a slug appears once even when several catalog entries reuse it (for example
 * `synology` serves both the brand and NAS entries).
 */
export const BRAND_ICON_SLUGS = [
  // Pure language marks for script libraries (not execution capabilities).
  "gnubash",
  "javascript",
  "python",
  "perl",
  // Operating systems
  "alpinelinux",
  "almalinux",
  "android",
  "apple",
  "centos",
  "debian",
  "dotnet",
  "freebsd",
  "fedora",
  "linux",
  "macos",
  "opensuse",
  "redhat",
  "rockylinux",
  "ubuntu",

  // Virtualization, containers and cloud
  "alibabacloud",
  "cloudflare",
  "digitalocean",
  "googlecloud",
  "hetzner",
  "kubernetes",
  "ovh",
  "portainer",
  "proxmox",
  "qemu",
  "vmware",

  // Vendors and hardware
  "acer",
  "arduino",
  "asus",
  "cisco",
  "dell",
  "epson",
  "espressif",
  "fujitsu",
  "hp",
  "huawei",
  "kyocera",
  "junipernetworks",
  "lenovo",
  "lg",
  "mikrotik",
  "msi",
  "netapp",
  "qnap",
  "razer",
  "raspberrypi",
  "samsung",
  "schneiderelectric",
  "shelly",
  "supermicro",
  "synology",
  "tplink",
  "toshiba",
  "ubiquiti",

  // Web and applications
  "apache",
  "bitwarden",
  "buildkite",
  "circleci",
  "cpanel",
  "drone",
  "elasticsearch",
  "envoyproxy",
  "esphome",
  "git",
  "github",
  "githubactions",
  "gitlab",
  "google",
  "grafana",
  "homeassistant",
  "jenkins",
  "joomla",
  "letsencrypt",
  "nextcloud",
  "nginx",
  "phpmyadmin",
  "splunk",
  "tasmota",
  "teamcity",
  "traefikproxy",
  "travisci",
  "wordpress",

  // Databases
  "apachecassandra",
  "apachecouchdb",
  "clickhouse",
  "cockroachlabs",
  "influxdb",
  "mariadb",
  "mongodb",
  "mysql",
  "neo4j",
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
  "tailscale",
  "wireguard",
  "zerotier",

  // Security
  "fortinet",
  "opnsense",
  "pfsense",
  "snort",

  // Remote protocols
  "anydesk",
  "citrix",
  "filezilla",
  "rustdesk",
  "teamviewer",

  // Business, collaboration, automation and server tools
  "graphql",
  "hubspot",
  "zoho",
  "odoo",
  "metabase",
  "apachesuperset",
  "redash",
  "matomo",
  "plausibleanalytics",
  "sap",
  "erpnext",
  "dolibarr",
  "docker",
  "truenas",
  "mattermost",
  "matrix",
  "zulip",
  "element",
  "payloadcms",
  "drupal",
  "ghost",
  "strapi",
  "directus",
  "ansible",
  "n8n",
  "nodered",
  "rundeck",
  "puppet",
  "gitea",
  "minio",
  "caddy",
  "rocketdotchat",
  "budibase",
  "googledrive",
  "jira",
  "nginxproxymanager",
  "php",
  "prometheus",
  "apachetomcat",
  "nodedotjs",
  "porkbun",
  "namecheap",
  "godaddy",
  "gandi",
  "ionos",
  "intel",

  // Telecom providers
  "deutschetelekom",
  "orange",
  "o2",
  "atandt",
  "movistar",
  "scaleway",
  // Hosting platforms and domain registrars
  "hostinger",
  "netcup",
  "upcloud",
  "wpengine",
  "namesilo",
  "wix",
  "spaceship",
  "contabo",
  "vultr",
  "exoscale",
  // Developer integration protocol
  "modelcontextprotocol",
  // Messaging and voice communities (pure platform marks)
  "discord",
  "telegram",
  "whatsapp",
  "signal",
  "messenger",
  "googlechat",
  "googlemessages",
  "line",
  "viber",
  "wechat",
  "qq",
  "kakaotalk",
  "snapchat",
  "imessage",
  "xmpp",
  "simplex",
  "session",
  "threema",
  "mumble",
  "teamspeak",
  "zoom",
  "webex",
  "wire",
  "gitter",
  // Hosted account / dashboard marks (not authentication capabilities).
  "claude",
  "openrouter",
  "facebook",
  "instagram",
  "gmail",
  "googleanalytics",
  "googleads",
  "googlesearchconsole",
  "youtube",
  "icloud",
  "mcdonalds",
] as const;

/** A slug known to be vendored into `generatedBrandIcons.ts`. */
export type BrandIconSlug = (typeof BRAND_ICON_SLUGS)[number];
