
import React from "react";
const StatusBadge: React.FC<{ state: string }> = ({ state }) => {
  const colors: Record<string, string> = {
    active: "bg-success",
    tokenExpired: "bg-warning",
    disconnected: "bg-[var(--color-secondary)]",
    error: "bg-error",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[state] ?? "bg-[var(--color-secondary)]"}`}
      title={state}
    />
  );
};

export default StatusBadge;
