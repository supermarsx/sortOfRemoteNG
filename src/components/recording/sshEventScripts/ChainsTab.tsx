import React from "react";
import type { ChainsTabProps } from "./types";

export const ChainsTab: React.FC<ChainsTabProps> = ({ chains, scripts }) => {
  const scriptMap = new Map(scripts.map((s) => [s.id, s]));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h3 className="text-lg font-semibold text-white">
        Script Chains ({chains.length})
      </h3>
      <p className="mt-1 text-sm text-text-muted">
        Define ordered pipelines of scripts that execute in sequence.
      </p>

      {chains.length === 0 ? (
        <div className="mt-8 text-center text-text-secondary">
          <p className="text-3xl">🔗</p>
          <p className="mt-2 text-sm">No chains defined yet.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {chains.map((chain) => (
            <div
              key={chain.id}
              className="rounded-lg border border-theme-border bg-surface p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-white">{chain.name}</h4>
                  {chain.description && (
                    <p className="text-sm text-text-muted">
                      {chain.description}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    chain.enabled
                      ? "bg-success/40 text-success"
                      : "bg-surfaceHover text-text-secondary"
                  }`}
                >
                  {chain.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-1">
                {chain.steps.map((step, i) => {
                  const s = scriptMap.get(step.scriptId);
                  return (
                    <React.Fragment key={i}>
                      {i > 0 && (
                        <span className="text-text-muted">→</span>
                      )}
                      <span className="rounded bg-surfaceHover px-2 py-0.5 text-xs text-text-secondary">
                        {s?.name ?? step.scriptId}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
