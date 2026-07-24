import type {
  CommandExecution,
  CommandExecutionDisplayStatus,
} from "../../types/ssh/sshCommandHistory";

export type { CommandExecutionDisplayStatus } from "../../types/ssh/sshCommandHistory";

const isTrustedProducer = (execution: CommandExecution): boolean =>
  execution.source === "bulk-dispatch" ||
  execution.source === "web-terminal-script";

export function commandExecutionDisplayStatus(
  execution: CommandExecution,
): CommandExecutionDisplayStatus {
  if (
    execution.source === "web-terminal-script" &&
    execution.evidence === "remote-completion" &&
    (execution.status === "success" || execution.status === "error")
  ) {
    return execution.status;
  }
  if (
    isTrustedProducer(execution) &&
    execution.evidence === "dispatch-accepted"
  ) {
    return "dispatched";
  }
  if (
    isTrustedProducer(execution) &&
    execution.evidence === "dispatch-failed"
  ) {
    return "dispatch-failed";
  }
  return "unverified";
}

export function isVerifiedRemoteCompletion(
  execution: CommandExecution,
): boolean {
  const displayStatus = commandExecutionDisplayStatus(execution);
  return displayStatus === "success" || displayStatus === "error";
}
