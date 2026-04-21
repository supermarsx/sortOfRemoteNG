import { useState, useEffect, useCallback, useRef } from 'react';
import { AutoLockConfig } from '../../types/settings/settings';
import { SecureStorage } from '../../utils/storage/storage';

export function useAutoLockManager(
  config: AutoLockConfig,
  onLock: () => void,
) {
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  // Use a ref instead of state for password to avoid keeping it in React state snapshots
  const passwordRef = useRef('');
  const [passwordVersion, setPasswordVersion] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  // Stable refs to avoid stale closures in the interval/event handlers
  const lastActivityRef = useRef(lastActivity);
  lastActivityRef.current = lastActivity;
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;

  const handleAutoLock = useCallback(() => {
    setIsLocked(true);
    onLock();
  }, [onLock]);

  useEffect(() => {
    if (!config.enabled) return;

    const handleActivity = () => {
      setLastActivity(Date.now());
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach((event) => {
      document.addEventListener(event, handleActivity, true);
    });

    const interval = setInterval(() => {
      const now = Date.now();
      const idleTime = now - lastActivityRef.current;
      const timeoutMs = config.timeoutMinutes * 60 * 1000;
      const remaining = Math.max(0, timeoutMs - idleTime);
      setTimeRemaining(remaining);
      if (remaining === 0 && !isLockedRef.current) {
        handleAutoLock();
      }
    }, 1000);

    // Lock when the page is hidden (suspended) and stays hidden for 1 second
    const handleVisibilityChange = config.lockOnSuspend ? () => {
      if (document.hidden) {
        setTimeout(() => {
          // If STILL hidden after 1s, lock the app
          if (document.hidden) {
            handleAutoLock();
          }
        }, 1000);
      }
    } : null;

    if (handleVisibilityChange) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity, true);
      });
      clearInterval(interval);
      if (handleVisibilityChange) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [config.enabled, config.timeoutMinutes, config.lockOnSuspend, handleAutoLock]);

  const setPassword = useCallback((value: string) => {
    passwordRef.current = value;
    setPasswordVersion(v => v + 1);
  }, []);

  const handleUnlock = useCallback(() => {
    if (config.requirePassword) {
      if (SecureStorage.verifyPassword(passwordRef.current)) {
        setIsLocked(false);
        passwordRef.current = '';
        setPasswordVersion(v => v + 1);
        setLastActivity(Date.now());
      } else {
        alert('Invalid password');
      }
    } else {
      setIsLocked(false);
      setLastActivity(Date.now());
    }
  }, [config.requirePassword]);

  const formatTime = useCallback((ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  return {
    isLocked,
    password: passwordRef.current,
    setPassword,
    showPassword,
    setShowPassword,
    timeRemaining,
    handleAutoLock,
    handleUnlock,
    formatTime,
  };
}
