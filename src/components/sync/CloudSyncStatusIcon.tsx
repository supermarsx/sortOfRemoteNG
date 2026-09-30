import React from "react";
import { Cloud, CloudSync, X } from "lucide-react";

/** Cloud-specific activity/error glyphs with a non-color state description. */
export const CloudSyncStatusIcon: React.FC<{
  state: "syncing" | "failed";
  label: string;
  className?: string;
  inheritColor?: boolean;
}> = ({ state, label, className = "w-4 h-4", inheritColor = false }) => {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0"
    >
      {state === "syncing" ? (
        <CloudSync
          aria-hidden="true"
          className={`${className} ${inheritColor ? "" : "text-primary"} motion-safe:animate-pulse motion-reduce:animate-none`}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`relative inline-flex ${className} ${inheritColor ? "" : "text-error"}`}
        >
          <Cloud className="h-full w-full" />
          <X
            className="absolute left-[35%] top-[38%] h-[40%] w-[40%]"
            strokeWidth={3}
          />
        </span>
      )}
    </span>
  );
};
