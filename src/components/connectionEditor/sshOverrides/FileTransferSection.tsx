import OverrideToggle from "./OverrideToggle";
import { Checkbox } from "../../ui/forms";

const FileTransferSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">File Transfer</h4>

      <OverrideToggle
        label="SFTP"
        isOverridden={ov("sftpEnabled")}
        globalValue={g.sftpEnabled ? "Enabled" : "Disabled"}
        onToggle={(on) => u("sftpEnabled", on ? !g.sftpEnabled : undefined)}
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("sftpEnabled")} onChange={(v: boolean) => u("sftpEnabled", v)} variant="form" />
          Enable SFTP subsystem
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="SCP"
        isOverridden={ov("scpEnabled")}
        globalValue={g.scpEnabled ? "Enabled" : "Disabled"}
        onToggle={(on) => u("scpEnabled", on ? !g.scpEnabled : undefined)}
      >
        <label className="sor-form-inline-check">
          <Checkbox checked={v("scpEnabled")} onChange={(v: boolean) => u("scpEnabled", v)} variant="form" />
          Enable SCP transfers
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="SFTP Start Path"
        isOverridden={ov("sftpStartPath")}
        globalValue={g.sftpStartPath || "Home directory"}
        onToggle={(on) =>
          u("sftpStartPath", on ? g.sftpStartPath || "" : undefined)
        }
      >
        <input
          type="text"
          placeholder="/path/to/start"
          value={v("sftpStartPath") || ""}
          onChange={(e) => u("sftpStartPath", e.target.value || undefined)}
          className="sor-form-input-sm w-full"
        />
      </OverrideToggle>
    </div>
  );
};

export default FileTransferSection;
