import React from "react";
import { ScrollText, ArrowUpDown } from "lucide-react";
import { Card, SectionHeader, SelectRow, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const ScrollInputSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<ScrollText className="w-4 h-4 text-teal-400" />}
      title="Scroll & Input"
    />
    <Card>
      <SliderRow
        label="Terminal scroll speed"
        value={s.terminalScrollSpeed}
        min={0.25}
        max={5}
        step={0.25}
        unit="x"
        onChange={(v) => u({ terminalScrollSpeed: v })}
        settingKey="terminalScrollSpeed"
      />
      <Toggle
        checked={s.terminalSmoothScroll}
        onChange={(v) => u({ terminalSmoothScroll: v })}
        icon={<ArrowUpDown size={16} />}
        label="Smooth scrolling in terminal"
        description="Enable smooth scroll animation instead of jumping"
        settingKey="terminalSmoothScroll"
      />
      <SelectRow
        label="Right-click in tree"
        value={s.treeRightClickAction}
        options={[
          { value: "contextMenu", label: "Context menu" },
          { value: "quickConnect", label: "Quick connect" },
        ]}
        onChange={(v) =>
          u({
            treeRightClickAction: v as "contextMenu" | "quickConnect",
          })
        }
        settingKey="treeRightClickAction"
      />
      <SelectRow
        label="Mouse back button"
        value={s.mouseBackAction}
        options={[
          { value: "none", label: "Do nothing" },
          { value: "previousTab", label: "Previous tab" },
          { value: "disconnect", label: "Disconnect" },
        ]}
        onChange={(v) =>
          u({
            mouseBackAction: v as "none" | "previousTab" | "disconnect",
          })
        }
        settingKey="mouseBackAction"
      />
      <SelectRow
        label="Mouse forward button"
        value={s.mouseForwardAction}
        options={[
          { value: "none", label: "Do nothing" },
          { value: "nextTab", label: "Next tab" },
          { value: "reconnect", label: "Reconnect" },
        ]}
        onChange={(v) =>
          u({
            mouseForwardAction: v as "none" | "nextTab" | "reconnect",
          })
        }
        settingKey="mouseForwardAction"
      />
    </Card>
  </div>
);

export default ScrollInputSection;
