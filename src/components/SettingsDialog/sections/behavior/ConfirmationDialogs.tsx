import type { SectionProps } from "./types";
import React from "react";
import { ShieldAlert, Trash2, FileDown } from "lucide-react";
import { Card, SectionHeader, Toggle } from "../../../ui/settings/SettingsPrimitives";
const ConfirmationDialogs: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<ShieldAlert className="w-4 h-4 text-error" />}
      title="Confirmation Dialogs"
    />
    <p className="text-xs text-[var(--color-textMuted)]">
      Control which destructive or significant actions require confirmation.
    </p>
    <Card>
      <Toggle
        checked={s.confirmDisconnect}
        onChange={(v) => u({ confirmDisconnect: v })}
        icon={<ShieldAlert size={16} />}
        label="Confirm before disconnecting"
        description="Ask before closing an active session"
        settingKey="confirmDisconnect"
        infoTooltip="Show a confirmation dialog before disconnecting an active remote session, preventing accidental disconnections from a running terminal."
      />
      <Toggle
        checked={s.confirmDeleteConnection}
        onChange={(v) => u({ confirmDeleteConnection: v })}
        icon={<Trash2 size={16} />}
        label="Confirm before deleting connections"
        description="Prompt before permanently removing a saved connection"
        settingKey="confirmDeleteConnection"
        infoTooltip="Require confirmation before permanently deleting a saved connection entry from the connection tree. Helps prevent accidental data loss."
      />
      <Toggle
        checked={s.confirmBulkOperations}
        onChange={(v) => u({ confirmBulkOperations: v })}
        icon={<ShieldAlert size={16} />}
        label="Confirm bulk operations"
        description="Ask before multi-select actions like batch connect or delete"
        settingKey="confirmBulkOperations"
        infoTooltip="Prompt for confirmation before executing actions on multiple selected connections at once, such as batch connect, disconnect, or delete."
      />
      <Toggle
        checked={s.confirmImport}
        onChange={(v) => u({ confirmImport: v })}
        icon={<FileDown size={16} />}
        label="Confirm before importing"
        description="Show a summary before importing connections or settings"
        settingKey="confirmImport"
        infoTooltip="Display a summary of what will be imported and ask for confirmation before adding imported connections or applying imported settings."
      />
      <Toggle
        checked={s.confirmDeleteAllBookmarks}
        onChange={(v) => u({ confirmDeleteAllBookmarks: v })}
        icon={<Trash2 size={16} />}
        label="Confirm before deleting all bookmarks"
        settingKey="confirmDeleteAllBookmarks"
        infoTooltip="Require confirmation before clearing all saved bookmarks. This action cannot be undone."
      />
    </Card>
  </div>
);

export default ConfirmationDialogs;
