
import { useState } from "react";
import { Pencil } from "lucide-react";
import { updateTrustRecordNickname } from "../../../utils/trustStore";
import type { TrustRecord } from "../../../utils/trustStore";
function NicknameEditButton({
  record,
  connectionId,
  onSaved,
}: {
  record: TrustRecord;
  connectionId?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.nickname ?? "");
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const [h, p] = record.host.split(":");
            updateTrustRecordNickname(
              h,
              parseInt(p, 10),
              record.type,
              draft.trim(),
              connectionId,
            );
            setEditing(false);
            onSaved();
          } else if (e.key === "Escape") {
            setDraft(record.nickname ?? "");
            setEditing(false);
          }
        }}
        onBlur={() => {
          const [h, p] = record.host.split(":");
          updateTrustRecordNickname(
            h,
            parseInt(p, 10),
            record.type,
            draft.trim(),
            connectionId,
          );
          setEditing(false);
          onSaved();
        }}
        placeholder="Nickname…"
        className="w-24 px-1.5 py-0.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-textSecondary)] placeholder-[var(--color-textMuted)] text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(record.nickname ?? "");
        setEditing(true);
      }}
      className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] p-0.5 transition-colors flex-shrink-0"
      title={record.nickname ? `Nickname: ${record.nickname}` : "Add nickname"}
    >
      <Pencil size={10} />
    </button>
  );
}

export default NicknameEditButton;

