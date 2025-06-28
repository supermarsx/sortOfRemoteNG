import React, { useEffect, useRef, useState } from 'react';
import { ConnectionSession } from '../types/connection';
import { 
  Monitor, 
  Maximize2, 
  Minimize2, 
  Settings, 
  Wifi, 
  WifiOff,
  MousePointer,
  Keyboard,
  Volume2,
  VolumeX,
  Copy,
  Clipboard
} from 'lucide-react';

interface RDPClientProps {
  session: ConnectionSession;
}

export const RDPClient: React.FC<RDPClientProps> = ({ session }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    colorDepth: '32',
    resolution: '1024x768',
    audioEnabled: true,
    clipboardEnabled: true,
    compressionEnabled: true,
    encryptionEnabled: true
  });

  useEffect(() => {
    initializeRDPConnection();
    return () => {
      cleanup();
    };
  }, [session]);

  const initializeRDPConnection = async () => {
    if (!canvasRef.current) return;

    try {
      setConnectionStatus('connecting');
      
      // Simulate RDP connection process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Initialize canvas for RDP display
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        // Set canvas size based on resolution setting
        const [width, height] = settings.resolution.split('x').map(Number);
        canvas.width = width;
        canvas.height = height;
        
        // Draw simulated desktop
        drawSimulatedDesktop(ctx, width, height);
        
        setIsConnected(true);
        setConnectionStatus('connected');
      }
    } catch (error) {
      setConnectionStatus('error');
      console.error('RDP connection failed:', error);
    }
  };

  const drawSimulatedDesktop = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // Draw desktop background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1e40af');
    gradient.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Draw taskbar
    ctx.fillStyle = '#374151';
    ctx.fillRect(0, height - 40, width, 40);
    
    // Draw start button
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(5, height - 35, 80, 30);
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.fillText('Start', 15, height - 15);
    
    // Draw system tray
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(width - 100, height - 35, 95, 30);
    
    // Draw time
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(time, width - 60, height - 15);
    
    // Draw desktop icons
    drawDesktopIcon(ctx, 50, 50, 'Computer');
    drawDesktopIcon(ctx, 50, 130, 'Documents');
    drawDesktopIcon(ctx, 50, 210, 'Network');
    
    // Draw window
    drawWindow(ctx, 200, 100, 400, 300, 'Remote Desktop Session');
  };

  const drawDesktopIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, label: string) => {
    // Icon background
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(x, y, 48, 48);
    
    // Icon border
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 48, 48);
    
    // Icon symbol
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('📁', x + 24, y + 32);
    
    // Label
    ctx.fillStyle = 'white';
    ctx.font = '11px Arial';
    ctx.fillText(label, x + 24, y + 65);
    ctx.textAlign = 'left';
  };

  const drawWindow = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, title: string) => {
    // Window background
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(x, y, width, height);
    
    // Title bar
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(x, y, width, 30);
    
    // Title text
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.fillText(title, x + 10, y + 20);
    
    // Window controls
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x + width - 25, y + 5, 20, 20);
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('×', x + width - 15, y + 17);
    ctx.textAlign = 'left';
    
    // Window content
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x + 10, y + 40, width - 20, height - 50);
    
    // Content text
    ctx.fillStyle = '#10b981';
    ctx.font = '12px monospace';
    ctx.fillText('C:\\Users\\Administrator>', x + 20, y + 60);
    ctx.fillText('Microsoft Windows [Version 10.0.19044]', x + 20, y + 80);
    ctx.fillText('(c) Microsoft Corporation. All rights reserved.', x + 20, y + 100);
    ctx.fillText('', x + 20, y + 120);
    ctx.fillText('C:\\Users\\Administrator>_', x + 20, y + 140);
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Scale coordinates to canvas resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;
    
    console.log(`RDP Click at: ${canvasX}, ${canvasY}`);
    
    // Simulate click response
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.arc(canvasX, canvasY, 10, 0, 2 * Math.PI);
      ctx.fill();
      
      setTimeout(() => {
        drawSimulatedDesktop(ctx, canvas.width, canvas.height);
      }, 200);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isConnected) return;
    
    event.preventDefault();
    console.log(`RDP Key: ${event.key}`);
    
    // Handle special key combinations
    if (event.ctrlKey && event.altKey && event.key === 'Delete') {
      console.log('Ctrl+Alt+Del sent to remote session');
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const cleanup = () => {
    setIsConnected(false);
    setConnectionStatus('disconnected');
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <Wifi size={14} />;
      case 'connecting': return <Wifi size={14} className="animate-pulse" />;
      default: return <WifiOff size={14} />;
    }
  };

  return (
    <div className={`flex flex-col bg-gray-900 ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      {/* RDP Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Monitor size={16} className="text-blue-400" />
          <span className="text-sm text-gray-300">
            RDP - {session.hostname}
          </span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-xs capitalize">{connectionStatus}</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 text-xs text-gray-400">
            <span>{settings.resolution}</span>
            <span>•</span>
            <span>{settings.colorDepth}-bit</span>
          </div>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="RDP Settings"
          >
            <Settings size={14} />
          </button>
          
          <button
            onClick={toggleFullscreen}
            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-800 border-b border-gray-700 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <label className="block text-gray-300 mb-1">Resolution</label>
              <select
                value={settings.resolution}
                onChange={(e) => setSettings({...settings, resolution: e.target.value})}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
              >
                <option value="800x600">800x600</option>
                <option value="1024x768">1024x768</option>
                <option value="1280x1024">1280x1024</option>
                <option value="1920x1080">1920x1080</option>
              </select>
            </div>
            
            <div>
              <label className="block text-gray-300 mb-1">Color Depth</label>
              <select
                value={settings.colorDepth}
                onChange={(e) => setSettings({...settings, colorDepth: e.target.value})}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
              >
                <option value="16">16-bit</option>
                <option value="24">24-bit</option>
                <option value="32">32-bit</option>
              </select>
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.audioEnabled}
                onChange={(e) => setSettings({...settings, audioEnabled: e.target.checked})}
                className="rounded"
              />
              <label className="text-gray-300 text-xs">Audio</label>
              {settings.audioEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.clipboardEnabled}
                onChange={(e) => setSettings({...settings, clipboardEnabled: e.target.checked})}
                className="rounded"
              />
              <label className="text-gray-300 text-xs">Clipboard</label>
              <Clipboard size={12} />
            </div>
          </div>
        </div>
      )}

      {/* RDP Canvas */}
      <div className="flex-1 flex items-center justify-center bg-black p-4">
        {connectionStatus === 'connecting' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
            <p className="text-gray-400">Connecting to RDP server...</p>
            <p className="text-gray-500 text-sm mt-2">{session.hostname}</p>
          </div>
        )}
        
        {connectionStatus === 'error' && (
          <div className="text-center">
            <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
            <p className="text-red-400 mb-2">RDP Connection Failed</p>
            <p className="text-gray-500 text-sm">Unable to connect to {session.hostname}</p>
          </div>
        )}
        
        {connectionStatus === 'connected' && (
          <canvas
            ref={canvasRef}
            className="border border-gray-600 cursor-crosshair max-w-full max-h-full"
            onClick={handleCanvasClick}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            style={{
              imageRendering: 'pixelated',
              objectFit: 'contain'
            }}
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center space-x-4">
          <span>Session: {session.id.slice(0, 8)}</span>
          <span>Protocol: RDP</span>
          {isConnected && (
            <>
              <span>Encryption: {settings.encryptionEnabled ? 'Enabled' : 'Disabled'}</span>
              <span>Compression: {settings.compressionEnabled ? 'On' : 'Off'}</span>
            </>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <MousePointer size={12} />
          <Keyboard size={12} />
          {settings.audioEnabled && <Volume2 size={12} />}
          {settings.clipboardEnabled && <Copy size={12} />}
        </div>
      </div>
    </div>
  );
};