import React from "react";
import { AppStatusBar } from "./AppStatusBar";
import { ErrorLogBar } from "./ErrorLogBar";

type AppBottomBarsProps = React.ComponentProps<typeof AppStatusBar> & {
  showStatusBar: boolean;
  showErrorLog: boolean;
  onToggleErrorLog: () => void;
};

/** Both bars reserve layout space; expanded logs push content up, not over it. */
export const AppBottomBars: React.FC<AppBottomBarsProps> = ({
  showStatusBar,
  showErrorLog,
  onToggleErrorLog,
  ...statusProps
}) => (
  <div className="flex min-w-0 shrink-0 flex-col" data-testid="app-bottom-bars">
    <ErrorLogBar isVisible={showErrorLog} onToggle={onToggleErrorLog} />
    {showStatusBar && <AppStatusBar {...statusProps} />}
  </div>
);
