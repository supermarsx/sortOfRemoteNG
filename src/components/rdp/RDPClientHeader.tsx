import React from 'react';
import {
  Monitor,
  Activity,
  Settings,
  Camera,
  ClipboardCopy,
  Circle,
  Play,
  Pause,
  Square,
  Search,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface RDPClientHeaderProps {
  sessionName: string;
  sessionHostname: string;
  connectionStatus: string;
  statusMessage: string;
  desktopSize: { width: number; height: number };
  colorDepth: number;
  perfLabel: string;
  magnifierEnabled: boolean;
  magnifierActive: boolean;
  showInternals: boolean;
  showSettings: boolean;
  isFullscreen: boolean;
  recState: { isRecording: boolean; isPaused: boolean; duration: number };
  getStatusColor: () => string;
  getStatusIcon: () => React.ReactNode;
  setMagnifierActive: (v: boolean) => void;
  setShowInternals: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  handleScreenshot: () => void;
  handleScreenshotToClipboard: () => void;
  handleStopRecording: () => void;
  toggleFullscreen: () => void;
  startRecording: (format: string) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function RDPClientHeader({
  sessionName,
  sessionHostname,
  connectionStatus,
  statusMessage,
  desktopSize,
  colorDepth,
  perfLabel,
  magnifierEnabled,
  magnifierActive,
  showInternals,
  showSettings,
  isFullscreen,
  recState,
  getStatusColor,
  getStatusIcon,
  setMagnifierActive,
  setShowInternals,
  setShowSettings,
  handleScreenshot,
  handleScreenshotToClipboard,
  handleStopRecording,
  toggleFullscreen,
  startRecording,
  pauseRecording,
  resumeRecording,
}: RDPClientHeaderProps) {
  return (
    <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <Monitor size={16} className="text-blue-400" />
        <span className="text-sm text-gray-300">
          RDP - {sessionName !== sessionHostname ? `${sessionName} (${sessionHostname})` : sessionHostname}
        </span>
        <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
          {getStatusIcon()}
          <span className="text-xs capitalize">{connectionStatus}</span>
        </div>
        {statusMessage && (
          <span className="text-xs text-gray-500 ml-2 truncate max-w-xs">{statusMessage}</span>
        )}
      </div>

      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1 text-xs text-gray-400">
          <span>{desktopSize.width}x{desktopSize.height}</span>
          <span>•</span>
          <span>{colorDepth}-bit</span>
          <span>•</span>
          <span className="capitalize">{perfLabel}</span>
        </div>

        {magnifierEnabled && (
          <button
            onClick={() => setMagnifierActive(!magnifierActive)}
            className={`p-1 hover:bg-gray-700 rounded transition-colors ${magnifierActive ? 'text-blue-400 bg-gray-700' : 'text-gray-400 hover:text-white'}`}
            title="Magnifier Glass"
          >
            <Search size={14} />
          </button>
        )}

        <button
          onClick={() => setShowInternals(!showInternals)}
          className={`p-1 hover:bg-gray-700 rounded transition-colors ${showInternals ? 'text-green-400 bg-gray-700' : 'text-gray-400 hover:text-white'}`}
          title="RDP Internals"
        >
          <Activity size={14} />
        </button>

        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
          title="RDP Settings"
        >
          <Settings size={14} />
        </button>

        {/* Screenshot to file */}
        <button
          onClick={handleScreenshot}
          className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
          title="Save screenshot to file"
        >
          <Camera size={14} />
        </button>
        {/* Screenshot to clipboard */}
        <button
          onClick={handleScreenshotToClipboard}
          className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
          title="Copy screenshot to clipboard"
        >
          <ClipboardCopy size={14} />
        </button>

        {/* Recording */}
        {!recState.isRecording ? (
          <button
            onClick={() => startRecording('webm')}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-red-400"
            title="Start recording"
          >
            <Circle size={14} className="fill-current" />
          </button>
        ) : (
          <div className="flex items-center space-x-1">
            <span className="text-[10px] text-red-400 animate-pulse font-mono">
              REC {formatDuration(recState.duration)}
            </span>
            {recState.isPaused ? (
              <button
                onClick={resumeRecording}
                className="p-1 hover:bg-gray-700 rounded text-yellow-400"
                title="Resume recording"
              >
                <Play size={12} />
              </button>
            ) : (
              <button
                onClick={pauseRecording}
                className="p-1 hover:bg-gray-700 rounded text-yellow-400"
                title="Pause recording"
              >
                <Pause size={12} />
              </button>
            )}
            <button
              onClick={handleStopRecording}
              className="p-1 hover:bg-gray-700 rounded text-red-400"
              title="Stop and save recording"
            >
              <Square size={12} className="fill-current" />
            </button>
          </div>
        )}

        <button
          onClick={toggleFullscreen}
          className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
}
