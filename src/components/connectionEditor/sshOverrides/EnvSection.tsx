import EnvironmentEditor from "./EnvironmentEditor";
import OverrideToggle from "./OverrideToggle";


const EnvSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Environment Variables</h4>

      <OverrideToggle
        label="Custom Environment"
        isOverridden={ov("environment")}
        globalValue={
          Object.keys(g.environment || {}).length
            ? `${Object.keys(g.environment || {}).length} vars`
            : "None"
        }
        onToggle={(on) =>
          u("environment", on ? { ...(g.environment || {}) } : undefined)
        }
      >
        <EnvironmentEditor
          value={(v("environment") as Record<string, string>) || {}}
          onChange={(env) =>
            u("environment", Object.keys(env).length > 0 ? env : undefined)
          }
        />
      </OverrideToggle>
    </div>
  );
};

export default EnvSection;
