import type { Connection } from "../../types/connection/connection";
import { getHttpApplicationProfile } from "../connection/httpApplicationProfiles";

const unknown = "Not reported";
const routeKinds = [
  "proxy",
  "ssh-tunnel",
  "local-forward",
  "ssh-jump",
  "ssh-proxycmd",
  "ssh-stdio",
  "openvpn",
  "wireguard",
  "pptp",
  "l2tp",
  "ikev2",
  "ipsec",
  "sstp",
  "softether",
  "shadowsocks",
  "tor",
  "i2p",
  "stunnel",
  "chisel",
  "ngrok",
  "cloudflared",
  "tailscale",
  "zerotier",
];
const proxyKinds = [
  "http",
  "https",
  "socks4",
  "socks5",
  "ssh",
  "dns-tunnel",
  "icmp-tunnel",
  "websocket",
  "quic",
  "tcp-over-dns",
  "http-connect",
  "shadowsocks",
];
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const fixed = (value: unknown, choices: readonly string[]) =>
  typeof value === "string" && choices.includes(value) ? value : "Unknown";

/** Saved configuration categories only. Never resolve profiles, read credentials,
 * disclose identifiers/addresses or claim that a configured route executed. */
export function browserConnectionDiagnosticFacts(
  connection?: Partial<Connection>,
): [string, string][] {
  if (!connection)
    return [
      ["Saved connection type", unknown],
      ["Browser application", unknown],
      ["Configured route kinds", unknown],
      ["Route execution", "Not confirmed; saved configuration only"],
    ];
  const source = object(connection);
  const protocol = fixed(source.protocol, [
    "http",
    "https",
    "synology",
    "ssh",
    "rdp",
    "vnc",
  ]);
  const app = object(source.httpApplication);
  const profile =
    app.invalid !== true && typeof app.id === "string"
      ? getHttpApplicationProfile(app.id)
      : undefined;
  const security = object(source.security);
  const kinds = new Set<string>();
  const proxies = new Set<string>();
  const forwarding = new Set<string>();
  const references: string[] = [];
  const sshSourceReference = (value: unknown) => {
    const id = object(value).connectionId;
    if (
      typeof id === "string" &&
      id !== "" &&
      !references.includes("Saved SSH connection")
    )
      references.push("Saved SSH connection");
  };
  for (const [key, label] of [
    ["proxyProfileId", "Saved proxy profile"],
    ["tunnelProfileId", "Saved tunnel profile"],
    ["proxyChainId", "Saved proxy chain"],
    ["tunnelChainId", "Saved tunnel chain"],
    ["connectionChainId", "Saved connection chain"],
  ] as const)
    if (source[key] !== undefined && source[key] !== null && source[key] !== "")
      references.push(label);
  const proxy = object(security.proxy);
  if (proxy.enabled === true) {
    kinds.add("proxy");
    proxies.add(fixed(proxy.type, proxyKinds));
  }
  if (object(security.openvpn).enabled === true) kinds.add("openvpn");
  if (object(security.sshTunnel).enabled === true) {
    kinds.add("ssh-tunnel");
    forwarding.add("local (legacy)");
    sshSourceReference(security.sshTunnel);
  }
  const layers = Array.isArray(security.tunnelChain)
    ? security.tunnelChain
    : [];
  for (const raw of layers.slice(0, 64)) {
    const layer = object(raw);
    if (layer.enabled !== true) continue;
    const kind = fixed(layer.type, routeKinds);
    kinds.add(kind);
    if (
      layer.tunnelProfileId !== undefined &&
      layer.tunnelProfileId !== "" &&
      !references.includes("Saved layer tunnel profile")
    )
      references.push("Saved layer tunnel profile");
    if (kind === "proxy" || kind === "shadowsocks")
      proxies.add(fixed(object(layer.proxy).proxyType, proxyKinds));
    if (
      [
        "ssh-tunnel",
        "local-forward",
        "ssh-jump",
        "ssh-proxycmd",
        "ssh-stdio",
      ].includes(kind)
    ) {
      sshSourceReference(layer.sshTunnel);
      forwarding.add(
        fixed(object(layer.sshTunnel).forwardType, [
          "local",
          "remote",
          "dynamic",
        ]),
      );
    }
  }
  if (layers.length > 64) kinds.add("Additional layers omitted");
  return [
    [
      "Saved connection type",
      protocol === "http" || protocol === "https"
        ? protocol.toUpperCase()
        : protocol,
    ],
    ["Browser application", profile?.label ?? "Custom/unknown"],
    ["Saved route references", references.join(", ") || "None"],
    [
      "Configured route kinds",
      [...kinds].join(", ") ||
        (references.length
          ? "Saved reference; not expanded"
          : "No additional route configured"),
    ],
    ["Configured proxy types", [...proxies].join(", ") || "None reported"],
    ["SSH forwarding modes", [...forwarding].join(", ") || "None reported"],
    ["Route execution", "Not confirmed; saved configuration only"],
  ];
}
