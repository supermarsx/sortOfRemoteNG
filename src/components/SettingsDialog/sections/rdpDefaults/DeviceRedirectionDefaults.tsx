import type { SectionProps } from "./selectClass";
import React from "react";
import {
  HardDrive,
  FolderOpen,
  Copy,
  Printer,
  Cable,
  CreditCard,
  ShieldCheck,
  Video,
  Mic,
  Usb,
  ArrowRightLeft,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import { DriveMappingEditor } from "../../../connectionEditor/rdpOptions/DeviceRedirectionSection";
import type {
  ClipboardDirection,
  RdpPrinterOutputMode,
} from "../../../../types/connection/connection";

const CLIPBOARD_DIRECTION_OPTIONS: Array<{
  value: ClipboardDirection;
  label: string;
}> = [
  { value: "bidirectional", label: "Bidirectional" },
  { value: "client-to-server", label: "Local to remote only" },
  { value: "server-to-client", label: "Remote to local only" },
  { value: "disabled", label: "Disabled" },
];

const PRINTER_OUTPUT_MODE_OPTIONS: Array<{
  value: RdpPrinterOutputMode;
  label: string;
}> = [
  { value: "spool-file", label: "Save spool file locally" },
  { value: "native-print", label: "Send to OS printer (spool fallback)" },
];

const DeviceRedirectionDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<HardDrive className="w-4 h-4 text-primary" />}
      title="Local Resource Defaults"
    />

    <Card>
      <p className="text-xs text-[var(--color-textMuted)]">
        Global device redirection settings inherited by all connections.
        Per-connection settings can override these.
      </p>

      {/* Written out one by one rather than mapped over a table: `settingKey`
          has to be a literal for `settingsSearchDrift` to join these controls to
          the search index. */}
      <Toggle
        settingKey="rdpDefaults.clipboardRedirection"
        checked={rdp.clipboardRedirection ?? true}
        onChange={(v: boolean) => update({ clipboardRedirection: v })}
        icon={<Copy size={16} />}
        label="Clipboard"
        description="Share clipboard between local and remote for copy/paste."
      />
      <Toggle
        settingKey="rdpDefaults.printerRedirection"
        checked={rdp.printerRedirection ?? false}
        onChange={(v: boolean) => update({ printerRedirection: v })}
        icon={<Printer size={16} />}
        label="Printers"
        description="Redirect local printers to the remote session."
      />
      <Toggle
        settingKey="rdpDefaults.portRedirection"
        checked={rdp.portRedirection ?? false}
        onChange={(v: boolean) => update({ portRedirection: v })}
        icon={<Cable size={16} />}
        label="Serial / COM ports"
        description="Redirect serial/COM ports for hardware devices."
      />
      <Toggle
        settingKey="rdpDefaults.smartCardRedirection"
        checked={rdp.smartCardRedirection ?? false}
        onChange={(v: boolean) => update({ smartCardRedirection: v })}
        icon={<CreditCard size={16} />}
        label="Smart cards"
        description="Redirect smart card readers for authentication."
      />
      <Toggle
        settingKey="rdpDefaults.webAuthnRedirection"
        checked={rdp.webAuthnRedirection ?? false}
        onChange={(v: boolean) => update({ webAuthnRedirection: v })}
        icon={<ShieldCheck size={16} />}
        label="WebAuthn / FIDO"
        description="Redirect security keys for passwordless auth."
      />
      <Toggle
        settingKey="rdpDefaults.videoCaptureRedirection"
        checked={rdp.videoCaptureRedirection ?? false}
        onChange={(v: boolean) => update({ videoCaptureRedirection: v })}
        icon={<Video size={16} />}
        label="Video capture"
        description="Redirect local cameras to the remote session."
      />
      <Toggle
        settingKey="rdpDefaults.audioInputRedirection"
        checked={rdp.audioInputRedirection ?? false}
        onChange={(v: boolean) => update({ audioInputRedirection: v })}
        icon={<Mic size={16} />}
        label="Audio input"
        description="Redirect microphone to the remote session."
      />
      <Toggle
        settingKey="rdpDefaults.usbRedirection"
        checked={rdp.usbRedirection ?? false}
        onChange={(v: boolean) => update({ usbRedirection: v })}
        icon={<Usb size={16} />}
        label="USB devices"
        description="Redirect USB devices for direct hardware access."
      />
      <Toggle
        settingKey="rdpDefaults.driveRedirection"
        checked={rdp.driveRedirection ?? false}
        onChange={(v: boolean) => update({ driveRedirection: v })}
        icon={<HardDrive size={16} />}
        label="Drive redirection"
        description="Share local drives and folders as mapped network drives."
      />

      <SettingsSelectRow
        settingKey="rdpDefaults.clipboardDirection"
        icon={<ArrowRightLeft size={16} />}
        label="Clipboard direction"
        value={rdp.clipboardDirection ?? "bidirectional"}
        options={CLIPBOARD_DIRECTION_OPTIONS}
        onChange={(v) =>
          update({ clipboardDirection: v as ClipboardDirection })
        }
        infoTooltip="Default clipboard flow policy for RDP sessions. Per-connection settings can override this."
      />

      <SettingsSelectRow
        settingKey="rdpDefaults.printerOutputMode"
        icon={<Printer size={16} />}
        label="Printer output mode"
        value={rdp.printerOutputMode ?? "spool-file"}
        options={PRINTER_OUTPUT_MODE_OPTIONS}
        onChange={(v) =>
          update({ printerOutputMode: v as RdpPrinterOutputMode })
        }
        infoTooltip="Default delivery mode for redirected print jobs. Native print still keeps the local spool file as a fallback artifact."
      />

      {/* Drive mappings — keep the specialized editor, but lift the
          mini-header to the in-card sub-group style. */}
      <div className="flex items-center gap-1.5 pt-3 mt-1 border-t border-[var(--color-border)]/40 text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] font-medium">
        <FolderOpen size={11} />
        Global drive mappings
        <InfoTooltip text="Drive mappings inherited by all RDP connections. Individual connections can exclude specific mappings or add their own. Requires Drive Redirection to be enabled." />
      </div>
      <DriveMappingEditor
        drives={rdp.driveRedirections ?? []}
        onChange={(drives) => {
          const patch: Record<string, unknown> = { driveRedirections: drives };
          if (drives.length > 0 && !rdp.driveRedirection) {
            patch.driveRedirection = true;
          }
          update(patch as Record<string, unknown>);
        }}
        selectClass="sor-form-input"
      />
    </Card>
  </div>
);

export default DeviceRedirectionDefaults;
