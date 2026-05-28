import React, { useEffect, useState } from "react";
import { GlobalSettings } from "../../../../types/settings/settings";
import { Lock, ShieldCheck, Cpu, CheckCircle2, XCircle } from "lucide-react";
import { ENCRYPTION_ALGORITHMS } from "../../../../hooks/settings/useSecuritySettings";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr, TFunc } from "./types";

interface CpuAesCapabilities {
  arch: string;
  has_aes_ni: boolean;
  has_vaes: boolean;
  has_pclmulqdq: boolean;
  tier_aes_gcm: boolean;
  hardware_aes: boolean;
  label: string;
}

function useCpuAes(): CpuAesCapabilities | null {
  const [caps, setCaps] = useState<CpuAesCapabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<CpuAesCapabilities>(
          "get_cpu_aes_capabilities",
        );
        if (!cancelled) setCaps(result);
      } catch {
        /* not in Tauri or command unavailable — leave as null */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return caps;
}

const HardwareAesIndicator: React.FC<{ caps: CpuAesCapabilities }> = ({
  caps,
}) => {
  const supported = caps.hardware_aes;
  const Icon = supported ? CheckCircle2 : XCircle;
  const fastPath = caps.tier_aes_gcm
    ? " — AES-GCM hardware fast path enabled"
    : caps.hardware_aes
      ? " — AES core accelerated"
      : "";
  return (
    <div
      data-testid="aes-hw-indicator"
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
        supported
          ? "border-success/40 bg-success/10 text-success"
          : "border-warning/40 bg-warning/10 text-warning"
      }`}
    >
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium">
          <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
          Hardware AES{" "}
          {supported ? "supported" : "not detected"}
          <span className="text-[10px] uppercase tracking-wider opacity-70">
            ({caps.arch})
          </span>
        </div>
        <p className="mt-0.5 leading-relaxed text-[var(--color-textSecondary)]">
          {supported
            ? `Available extensions: ${caps.label}${fastPath}. AES-based algorithms run with hardware acceleration on this machine.`
            : `No AES hardware extensions detected on this ${caps.arch} CPU — AES algorithms will fall back to software. Consider ChaCha20-Poly1305 for better performance.`}
        </p>
      </div>
    </div>
  );
};

function EncryptionAlgorithmSection({
  settings,
  updateSettings,
  mgr,
  t,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
  mgr: Mgr;
  t: TFunc;
}) {
  const selectedAlgo = ENCRYPTION_ALGORITHMS.find(
    (a) => a.value === settings.encryptionAlgorithm,
  );
  const cpuAes = useCpuAes();

  // Build the algorithm description with the recommended ★ + algorithm
  // notes so it lives inline as the row's description (one-per-line style).
  const algoDescription = selectedAlgo
    ? `${selectedAlgo.recommended ? "★ Recommended — " : ""}${selectedAlgo.description}`
    : undefined;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Lock className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            {t("security.algorithm")}{" "}
            <InfoTooltip text="Choose the symmetric encryption algorithm used to protect stored credentials and connection files." />
          </span>
        }
      />

      <Card>
        <SettingsSelectRow
          settingKey="encryptionAlgorithm"
          icon={<Lock size={16} />}
          label="Algorithm"
          description={algoDescription}
          value={settings.encryptionAlgorithm}
          options={ENCRYPTION_ALGORITHMS.map((algo) => ({
            value: algo.value,
            label: `${algo.label}${algo.recommended ? " ★" : ""}`,
          }))}
          onChange={(v) =>
            updateSettings({
              encryptionAlgorithm:
                v as GlobalSettings["encryptionAlgorithm"],
            })
          }
          infoTooltip="The symmetric cipher used to encrypt your stored credentials and connection files. AES-256-GCM is widely supported; ChaCha20-Poly1305 is the modern alternative."
        />

        {cpuAes && <HardwareAesIndicator caps={cpuAes} />}

        {mgr.validModes.length > 0 && (
          <SettingsSelectRow
            settingKey="blockCipherMode"
            icon={<ShieldCheck size={16} />}
            label="Cipher mode"
            value={settings.blockCipherMode}
            options={mgr.validModes.map((mode) => ({
              value: mode.value,
              label: mode.label,
            }))}
            onChange={(v) =>
              updateSettings({
                blockCipherMode:
                  v as GlobalSettings["blockCipherMode"],
              })
            }
            infoTooltip="Block cipher mode of operation — determines how plaintext blocks are chained together during encryption."
          />
        )}

        {settings.encryptionAlgorithm === "ChaCha20-Poly1305" && (
          <p className="flex items-center gap-2 text-xs text-[var(--color-textMuted)]">
            <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0" />
            Stream cipher with built-in AEAD — no block mode required.
          </p>
        )}
      </Card>
    </div>
  );
}

export default EncryptionAlgorithmSection;
