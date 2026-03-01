import { useState, useEffect, useCallback } from 'react';
import { AutoLockConfig } from '../types/settings';
import { SecureStorage } from '../utils/storage';

export function useAutoLockManager(
  config: AutoLockConfig,
  onLock: () => void,
) {
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
      const idleTime = now - lastActivity;
      const timeoutMs = config.timeoutMinutes * 60 * 1000;
      const remaining = Math.max(0, timeoutMs - idleTime);
      setTimeRemaining(remaining);
      if (remaining === 0 && !isLocked) {
        handleAutoLock();
      }
    }, 1000);

    if (config.lockOnSuspend) {
      const handleVisibilityChange = () => {
        if (document.hidden) {
          setTimeout(() => {
            if (!document.hidden) {
              handleAutoLock();
            }
          }, 1000);
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        events.forEach((event) => {
          document.removeEventListener(event, handleActivity, true);
        });
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        clearInterval(interval);
      };
    }

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity, true);
      });
      clearInterval(interval);
    };
  }, [config, lastActivity, isLocked, handleAutoLock]);

  const handleUnlock = useCallback(() => {
    if (config.requirePassword) {
      if (SecureStorage.verifyPassword(password)) {
        setIsLocked(false);
        setPassword('');
        setLastActivity(Date.now());
      } else {
        alert('Invalid password');
      }
    } else {
      setIsLocked(false);
      setLastActivity(Date.now());
    }
  }, [config.requirePassword, password]);

  const formatTime = useCallback((ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  return {
    isLocked,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    timeRemaining,
    handleAutoLock,
    handleUnlock,
    formatTime,
  };
}
