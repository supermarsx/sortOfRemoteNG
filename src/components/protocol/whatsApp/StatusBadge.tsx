import React from "react";
import { StatusBadge as SharedStatusBadge } from "../../ui/display";
import type { StatusBadgeStatus } from "../../ui/display";

const stateToStatus = (state: string): StatusBadgeStatus => {
  switch (state) {
    case "active":
      return "success";
    case "tokenExpired":
      return "warning";
    case "error":
      return "error";
    case "disconnected":
    default:
      return "info";
  }
};

const StatusBadge: React.FC<{ state: string }> = ({ state }) => (
  <SharedStatusBadge status={stateToStatus(state)} label={state} />
);

export default StatusBadge;
