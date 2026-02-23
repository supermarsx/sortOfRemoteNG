import React, { useState, useRef, useEffect, useCallback, InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * Override the global password-reveal enabled setting for this field.
   * When `false`, the eye icon is never shown regardless of global setting.
   */
  revealable?: boolean;
}

/**
 * Drop-in replacement for `<input type="password" />` that adds a
 * configurable show/hide eye icon. Behaviour is governed by the global
 * `passwordReveal` settings (mode, autoHideSeconds, showByDefault, etc.)
 * but can be overridden per-instance via the `revealable` prop.
 */
export const PasswordInput: React.FC<PasswordInputProps> = ({
  revealable,
  className,
  ...rest
}) => {
  const { settings } = useSettings();
  const pr = settings.passwordReveal ?? {
    enabled: true,
    mode: 'toggle' as const,
    autoHideSeconds: 0,
    showByDefault: false,
    maskIcon: false,
  };

  const isRevealable = revealable ?? pr.enabled;
  const [visible, setVisible] = useState(pr.showByDefault && isRevealable);
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActive = useRef(false);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    };
  }, []);

  // Reset visibility when global settings change
  useEffect(() => {
    if (!isRevealable) setVisible(false);
  }, [isRevealable]);

  const startAutoHide = useCallback(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    if (pr.autoHideSeconds > 0) {
      autoHideTimer.current = setTimeout(() => {
        setVisible(false);
      }, pr.autoHideSeconds * 1000);
    }
  }, [pr.autoHideSeconds]);

  // ── Toggle mode handlers ──────────────────────────────────────
  const handleToggleClick = useCallback(() => {
    if (pr.mode !== 'toggle') return;
    const next = !visible;
    setVisible(next);
    if (next) {
      startAutoHide();
    } else if (autoHideTimer.current) {
      clearTimeout(autoHideTimer.current);
    }
  }, [pr.mode, visible, startAutoHide]);

  // ── Hold mode handlers ────────────────────────────────────────
  const handlePointerDown = useCallback(() => {
    if (pr.mode !== 'hold') return;
    holdActive.current = true;
    setVisible(true);
  }, [pr.mode]);

  const handlePointerUp = useCallback(() => {
    if (pr.mode !== 'hold') return;
    holdActive.current = false;
    setVisible(false);
  }, [pr.mode]);

  // Shared handler for mouse/pointer events on the button
  const buttonHandlers =
    pr.mode === 'hold'
      ? {
          onPointerDown: handlePointerDown,
          onPointerUp: handlePointerUp,
          onPointerLeave: handlePointerUp,
          onPointerCancel: handlePointerUp,
        }
      : {
          onClick: handleToggleClick,
        };

  const IconComponent = visible ? EyeOff : Eye;
  const iconOpacity = !visible && pr.maskIcon ? 'opacity-30' : 'opacity-60';

  return (
    <div className="relative w-full">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={`${className ?? ''} ${isRevealable ? 'pr-9' : ''}`}
      />
      {isRevealable && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded
            text-gray-400 hover:text-gray-200 focus:outline-none transition-colors
            ${iconOpacity}`}
          {...buttonHandlers}
        >
          <IconComponent size={16} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
};

export default PasswordInput;
