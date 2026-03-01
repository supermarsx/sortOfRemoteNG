import ExtendedDiagnosticsCards from "./ExtendedDiagnosticsCards";
import IcmpStatusCard from "./IcmpStatusCard";
import MtuCheckCard from "./MtuCheckCard";
import ServiceFingerprintCard from "./ServiceFingerprintCard";
import TcpTimingCard from "./TcpTimingCard";
import TlsCheckCard from "./TlsCheckCard";
import { Stethoscope } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticsMgr } from "../../../hooks/connection/useConnectionDiagnostics";

const AdvancedDiagnosticsSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Stethoscope size={12} />
        {t("diagnostics.advancedDiagnostics", "Advanced Diagnostics")}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <TcpTimingCard results={results} isRunning={isRunning} />
        <IcmpStatusCard results={results} isRunning={isRunning} />
        <ServiceFingerprintCard results={results} isRunning={isRunning} />
        <MtuCheckCard results={results} isRunning={isRunning} />
      </div>

      {/* TLS Check */}
      {results.tlsCheck && <TlsCheckCard results={results} />}

      {/* Extended Diagnostics */}
      <ExtendedDiagnosticsCards results={results} isRunning={isRunning} />
    </div>
  );
};

export default AdvancedDiagnosticsSection;
