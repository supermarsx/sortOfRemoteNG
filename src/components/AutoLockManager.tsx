import React from "react";
import { Lock, Clock, Eye, EyeOff } from "lucide-react";
import { AutoLockConfig } from "../types/settings";
import { Modal } from "./ui/overlays/Modal";
import { useAutoLockManager } from "../hooks/security/useAutoLockManager";

type Mgr = ReturnType<typeof useAutoLockManager>;

interface AutoLockManagerProps {
  config: AutoLockConfig;
  onConfigChange: (config: AutoLockConfig) => void;
  onLock: () => void;
}

export const AutoLockManager: React.FC<AutoLockManagerProps> = ({
  config,
  onConfigChange,
  onLock,
}) => {
  const mgr = useAutoLockManager(config, onLock);

  if (mgr.isLocked) {
    return (
      <Modal
        isOpen={mgr.isLocked}
        closeOnBackdrop={false}
        closeOnEscape={false}
        backdropClassName="bg-black/90"
        panelClassName="max-w-md mx-4"
        dataTestId="auto-lock-modal"
      >
        <div className="bg-[var(--color-surface)] rounded-lg p-8 w-full text-center">
          <Lock size={64} className="mx-auto mb-6 text-blue-400" />
          <h2 className="text-2xl font-semibold text-[var(--color-text)] mb-4">
            Session Locked
          </h2>
          <p className="text-[var(--color-textSecondary)] mb-6">
            Your session has been locked due to inactivity.
          </p>

          {config.requirePassword ? (
            <div className="space-y-4">
              <div className="relative">
                <input
                  type={mgr.showPassword ? "text" : "password"}
                  value={mgr.password}
                  onChange={(e) => mgr.setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && mgr.handleUnlock()}
                  className="w-full px-4 py-3 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter password to unlock"
                  autoFocus
                />
                <button
                  onClick={() => mgr.setShowPassword(!mgr.showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                >
                  {mgr.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button
                onClick={mgr.handleUnlock}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
              >
                Unlock
              </button>
            </div>
          ) : (
            <button
              onClick={mgr.handleUnlock}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
            >
              Click to Unlock
            </button>
          )}
        </div>
      </Modal>
    );
  }

  if (!config.enabled) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3 text-sm">
      <div className="flex items-center space-x-2">
        <Clock size={16} className="text-blue-400" />
        <span className="text-[var(--color-textSecondary)]">
          Auto-lock in: {mgr.formatTime(mgr.timeRemaining)}
        </span>
        <button
          onClick={mgr.handleAutoLock}
          className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          title="Lock now"
        >
          <Lock size={14} />
        </button>
      </div>
    </div>
  );
};
