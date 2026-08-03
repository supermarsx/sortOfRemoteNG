import { Cpu, KeyRound, Settings2, ShieldCheck } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type { Connection } from "../../types/connection/connection";
import { Checkbox } from "../ui/forms";

export type BmcEditorProtocol = "idrac" | "ilo" | "lenovo" | "supermicro";
export type BmcOptionsSection =
  | "connection"
  | "authentication"
  | "security"
  | "advanced";

interface BMCOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  section?: BmcOptionsSection;
}

type IdracSettings = NonNullable<Connection["idracSettings"]>;
type IloSettings = NonNullable<Connection["iloSettings"]>;
type LenovoSettings = NonNullable<Connection["lenovoSettings"]>;
type SupermicroSettings = NonNullable<Connection["supermicroSettings"]>;

const BMC_PROTOCOLS = new Set<BmcEditorProtocol>([
  "idrac",
  "ilo",
  "lenovo",
  "supermicro",
]);

const PROVIDER_FALLBACKS: Record<
  BmcEditorProtocol,
  { label: string; description: string }
> = {
  idrac: {
    label: "Dell iDRAC",
    description: "Dell server out-of-band management",
  },
  ilo: {
    label: "HPE iLO",
    description: "HPE server out-of-band management",
  },
  lenovo: {
    label: "Lenovo XClarity",
    description: "Lenovo server BMC management",
  },
  supermicro: {
    label: "Supermicro BMC",
    description: "Supermicro server BMC management",
  },
};

const cardClass =
  "min-w-0 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3";

const isBmcEditorProtocol = (
  protocol: Connection["protocol"] | undefined,
): protocol is BmcEditorProtocol =>
  typeof protocol === "string" &&
  BMC_PROTOCOLS.has(protocol as BmcEditorProtocol);

const optionalNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const Toggle: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <label className="flex min-w-0 items-start gap-2.5">
    <Checkbox
      checked={checked}
      onChange={onChange}
      variant="form"
      aria-label={label}
    />
    <span className="min-w-0">
      <span className="block text-xs font-medium text-[var(--color-text)]">
        {label}
      </span>
      <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-textMuted)]">
        {description}
      </span>
    </span>
  </label>
);

