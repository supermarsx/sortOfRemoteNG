import { GlobeLock } from "lucide-react";

import {
  cloudflare,
  gandi,
  godaddy,
  ionos,
  namecheap,
  porkbun,
} from "../brand";
import { TELECOM_ICONS } from "./telecom";
import { defineIcon } from "./types";

/** Internet, telecom, domain and DNS providers; cloud platforms stay in Cloud. */
export const ISP_PROVIDER_ICONS = [
  ...TELECOM_ICONS,
  defineIcon("porkbun", "Porkbun", "isp-providers", porkbun, [
    "porkbun",
    "pork bun",
    "domain registrar",
    "dns",
  ]),
  defineIcon("namecheap", "Namecheap", "isp-providers", namecheap, [
    "namecheap",
    "name cheap",
    "domain registrar",
    "dns",
  ]),
  defineIcon("godaddy", "GoDaddy", "isp-providers", godaddy, [
    "godaddy",
    "go daddy",
    "domain registrar",
    "dns",
  ]),
  defineIcon("gandi", "Gandi", "isp-providers", gandi, [
    "gandi",
    "domain registrar",
    "dns",
  ]),
  defineIcon("ionos", "IONOS", "isp-providers", ionos, [
    "ionos",
    "1and1",
    "1 1",
    "domain registrar",
    "dns",
  ]),
  defineIcon("cloudflare", "Cloudflare", "isp-providers", cloudflare, [
    "cloudflare",
    "cloud flare",
    "domain registrar",
    "dns",
    "cdn",
  ]),
  defineIcon("noip", "Dynamic DNS", "isp-providers", GlobeLock, [
    "noip",
    "no-ip",
    "dynamic dns",
    "ddns",
    "hostname",
  ]),
] as const;
