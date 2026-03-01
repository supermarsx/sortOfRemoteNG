import ScriptEditForm from "./ScriptEditForm";
import ScriptDetailView from "./ScriptDetailView";
import SelectScriptPlaceholder from "./SelectScriptPlaceholder";
import EditFooter from "./EditFooter";

function DetailPane({ mgr }: { mgr: ScriptManagerMgr }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {mgr.isEditing ? (
        <ScriptEditForm mgr={mgr} />
      ) : mgr.selectedScript ? (
        <ScriptDetailView mgr={mgr} />
      ) : (
        <SelectScriptPlaceholder mgr={mgr} />
      )}
      {mgr.isEditing && <EditFooter mgr={mgr} />}
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────

export default DetailPane;
