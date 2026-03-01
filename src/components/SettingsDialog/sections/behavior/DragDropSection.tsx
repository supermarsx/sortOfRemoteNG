import React from "react";
import { GripVertical, Eye, FileUp } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const DragDropSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<GripVertical className="w-4 h-4 text-indigo-400" />}
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
      />
      <Toggle
        checked={s.showDropPreview}
        onChange={(v) => u({ showDropPreview: v })}
        icon={<Eye size={16} />}
        label="Show drop preview overlay"
        description="Display a visual indicator when dragging items over valid targets"
        settingKey="showDropPreview"
      />
      <SliderRow
        label="Drag sensitivity"
        value={s.dragSensitivityPx}
        min={1}
        max={20}
        unit="px"
        onChange={(v) => u({ dragSensitivityPx: v })}
        settingKey="dragSensitivityPx"
      />
    </Card>
  </div>
);

export default DragDropSection;
