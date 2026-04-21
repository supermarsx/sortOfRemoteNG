import React from "react";
import { AlertTriangle } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  ValidityBadge                                                      */
/* ------------------------------------------------------------------ */

export const ValidityBadge: React.FC<{ validity: string }> = ({ validity }) => {
  const colors: Record<string, string> = {
    ultimate: "bg-success/10 text-success",
    full: "bg-primary/10 text-primary",
    marginal: "bg-warning/10 text-warning",
    never: "bg-error/10 text-error",
    unknown: "bg-text-secondary/10 text-text-muted",
    revoked: "bg-error/10 text-error",
    expired: "bg-warning/10 text-warning",
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
        colors[validity] ?? colors.unknown
      }`}
    >
      {validity}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  TrustBadge                                                         */
/* ------------------------------------------------------------------ */

export const TrustBadge: React.FC<{ trust: string }> = ({ trust }) => {
  const colors: Record<string, string> = {
    ultimate: "bg-primary/10 text-primary",
    full: "bg-primary/10 text-primary",
    marginal: "bg-warning/10 text-warning",
    never: "bg-error/10 text-error",
    unknown: "bg-text-secondary/10 text-text-muted",
    undefined: "bg-text-secondary/10 text-text-muted",
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
        colors[trust] ?? colors.unknown
      }`}
    >
      {trust}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  ErrorBanner                                                        */
/* ------------------------------------------------------------------ */

export const ErrorBanner: React.FC<{ error: string | null }> = ({ error }) => {
  if (!error) return null;
  return (
    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      {error}
    </div>
  );
};
