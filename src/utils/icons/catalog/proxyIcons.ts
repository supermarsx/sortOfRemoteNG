import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

const SocksProxy = createLucideIcon("SocksProxy", [
  [
    "rect",
    { x: "8", y: "3", width: "8", height: "18", rx: "3", key: "socket-relay" },
  ],
  [
    "path",
    {
      d: "M2 8h11m-3-3 3 3-3 3M22 16H11m3-3-3 3 3 3",
      key: "bidirectional-stream",
    },
  ],
]);
const HttpProxy = createLucideIcon("HttpProxy", [
  [
    "rect",
    { x: "5", y: "3", width: "14", height: "18", rx: "2", key: "web-relay" },
  ],
  ["path", { d: "M5 8h14M8 5.5h.01M11 5.5h.01", key: "browser-header" }],
  [
    "path",
    { d: "M1 14h8m-2-2 2 2-2 2M15 14h8m-2-2 2 2-2 2", key: "forward-request" },
  ],
]);
const ProxyChain = createLucideIcon("ProxyChain", [
  [
    "rect",
    { x: "2", y: "2", width: "6", height: "5", rx: "1", key: "first-hop" },
  ],
  [
    "rect",
    { x: "9", y: "9", width: "6", height: "5", rx: "1", key: "second-hop" },
  ],
  [
    "rect",
    { x: "16", y: "16", width: "6", height: "5", rx: "1", key: "third-hop" },
  ],
  [
    "path",
    {
      d: "M5 7v3.5a1 1 0 0 0 1 1h3M12 14v3.5a1 1 0 0 0 1 1h3",
      key: "linked-route",
    },
  ],
]);

/** Pure generic protocol/route symbols, not server frames or vendor marks. */
export const PROXY_ICONS = [
  defineIcon(
    "socks-proxy",
    "SOCKS proxy",
    "network",
    SocksProxy,
    [
      "socks",
      "socks proxy",
      "socks4",
      "socks 4",
      "socks4a",
      "socks5",
      "socks 5",
      "socket proxy",
    ],
    "Generic app-authored SOCKS socket relay with bidirectional traffic; not a vendor logo.",
  ),
  defineIcon(
    "http-proxy",
    "HTTP proxy",
    "network",
    HttpProxy,
    [
      "http proxy",
      "https proxy",
      "web proxy",
      "http connect",
      "forward proxy",
      "http relay",
    ],
    "Generic app-authored web request relay. The icon does not assert TLS support or configure a proxy.",
  ),
  defineIcon(
    "proxy-chain",
    "Chained proxy",
    "network",
    ProxyChain,
    [
      "chained proxy",
      "proxy chain",
      "proxychain",
      "proxychains",
      "multi hop",
      "multi-hop",
      "chain",
      "linked proxy hops",
    ],
    "Generic app-authored route through three linked proxy hops; no proxy configuration is changed.",
  ),
] as const;
