import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import {
  parseTrustRecordAddress,
  updateTrustRecordNickname,
} from "../../../utils/auth/trustStore";
import type { TrustRecord } from "../../../utils/auth/trustStore";
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
  const savingRef = useRef(false);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const { host, port } = parseTrustRecordAddress(record);
      await updateTrustRecordNickname(
        host,
        port,
        record.type,
        draft.trim(),
        connectionId,
      );
      setEditing(false);
      onSaved();
    } finally {
      savingRef.current = false;
    }
  };
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            setDraft(record.nickname ?? "");
            setEditing(false);
          }
        }}
        onBlur={() => void save()}
        placeholder="Nickname…"
        className="w-24 px-1.5 py-0.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-textSecondary)] placeholder-[var(--color-textMuted)] text-xs focus:outline-none focus:ring-1 focus:ring-primary"
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
