import { AppWindowMac, Hammer, SquareCode } from "lucide-react";

import { cpanel, grafana, nginx, traefikproxy } from "../brand";
import { defineIcon } from "./types";

/**
 * Web and application icons. Seeded with generic Lucide entries so the category
 * is never empty; brand marks (Apache, nginx, Grafana, GitLab, ...) are appended
 * by later work without touching the entries below.
 */
export const WEB_APPLICATION_ICONS = [
  defineIcon("web-server", "Web server", "web-applications", AppWindowMac, [
    "web server",
    "http",
    "https",
    "website",
    "vhost",
  ]),
  defineIcon("build-server", "Build server", "web-applications", Hammer, [
    "build server",
    "ci",
    "jenkins",
    "pipeline",
    "compile",
  ]),
  defineIcon("code-server", "Code server", "web-applications", SquareCode, [
    "code server",
    "vscode",
    "ide",
    "editor",
    "development",
  ]),
  defineIcon("nginx", "NGINX", "web-applications", nginx, [
    "nginx",
    "web server",
    "reverse proxy",
  ]),
  defineIcon(
    "traefikproxy",
    "Traefik Proxy",
    "web-applications",
    traefikproxy,
    ["traefik", "reverse proxy", "router"],
  ),
  defineIcon("grafana", "Grafana", "web-applications", grafana, [
    "grafana",
    "monitoring",
    "dashboards",
    "observability",
  ]),
  defineIcon("cpanel", "cPanel", "web-applications", cpanel, [
    "cpanel",
    "whm",
    "hosting",
    "control panel",
  ]),
] as const;
