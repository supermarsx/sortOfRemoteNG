import React, { useEffect, useState } from 'react';
import { Monitor, Loader2 } from 'lucide-react';

interface SplashScreenProps {
  isLoading: boolean;
  onLoadComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ isLoading, onLoadComplete }) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing...');
  const [shouldShow, setShouldShow] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (isLoading) {
      // Simulate loading progress
      const statuses = [
        'Loading settings...',
        'Initializing theme...',
        'Preparing workspace...',
        'Loading connections...',
        'Almost ready...',
      ];
      
      let currentProgress = 0;
      const interval = setInterval(() => {
        currentProgress += Math.random() * 15 + 5;
        if (currentProgress >= 100) {
          currentProgress = 100;
          clearInterval(interval);
        }
        setProgress(Math.min(currentProgress, 100));
        
        const statusIndex = Math.min(
          Math.floor((currentProgress / 100) * statuses.length),
          statuses.length - 1
        );
        setStatus(statuses[statusIndex]);
      }, 200);

      return () => clearInterval(interval);
    }
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading && progress >= 100) {
      // Fade out animation
      setFadeOut(true);
      const timeout = setTimeout(() => {
        setShouldShow(false);
        onLoadComplete?.();
      }, 500);
      return () => clearTimeout(timeout);
    } else if (!isLoading) {
      // Force complete progress
      setProgress(100);
      setStatus('Ready!');
    }
  }, [isLoading, progress, onLoadComplete]);

  if (!shouldShow) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-3xl" />
      </div>

      {/* Logo and Content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Animated Logo */}
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
          <div className="relative w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/30">
            <Monitor size={48} className="text-[var(--color-text)]" />
          </div>
          {/* Rotating ring */}
          <div className="absolute -inset-3 border-2 border-blue-500/30 rounded-3xl animate-spin" style={{ animationDuration: '3s' }} />
          <div className="absolute -inset-5 border border-purple-500/20 rounded-[2rem] animate-spin" style={{ animationDuration: '4s', animationDirection: 'reverse' }} />
        </div>

        {/* App Name */}
        <h1 className="text-3xl font-bold text-[var(--color-text)] mb-2 tracking-wide">
          sortOf<span className="text-blue-400">Remote</span>NG
        </h1>
        <p className="text-[var(--color-textSecondary)] text-sm mb-8">Remote Connection Manager</p>

        {/* Progress Bar */}
        <div className="w-64 mb-4">
          <div className="h-1.5 bg-[var(--color-surface)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center space-x-2 text-[var(--color-textSecondary)] text-sm">
          <Loader2 size={14} className={`animate-spin ${!isLoading && progress >= 100 ? 'hidden' : ''}`} />
          <span>{status}</span>
        </div>

        {/* Version */}
        <p className="absolute bottom-8 text-gray-600 text-xs">v0.1.0</p>
      </div>
    </div>
  );
};

export default SplashScreen;
