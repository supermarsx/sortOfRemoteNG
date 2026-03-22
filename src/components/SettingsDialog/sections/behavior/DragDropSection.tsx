import type { SectionProps } from "./types";
import React from "react";
import { GripVertical, Eye, FileUp, FolderInput } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const DragDropSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<GripVertical className="w-4 h-4 text-accent" />}
      title="Drag & Drop"
    />
    <Card>
      <Toggle
        checked={s.enableFileDragDropToTerminal}
        onChange={(v) => u({ enableFileDragDropToTerminal: v })}
        icon={<FileUp size={16} />}
        label="Enable file drag-and-drop to terminal"
        description="Drop files onto an SSH session to upload via SCP/SFTP"
        settingKey="enableFileDragDropToTerminal"
        infoTooltip="Allow dragging files from your desktop onto an SSH terminal session to upload them via SCP or SFTP. Disable if you find this triggers accidentally."
      />
      <Toggle
        checked={s.enableFileDragDropToRdp}
        onChange={(v) => u({ enableFileDragDropToRdp: v })}
        icon={<FolderInput size={16} />}
        label="Enable file drag-and-drop to RDP"
        description="Drop files and folders onto an RDP session to transfer via clipboard"
        settingKey="enableFileDragDropToRdp"
        infoTooltip="Allow dragging files and folders from your desktop onto an RDP session to transfer them to the remote clipboard via the CLIPRDR protocol. The remote user can then paste them. Disable if this triggers accidentally."
      />
      <Toggle
        checked={s.showDropPreview}
        onChange={(v) => u({ showDropPreview: v })}
        icon={<Eye size={16} />}
        label="Show drop preview overlay"
        description="Display a visual indicator when dragging items over valid targets"
        settingKey="showDropPreview"
        infoTooltip="Show a visual overlay highlight when dragging items over valid drop targets, so you can see where the drop will land."
      />
      <SliderRow
        label="Drag sensitivity"
        value={s.dragSensitivityPx}
        min={1}
        max={20}
        unit="px"
        onChange={(v) => u({ dragSensitivityPx: v })}
        settingKey="dragSensitivityPx"
        infoTooltip="Minimum number of pixels the mouse must move before a drag operation begins. Increase to prevent accidental drags on sensitive touchpads."
      />
    </Card>
  </div>
);

export default DragDropSection;