const BMCOptions: React.FC<BMCOptionsProps> = ({
  formData,
  setFormData,
  section,
}) => {
  const { t } = useTranslation();
  const protocol = formData.protocol;
  if (formData.isGroup || !isBmcEditorProtocol(protocol)) return null;

  const provider = PROVIDER_FALLBACKS[protocol];
  const shows = (candidate: BmcOptionsSection) =>
    !section || section === candidate;

  const updateIdrac = (patch: Partial<IdracSettings>) =>
    setFormData((previous) => ({
      ...previous,
      idracSettings: { ...previous.idracSettings, ...patch },
    }));
  const updateIlo = (patch: Partial<IloSettings>) =>
    setFormData((previous) => ({
      ...previous,
      iloSettings: { ...previous.iloSettings, ...patch },
    }));
  const updateLenovo = (patch: Partial<LenovoSettings>) =>
    setFormData((previous) => ({
      ...previous,
      lenovoSettings: { ...previous.lenovoSettings, ...patch },
    }));
  const updateSupermicro = (patch: Partial<SupermicroSettings>) =>
    setFormData((previous) => ({
      ...previous,
      supermicroSettings: { ...previous.supermicroSettings, ...patch },
    }));

  const transportValue =
    protocol === "idrac"
      ? (formData.idracSettings?.forceProtocol ?? "")
      : protocol === "ilo"
        ? (formData.iloSettings?.protocol ?? "")
        : protocol === "lenovo"
          ? (formData.lenovoSettings?.protocol ?? "")
          : formData.supermicroSettings?.useSsl === false
            ? "http"
            : "https";

  const transportOptions =
    protocol === "idrac"
      ? [
          ["", "Auto-detect"],
          ["redfish", "Redfish"],
          ["wsman", "WS-Man"],
          ["ipmi", "IPMI"],
        ]
      : protocol === "ilo"
        ? [
            ["", "Auto-detect"],
            ["redfish", "Redfish"],
            ["ribcl", "RIBCL"],
            ["ipmi", "IPMI"],
          ]
        : protocol === "lenovo"
          ? [
              ["", "Auto-detect"],
              ["redfish", "Redfish"],
              ["legacyRest", "Legacy REST"],
              ["ipmi", "IPMI"],
            ]
          : [
              ["https", "HTTPS"],
              ["http", "HTTP"],
            ];

  const updateTransport = (value: string) => {
    if (protocol === "idrac") {
      updateIdrac({
        forceProtocol: (value || undefined) as IdracSettings["forceProtocol"],
      });
    } else if (protocol === "ilo") {
      updateIlo({
        protocol: (value || undefined) as IloSettings["protocol"],
      });
    } else if (protocol === "lenovo") {
      updateLenovo({
        protocol: (value || undefined) as LenovoSettings["protocol"],
      });
    } else {
      updateSupermicro({ useSsl: value !== "http" });
    }
  };

  const verificationEnabled =
    protocol === "supermicro"
      ? (formData.supermicroSettings?.verifyCert ?? false)
      : protocol === "idrac"
        ? !(formData.idracSettings?.insecure ?? false)
        : protocol === "ilo"
          ? !(formData.iloSettings?.insecure ?? false)
          : !(formData.lenovoSettings?.insecure ?? false);

  const updateVerification = (verify: boolean) => {
    if (protocol === "supermicro") {
      updateSupermicro({ verifyCert: verify });
    } else if (protocol === "idrac") {
      updateIdrac({ insecure: !verify });
    } else if (protocol === "ilo") {
      updateIlo({ insecure: !verify });
    } else {
      updateLenovo({ insecure: !verify });
    }
  };

  const timeoutSecs =
    protocol === "idrac"
      ? formData.idracSettings?.timeoutSecs
      : protocol === "ilo"
        ? formData.iloSettings?.timeoutSecs
        : protocol === "lenovo"
          ? formData.lenovoSettings?.timeoutSecs
          : formData.supermicroSettings?.timeoutSecs;

  const updateTimeout = (timeoutSecs: number | undefined) => {
    if (protocol === "idrac") updateIdrac({ timeoutSecs });
    else if (protocol === "ilo") updateIlo({ timeoutSecs });
    else if (protocol === "lenovo") updateLenovo({ timeoutSecs });
    else updateSupermicro({ timeoutSecs });
  };

  return (
    <div data-editor-search-section="bmc-options" className="min-w-0 space-y-3">
      {shows("connection") && (
        <section className={cardClass}>
          <div className="flex items-start gap-2">
            <Cpu size={15} className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-[var(--color-text)]">
                {t(
                  `connectionEditor.protocolOptions.${protocol}.label`,
                  provider.label,
                )}
              </h4>
              <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-textMuted)]">
                {t(
                  `connectionEditor.protocolOptions.${protocol}.description`,
                  provider.description,
                )}
              </p>
            </div>
          </div>

          <label
            className="block min-w-0"
            data-editor-search-field="bmc-transport"
          >
            <span className="sor-form-label">
              {t("connectionEditor.bmc.transport", "Management transport")}
            </span>
            <select
              id="bmc-transport"
              value={transportValue}
              onChange={(event) => updateTransport(event.target.value)}
              className="sor-form-input-sm w-full min-w-0"
            >
              {transportOptions.map(([value, label]) => (
                <option key={value || "auto"} value={value}>
                  {value
                    ? label
                    : t(`${protocol}.connection.autoDetect`, label)}
                </option>
              ))}
            </select>
          </label>

          {protocol === "ilo" && (
            <label
              className="block min-w-0"
              data-editor-search-field="bmc-generation"
            >
              <span className="sor-form-label">
                {t("ilo.connection.generation", "iLO generation")}
              </span>
              <select
                id="bmc-generation"
                value={formData.iloSettings?.generation ?? ""}
                onChange={(event) =>
                  updateIlo({
                    generation: (event.target.value ||
                      undefined) as IloSettings["generation"],
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              >
                <option value="">
                  {t("ilo.connection.autoDetect", "Auto-detect")}
                </option>
                {(
                  [
                    "ilo1",
                    "ilo2",
                    "ilo3",
                    "ilo4",
                    "ilo5",
                    "ilo6",
                    "ilo7",
                  ] as const
                ).map((generation) => (
                  <option key={generation} value={generation}>
                    {t(
                      `ilo.generation.${generation}`,
                      generation.toUpperCase(),
                    )}
                  </option>
                ))}
              </select>
            </label>
          )}

          {protocol === "lenovo" && (
            <label
              className="block min-w-0"
              data-editor-search-field="bmc-generation"
            >
              <span className="sor-form-label">
                {t("lenovo.connection.generation", "XClarity generation")}
              </span>
              <select
                id="bmc-generation"
                value={formData.lenovoSettings?.generation ?? ""}
                onChange={(event) =>
                  updateLenovo({
                    generation: (event.target.value ||
                      undefined) as LenovoSettings["generation"],
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              >
                <option value="">
                  {t("lenovo.connection.autoDetect", "Auto-detect")}
                </option>
                {(["xcc2", "xcc", "imm2", "imm"] as const).map((generation) => (
                  <option key={generation} value={generation}>
                    {t(
                      `lenovo.generation.${generation}`,
                      generation.toUpperCase(),
                    )}
                  </option>
                ))}
              </select>
            </label>
          )}

          {protocol === "supermicro" && (
            <label
              className="block min-w-0"
              data-editor-search-field="bmc-platform"
            >
              <span className="sor-form-label">
                {t("supermicro.connection.platform", "Platform generation")}
              </span>
              <select
                id="bmc-platform"
                value={formData.supermicroSettings?.platform ?? "unknown"}
                onChange={(event) =>
                  updateSupermicro({
                    platform: event.target
                      .value as SupermicroSettings["platform"],
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              >
                <option value="unknown">
                  {t("supermicro.connection.autoDetect", "Auto-detect")}
                </option>
                {["x13", "h13", "x12", "h12", "x11", "x10", "x9"].map(
                  (platform) => (
                    <option key={platform} value={platform}>
                      {platform.toUpperCase()}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}

          {(protocol === "ilo" || protocol === "lenovo") && (
            <label
              className="block min-w-0"
              data-editor-search-field="bmc-ipmi-port"
            >
              <span className="sor-form-label">
                {t("connectionEditor.bmc.ipmiPort", "IPMI port")}
              </span>
              <input
                id="bmc-ipmi-port"
                type="number"
                min={1}
                max={65535}
                value={
                  protocol === "ilo"
                    ? (formData.iloSettings?.ipmiPort ?? "")
                    : (formData.lenovoSettings?.ipmiPort ?? "")
                }
                onChange={(event) => {
                  const ipmiPort = optionalNumber(event.target.value);
                  if (protocol === "ilo") updateIlo({ ipmiPort });
                  else updateLenovo({ ipmiPort });
                }}
                className="sor-form-input-sm w-full min-w-0"
                placeholder="623"
              />
            </label>
          )}
        </section>
      )}

      {shows("authentication") && (
        <section className={cardClass}>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
            <KeyRound size={15} className="text-primary" />
            {t("connectionEditor.bmc.authentication", "Authentication")}
          </div>

          {protocol === "ilo" && (
            <label
              className="block min-w-0"
              data-editor-search-field="bmc-auth-method"
            >
              <span className="sor-form-label">
                {t(
                  "connectionEditor.bmc.authenticationMethod",
                  "Authentication method",
                )}
              </span>
              <select
                id="bmc-auth-method"
                value={formData.iloSettings?.authMethod ?? "session"}
                onChange={(event) =>
                  updateIlo({
                    authMethod: event.target.value as IloSettings["authMethod"],
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              >
                <option value="session">Session token</option>
                <option value="basic">HTTP Basic</option>
              </select>
            </label>
          )}

          {protocol === "supermicro" && (
            <label
              className="block min-w-0"
              data-editor-search-field="bmc-auth-method"
            >
              <span className="sor-form-label">
                {t(
                  "connectionEditor.bmc.authenticationMethod",
                  "Authentication method",
                )}
              </span>
              <select
                id="bmc-auth-method"
                value={formData.supermicroSettings?.authMethod ?? "session"}
                onChange={(event) =>
                  updateSupermicro({
                    authMethod: event.target
                      .value as SupermicroSettings["authMethod"],
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              >
                <option value="session">Session token</option>
                <option value="basic">HTTP Basic</option>
              </select>
            </label>
          )}

          <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
            {t(
              "connectionEditor.bmc.credentialsStoredOnConnection",
              "Username and password remain in Basics. Provider settings never duplicate the saved password.",
            )}
          </p>
        </section>
      )}

      {shows("security") && (
        <section className={cardClass}>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
            <ShieldCheck size={15} className="text-primary" />
            {t(
              "connectionEditor.bmc.certificateSecurity",
              "Certificate security",
            )}
          </div>
          <div data-editor-search-field="bmc-certificate-verification">
            <Toggle
              label={t(
                "connectionEditor.bmc.verifyCertificate",
                "Verify server certificate",
              )}
              description={t(
                "connectionEditor.bmc.verifyCertificateHelp",
                "Enable strict certificate validation. Disable only for a trusted appliance using a self-signed certificate.",
              )}
              checked={verificationEnabled}
              onChange={updateVerification}
            />
          </div>
        </section>
      )}

      {shows("advanced") && (
        <section className={cardClass}>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
            <Settings2 size={15} className="text-primary" />
            {t("connectionEditor.bmc.advanced", "Advanced connection")}
          </div>
          <label
            className="block min-w-0"
            data-editor-search-field="bmc-timeout"
          >
            <span className="sor-form-label">
              {t(
                "connectionEditor.bmc.timeoutSeconds",
                "Connection timeout (seconds)",
              )}
            </span>
            <input
              id="bmc-timeout"
              type="number"
              min={1}
              max={3600}
              value={timeoutSecs ?? ""}
              onChange={(event) =>
                updateTimeout(optionalNumber(event.target.value))
              }
              className="sor-form-input-sm w-full min-w-0"
              placeholder="30"
            />
          </label>
        </section>
      )}
    </div>
  );
};

export default BMCOptions;
