import { Loader2, Stethoscope, MapPin, GitBranch, Radio, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticResults } from "../../../types/diagnostics";

const ExtendedDiagnosticsCards = ({
  results,
  isRunning,
}: {
  results: DiagnosticResults;
  isRunning: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-3 text-xs text-[var(--color-textSecondary)] uppercase font-medium">
        <Stethoscope size={14} />
        {t("diagnostics.extendedDiagnostics", "Extended Diagnostics")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* IP Geolocation */}
        <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
            {t("diagnostics.ipGeo", "IP Geolocation")}
          </div>
          {results.ipGeoInfo ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <MapPin size={12} className="text-[var(--color-accent)]" />
                <span className="text-xs font-medium text-[var(--color-text)]">
                  {results.ipGeoInfo.city ||
                    results.ipGeoInfo.country ||
                    "Unknown"}
                  {results.ipGeoInfo.country_code &&
                    ` (${results.ipGeoInfo.country_code})`}
                </span>
              </div>
              {results.ipGeoInfo.asn && (
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  AS{results.ipGeoInfo.asn}{" "}
                  {results.ipGeoInfo.asn_org &&
                    `- ${results.ipGeoInfo.asn_org}`}
                </div>
              )}
              {results.ipGeoInfo.isp && (
                <div
                  className="text-[10px] text-[var(--color-textMuted)] truncate"
                  title={results.ipGeoInfo.isp}
                >
                  ISP: {results.ipGeoInfo.isp}
                </div>
              )}
              {results.ipGeoInfo.is_datacenter && (
                <div className="text-[10px] text-yellow-500">
                  ⚠ {t("diagnostics.datacenterIp", "Datacenter IP")}
                </div>
              )}
            </div>
          ) : isRunning ? (
            <Loader2
              size={14}
              className="text-[var(--color-textMuted)] animate-spin"
            />
          ) : (
            <span className="text-xs text-[var(--color-textMuted)]">-</span>
          )}
        </div>

        {/* Asymmetric Routing */}
        <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
            {t("diagnostics.asymmetricRouting", "Routing Analysis")}
          </div>
          {results.asymmetricRouting ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <GitBranch
                  size={12}
                  className={
                    results.asymmetricRouting.asymmetry_detected
                      ? "text-yellow-500"
                      : "text-green-500"
                  }
                />
                <span
                  className={`text-xs font-medium ${
                    results.asymmetricRouting.asymmetry_detected
                      ? "text-yellow-500"
                      : "text-green-500"
                  }`}
                >
                  {results.asymmetricRouting.asymmetry_detected
                    ? t(
                        "diagnostics.asymmetryDetected",
                        "Asymmetry Detected",
                      )
                    : t("diagnostics.symmetricPath", "Symmetric Path")}
                </span>
              </div>
              <div className="text-[10px] text-[var(--color-textSecondary)]">
                {t("diagnostics.confidence", "Confidence")}:{" "}
                {results.asymmetricRouting.confidence}
              </div>
              <div className="text-[10px] text-[var(--color-textMuted)]">
                {t("diagnostics.pathStability", "Stability")}:{" "}
                {results.asymmetricRouting.path_stability}
                {results.asymmetricRouting.latency_variance !== undefined &&
                  ` (±${results.asymmetricRouting.latency_variance.toFixed(1)}ms)`}
              </div>
              {results.asymmetricRouting.ttl_analysis.received_ttl && (
                <div className="text-[10px] text-[var(--color-textMuted)]">
                  TTL:{" "}
                  {results.asymmetricRouting.ttl_analysis.received_ttl}
                  {results.asymmetricRouting.ttl_analysis.estimated_hops &&
                    ` (~${results.asymmetricRouting.ttl_analysis.estimated_hops} hops)`}
                </div>
              )}
            </div>
          ) : isRunning ? (
            <Loader2
              size={14}
              className="text-[var(--color-textMuted)] animate-spin"
            />
          ) : (
            <span className="text-xs text-[var(--color-textMuted)]">-</span>
          )}
        </div>

        {/* UDP Probe */}
        {results.udpProbe && (
          <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
              {t("diagnostics.udpProbe", "UDP Probe")}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Radio
                  size={12}
                  className={
                    results.udpProbe.response_received
                      ? "text-green-500"
                      : "text-yellow-500"
                  }
                />
                <span
                  className={`text-xs font-medium ${
                    results.udpProbe.response_received
                      ? "text-green-500"
                      : "text-yellow-500"
                  }`}
                >
                  {results.udpProbe.response_received
                    ? t(
                        "diagnostics.responseReceived",
                        "Response Received",
                      )
                    : results.udpProbe.response_type === "icmp_unreachable"
                      ? t("diagnostics.portClosed", "Port Closed")
                      : t(
                          "diagnostics.noResponse",
                          "No Response (Filtered?)",
                        )}
                </span>
              </div>
              <div className="text-[10px] text-[var(--color-textSecondary)]">
                Port: {results.udpProbe.port}
              </div>
              {results.udpProbe.latency_ms && (
                <div className="text-[10px] text-[var(--color-textMuted)]">
                  Latency: {results.udpProbe.latency_ms}ms
                </div>
              )}
              {results.udpProbe.response_data && (
                <code className="text-[9px] font-mono text-[var(--color-textMuted)] block truncate bg-[var(--color-surfaceHover)] px-1 py-0.5 rounded">
                  {results.udpProbe.response_data.substring(0, 32)}...
                </code>
              )}
            </div>
          </div>
        )}

        {/* Leakage Detection */}
        {results.leakageDetection && (
          <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
              {t("diagnostics.leakageDetection", "Proxy/VPN Leak Check")}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Shield
                  size={12}
                  className={
                    results.leakageDetection.overall_status === "secure"
                      ? "text-green-500"
                      : results.leakageDetection.overall_status ===
                          "leak_detected"
                        ? "text-red-500"
                        : "text-yellow-500"
                  }
                />
                <span
                  className={`text-xs font-medium ${
                    results.leakageDetection.overall_status === "secure"
                      ? "text-green-500"
                      : results.leakageDetection.overall_status ===
                          "leak_detected"
                        ? "text-red-500"
                        : "text-yellow-500"
                  }`}
                >
                  {results.leakageDetection.overall_status === "secure"
                    ? t("diagnostics.noLeaks", "No Leaks Detected")
                    : results.leakageDetection.overall_status ===
                        "leak_detected"
                      ? t("diagnostics.leakDetected", "Leak Detected!")
                      : t("diagnostics.potentialLeak", "Potential Leak")}
                </span>
              </div>
              {results.leakageDetection.detected_public_ip && (
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  Public IP: {results.leakageDetection.detected_public_ip}
                </div>
              )}
              {results.leakageDetection.dns_leak_detected && (
                <div className="text-[10px] text-red-500">
                  ⚠ {t("diagnostics.dnsLeak", "DNS Leak Detected")}
                </div>
              )}
              {results.leakageDetection.ip_mismatch_detected && (
                <div className="text-[10px] text-red-500">
                  ⚠ {t("diagnostics.ipMismatch", "IP Mismatch")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExtendedDiagnosticsCards;
