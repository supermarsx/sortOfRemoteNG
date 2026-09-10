/** Actual opening milestones; never inferred percentages or credential details. */
export type DatabaseOpenStage =
  | "waiting-unlock"
  | "unlocking"
  | "loading"
  | "success"
  | "failed"
  | "cancelled"
  | "unconfirmed";
export type DatabaseOpenObserver = (stage: DatabaseOpenStage) => void;
export type DatabaseSelectHandler = (
  databaseId: string,
  password?: string,
  onProgress?: DatabaseOpenObserver,
) => Promise<void> | void;
