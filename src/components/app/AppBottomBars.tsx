import React from "react";
import { AppStatusBar } from "./AppStatusBar";
import { ErrorLogBar } from "./ErrorLogBar";
import { SafeModeBanner } from "./SafeModeBanner";

type AppBottomBarsProps = React.ComponentProps<typeof AppStatusBar> & {
  showStatusBar: boolean;
  showErrorLog: boolean;
  onToggleErrorLog: () => void;
};

/** Error log, safe mode bar and status bar reserve layout space; expanded logs push content up, not over it. */
export const AppBottomBars: React.FC<AppBottomBarsProps> = ({
  showStatusBar,
  showErrorLog,
  onToggleErrorLog,
  ...statusProps
}) => (
  <div className="flex min-w-0 shrink-0 flex-col" data-testid="app-bottom-bars">
    <ErrorLogBar isVisible={showErrorLog} onToggle={onToggleErrorLog} />
    <SafeModeBanner />
    {showStatusBar && <AppStatusBar {...statusProps} />}
  </div>
);
