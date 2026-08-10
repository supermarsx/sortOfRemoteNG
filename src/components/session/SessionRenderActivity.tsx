import React from "react";
import { SessionRenderActivityContext } from "../../contexts/SessionRenderActivityContext";

export const SessionRenderActivityProvider: React.FC<{
  isActive: boolean;
  children: React.ReactNode;
}> = ({ isActive, children }) => (
  <SessionRenderActivityContext.Provider value={{ isActive }}>
    {children}
  </SessionRenderActivityContext.Provider>
);
