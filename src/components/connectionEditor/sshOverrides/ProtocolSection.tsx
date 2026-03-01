import OverrideToggle from "./OverrideToggle";
import { SSHVersion } from "../../../types/settings";
import { Checkbox, NumberInput, Select } from "../../ui/forms";

const ProtocolSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Protocol</h4>

      <OverrideToggle
        label="SSH Version"
        isOverridden={ov("sshVersion")}
        globalValue={g.sshVersion}
        onToggle={(on) => u("sshVersion", on ? g.sshVersion : undefined)}
      >
        <Select value={v("sshVersion")} onChange={(v: string) => u("sshVersion", v as SSHVersion)} options={[{ value: "auto", label: "Auto" }, { value: "2", label: "SSH-2 only" }, { value: "1", label: "SSH-1 only" }]} variant="form-sm" className="" />
      </OverrideToggle>

      <OverrideToggle
        label="Compression"
        isOverridden={ov("enableCompression")}
        globalValue={
          g.enableCompression ? `Level ${g.compressionLevel}` : "Disabled"
        }
        onToggle={(on) =>
          u("enableCompression", on ? !g.enableCompression : undefined)
        }
      >
        <div className="flex items-center gap-3">
          <label className="sor-form-inline-check">
            <Checkbox checked={v("enableCompression")} onChange={(v: boolean) => u("enableCompression", v)} variant="form" />
            Enable
          </label>
          {v("enableCompression") && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--color-textSecondary)]">
                Level:
              </span>
              <NumberInput value={v("compressionLevel")} onChange={(v: number) => u("compressionLevel", v)} variant="form" className="-xs w-16" min={1} max={9} />
            </div>
          )}
        </div>
      </OverrideToggle>

      <OverrideToggle
        label="PTY Type"
        isOverridden={ov("ptyType")}
        globalValue={g.ptyType}
        onToggle={(on) => u("ptyType", on ? g.ptyType : undefined)}
      >
        <Select value={v("ptyType")} onChange={(v: string) => u("ptyType", v)} options={[{ value: "xterm-256color", label: "xterm-256color" }, { value: "xterm", label: "xterm" }, { value: "vt100", label: "vt100" }, { value: "vt220", label: "vt220" }, { value: "linux", label: "linux" }, { value: "dumb", label: "dumb" }]} variant="form-sm" className="" />
      </OverrideToggle>
    </div>
  );
};

export default ProtocolSection;
