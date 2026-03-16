import type { SectionProps } from "./types";
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
        infoTooltip="Multiplier for terminal scroll speed. Higher values scroll faster per mouse wheel tick. The default is 1x."
      />
      <Toggle
        checked={s.terminalSmoothScroll}
        onChange={(v) => u({ terminalSmoothScroll: v })}
        icon={<ArrowUpDown size={16} />}
        label="Smooth scrolling in terminal"
        description="Enable smooth scroll animation instead of jumping"
        settingKey="terminalSmoothScroll"
        infoTooltip="Enable smooth animated scrolling in the terminal instead of jumping line by line. May feel more natural but can use slightly more resources."
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
        infoTooltip="Choose what happens when you right-click a connection in the sidebar tree: show a context menu or immediately open the Quick Connect dialog."
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
        infoTooltip="Assign an action to the mouse back button (Button 4). Choose to switch to the previous tab, disconnect the current session, or do nothing."
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
        infoTooltip="Assign an action to the mouse forward button (Button 5). Choose to switch to the next tab, reconnect the current session, or do nothing."
      />
    </Card>
  </div>
);

export default ScrollInputSection;
