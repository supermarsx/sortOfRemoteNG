import {
  Cable,
  Globe,
  Link,
  Network,
  Radio,
  RadioTower,
  Route,
  Router,
  Share2,
  Waypoints,
  Wifi,
} from "lucide-react";

import { defineIcon } from "./types";

export const NETWORK_ICONS = [
  defineIcon("globe", "Web", "network", Globe, ["http", "https", "internet"]),
  defineIcon("network", "Network", "network", Network, [
    "lan",
    "topology",
    "netbox",
  ]),
  defineIcon("router", "Router", "network", Router, [
    "gateway",
    "appliance",
    "draytek",
  ]),
  defineIcon("wifi", "Wireless", "network", Wifi, ["wifi", "wlan"]),
  defineIcon("cable", "Wired connection", "network", Cable, [
    "ethernet",
    "wired",
    "serial",
    "rs-232",
    "com port",
    "tty",
    "console cable",
  ]),
  defineIcon("waypoints", "Route", "network", Waypoints, [
    "proxy",
    "traefik",
    "path",
  ]),
  defineIcon("radio-tower", "Radio tower", "network", RadioTower, [
    "wireless",
    "signal",
  ]),
  defineIcon("route", "Network route", "network", Route, ["routing", "path"]),
  defineIcon("link", "Link", "network", Link, ["connection", "chain"]),
  defineIcon("share", "Shared network", "network", Share2, ["share", "smb"]),
  defineIcon("radio", "Radio", "network", Radio, ["wol", "signal"]),
] as const;
