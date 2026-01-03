import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Clock, Shield, Eye, EyeOff } from 'lucide-react';
import { AutoLockConfig } from '../types/settings';

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

    // Listen for user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => {
      document.addEventListener(event, handleActivity, true);
    });

    // Check for idle timeout
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

    // Listen for system suspend/resume
    if (config.lockOnSuspend) {
      const handleVisibilityChange = () => {
        if (document.hidden) {
          // System might be suspending
          setTimeout(() => {
            if (!document.hidden) {
              // System resumed, lock if configured
              handleAutoLock();
            }
          }, 1000);
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        events.forEach(event => {
          document.removeEventListener(event, handleActivity, true);
        });
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        clearInterval(interval);
      };
    }

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleActivity, true);
      });
      clearInterval(interval);
    };
  }, [config, lastActivity, isLocked, handleAutoLock]);

  const handleUnlock = () => {
    if (config.requirePassword) {
      // In a real implementation, verify password against stored hash
      if (password === 'admin') { // Simplified for demo
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
  };

  const formatTime = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (isLocked) {
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
        <div className="bg-gray-800 rounded-lg p-8 w-96 text-center">
          <Lock size={64} className="mx-auto mb-6 text-blue-400" />
          <h2 className="text-2xl font-semibold text-white mb-4">Session Locked</h2>
          <p className="text-gray-400 mb-6">
            Your session has been locked due to inactivity.
          </p>

          {config.requirePassword ? (
            <div className="space-y-4">
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleUnlock()}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter password to unlock"
                  autoFocus
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button
                onClick={handleUnlock}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                Unlock
              </button>
            </div>
          ) : (
            <button
              onClick={handleUnlock}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              Click to Unlock
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!config.enabled) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm">
      <div className="flex items-center space-x-2">
        <Clock size={16} className="text-blue-400" />
        <span className="text-gray-300">
          Auto-lock in: {formatTime(timeRemaining)}
        </span>
        <button
          onClick={handleAutoLock}
          className="text-gray-400 hover:text-white"
          title="Lock now"
        >
          <Lock size={14} />
        </button>
      </div>
    </div>
  );
};
