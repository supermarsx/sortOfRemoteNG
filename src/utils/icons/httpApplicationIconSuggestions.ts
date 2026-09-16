import type { Connection } from "../../types/connection/connection";
import { HOSTED_DASHBOARD_ICON_SUGGESTIONS } from "./hostedDashboardIconSuggestions";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../connection/httpApplicationProfiles";
import {
  getConnectionIconDefinition,
  type ConnectionIconDefinition,
  type ConnectionIconKey,
} from "./connectionIconCatalog";

/** Suggestions only: neither application selection nor automatic icon resolution
 * reads this table to overwrite a saved choice. Keys refer to existing, unframed
 * catalog marks (including honestly described app-authored identifiers).
 * LXD / Incus is a combined profile, so it uses a neutral cluster symbol. */
export const HTTP_APPLICATION_ICON_SUGGESTIONS = Object.freeze({
  ...HOSTED_DASHBOARD_ICON_SUGGESTIONS,
  custom: "web-application",
  "generic-form": "web-application",
  "http-basic": "web-application",
  "http-digest": "web-application",
  "bitwarden-self-hosted": "bitwarden",
  vaultwarden: "web-application",
  matomo: "matomo",
  plausible: "plausible",
  odoo: "odoo",
  ghost: "ghost",
  strapi: "strapi",
  phpmyadmin: "phpmyadmin",
  nextcloud: "nextcloud",
  portainer: "portainer",
  nginxProxyMgr: "nginx-proxy-manager",
  proxmox: "proxmox",
  pfsense: "pfsense",
  cloudflare: "cloudflare",
  tacticalrmm: "web-application",
  meshcentral: "meshcentral",
  guacamole: "web-application",
  github: "github",
  gitea: "gitea",
  "drone-ci": "drone-ci",
  "exchange-ecp": "exchange",
  brevo: "web-application",
  rdweb: "microsoft",
  wordpress: "wordpress",
  joomla: "joomla",
  drupal: "drupal",
  "payload-cms": "payload-cms",
  "synology-dsm": "synology",
  ilo: "hpe",
  idrac: "dell",
  lenovo: "lenovo",
  supermicro: "supermicro",
  "voip-phone": "yealink",
  netbox: "netbox",
  vmware: "vmware",
  cpanel: "cpanel",
  webmin: "webmin",
  draytek: "draytek",
  grafana: "grafana",
  budibase: "budibase",
  jira: "jira",
  osticket: "osticket",
  mailcow: "mailcow",
  haproxy: "haproxy",
  traefik: "traefikproxy",
  prometheus: "prometheus",
  lxd: "boxes",
  exchange: "exchange",
  gdrive: "google-drive",
} satisfies Readonly<Record<string, ConnectionIconKey>>);

export interface HttpApplicationIconSuggestion {
  applicationId: string;
  applicationLabel: string;
  icon: ConnectionIconDefinition<ConnectionIconKey>;
}

export function getHttpApplicationIconSuggestion(
  connection: Partial<Connection>,
): HttpApplicationIconSuggestion | undefined {
  if (
    connection.isGroup ||
    (connection.protocol !== "http" && connection.protocol !== "https")
  )
    return undefined;
  const settings = normalizeHttpApplicationSettings(connection.httpApplication);
  if (!settings || settings.invalid) return undefined;
  const profile = getHttpApplicationProfile(settings.id);
  if (!profile || profile.capability === "none") return undefined;
  const key = Object.prototype.hasOwnProperty.call(
    HTTP_APPLICATION_ICON_SUGGESTIONS,
    settings.id,
  )
    ? HTTP_APPLICATION_ICON_SUGGESTIONS[
        settings.id as keyof typeof HTTP_APPLICATION_ICON_SUGGESTIONS
      ]
    : "web-application";
  const icon = getConnectionIconDefinition(key);
  return icon
    ? { applicationId: settings.id, applicationLabel: profile.label, icon }
    : undefined;
}
