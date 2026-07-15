import { Route } from "lucide-react";
import {
  getRawSocketRouteCapability,
  type RawSocketNetworkRouteKind,
  type RawSocketTransport,
} from "../../../types/protocols/rawSocket";
import { RawSocketSection } from "./RawSocketSection";

const ROUTE_LABELS: Record<RawSocketNetworkRouteKind, string> = {
  direct: "Direct",
  http_connect: "HTTP CONNECT proxy",
  socks4: "SOCKS4 proxy",
  socks5: "SOCKS5 proxy",
  ssh_jump: "SSH jump host",
  unknown: "Unknown route layer",
};

export function NetworkPathSummarySection({
  transport,
  routes,
}: {
  transport: RawSocketTransport;
  routes: readonly RawSocketNetworkRouteKind[];
}) {
  const effectiveRoutes = routes.length > 0 ? routes : (["direct"] as const);
  return (
    <RawSocketSection
      id="network-path"
      title="Network Path"
      description="Read-only capability summary; shared Network Path controls own the saved VPN, proxy, and jump-host chain."
      icon={Route}
    >
      <div id="raw-socket-network-path" tabIndex={-1} className="space-y-2">
        {effectiveRoutes.map((route, index) => {
          const capability = getRawSocketRouteCapability(transport, route);
          return (
            <div
              key={`${route}-${index}`}
              role="status"
              className={`rounded-md border p-3 text-xs leading-relaxed ${
                capability.runtimeSupported
                  ? "border-primary/30 bg-primary/10 text-[var(--color-textSecondary)]"
                  : "border-warning/40 bg-warning/10 text-warning"
              }`}
            >
              <strong>{ROUTE_LABELS[route]}:</strong> {capability.message}
            </div>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-[var(--color-textMuted)]">
        Unsupported paths fail closed. The Raw client never ignores a configured
        route and falls back to an unproxied direct connection.
      </p>
    </RawSocketSection>
  );
}
