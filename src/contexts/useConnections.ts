import { useContext } from "react";
import { ConnectionContext } from "./ConnectionContextTypes";

export const useConnections = () => {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error("useConnections must be used within a ConnectionProvider");
  }
  return context;
};