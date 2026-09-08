import React, { useEffect, useState } from "react";
import { Lock, Cpu, CheckCircle2, XCircle } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
} from "../../../ui/settings/SettingsPrimitives";

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
          Hardware AES {supported ? "supported" : "not detected"}
          <span className="text-[10px] uppercase tracking-wider opacity-70">
            ({caps.arch})
          </span>
        </div>
        <p className="mt-0.5 leading-relaxed text-[var(--color-textSecondary)]">
          {supported
            ? `Available extensions: ${caps.label}${fastPath}. AES-based algorithms run with hardware acceleration on this machine.`
            : `No AES hardware extensions detected on this ${caps.arch} CPU — AES algorithms will fall back to software. The storage format remains AES-256-GCM.`}
        </p>
      </div>
    </div>
  );
};

function EncryptionAlgorithmSection() {
  const cpuAes = useCpuAes();
  return (
    <div className="space-y-4" data-setting-key="encryptionAlgorithm">
      <SectionHeader
        icon={<Lock className="w-4 h-4 text-primary" />}
        title="Encryption formats (read-only)"
      />
      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Native application-wide storage uses AES-256-GCM with
          artifact-specific HKDF-SHA256 keys. Optional database passwords add a
          separate AES-256-GCM envelope. These formats are fixed; saved legacy
          algorithm and cipher-mode preferences do not change them.
        </p>
        {cpuAes && <HardwareAesIndicator caps={cpuAes} />}
      </Card>
    </div>
  );
}
export default EncryptionAlgorithmSection;
