import { CheckCircle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticResults } from "../../../types/diagnostics";

const TlsCheckCard = ({ results }: { results: DiagnosticResults }) => {
  const { t } = useTranslation();
  if (!results.tlsCheck) return null;

  return (
    <div className="mt-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-2">
        {t("diagnostics.tlsCheck", "TLS / SSL Check")}
      </div>
      {results.tlsCheck.tls_supported ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle size={12} className="text-green-500" />
            <span className="text-xs text-green-500">
              {results.tlsCheck.tls_version || "TLS Supported"}
            </span>
            <span className="text-xs text-[var(--color-textMuted)]">
              ({results.tlsCheck.handshake_time_ms}ms)
            </span>
          </div>
          {results.tlsCheck.certificate_valid !== undefined && (
            <div className="flex items-center gap-2">
              {results.tlsCheck.certificate_valid ? (
                <CheckCircle size={10} className="text-green-500" />
              ) : (
                <XCircle size={10} className="text-yellow-500" />
              )}
              <span
                className={`text-[10px] ${
                  results.tlsCheck.certificate_valid
                    ? "text-green-500"
                    : "text-yellow-500"
                }`}
              >
                {results.tlsCheck.certificate_valid
                  ? t("diagnostics.certValid", "Certificate Valid")
                  : t(
                      "diagnostics.certInvalid",
                      "Certificate Invalid/Expired",
                    )}
              </span>
            </div>
          )}
          {results.tlsCheck.certificate_subject && (
            <div
              className="text-[10px] text-[var(--color-textSecondary)] truncate"
              title={results.tlsCheck.certificate_subject}
            >
              <span className="text-[var(--color-textMuted)]">Subject:</span>{" "}
              {results.tlsCheck.certificate_subject}
            </div>
          )}
          {results.tlsCheck.certificate_expiry && (
            <div className="text-[10px] text-[var(--color-textSecondary)]">
              <span className="text-[var(--color-textMuted)]">Expires:</span>{" "}
              {new Date(
                results.tlsCheck.certificate_expiry,
              ).toLocaleDateString()}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <XCircle size={12} className="text-red-500" />
          <span className="text-xs text-red-500">
            {results.tlsCheck.error ||
              t("diagnostics.tlsNotSupported", "TLS not supported")}
          </span>
        </div>
      )}
    </div>
  );
};

export default TlsCheckCard;
