import React, { useEffect, useRef, useState, useCallback } from 'react';
import { debugLog } from '../utils/debugLogger';
import { ConnectionSession } from '../types/connection';
import { drawSimulatedDesktop } from './rdpCanvas';
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
import { invoke } from '@tauri-apps/api/core';
import { useConnections } from '../contexts/useConnections';

interface RDPClientProps {
  session: ConnectionSession;
}

const RDPClient: React.FC<RDPClientProps> = ({ session }) => {
  const { state } = useConnections();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    resolution: '1024x768',
    colorDepth: 32,
    audioEnabled: true,
    clipboardEnabled: true,
    compressionEnabled: true,
    encryptionEnabled: true
  });

  // Get connection details
  const connection = state.connections.find(c => c.id === session.connectionId);

  const initializeRDPConnection = useCallback(async () => {
    if (!connection) return;

    try {
      setConnectionStatus('connecting');

      // Get connection details
      const connectionDetails = {
        host: session.hostname,
        port: connection.port || 3389, // Use connection port or default RDP port
        username: connection.username || '',
        password: connection.password || ''
      };

      debugLog(`Attempting RDP connection to ${connectionDetails.host}:${connectionDetails.port}`);

      // Try to connect using Tauri RDP service
      try {
        const sessionId = await invoke('connect_rdp', {
          host: connectionDetails.host,
          port: connectionDetails.port,
          username: connectionDetails.username,
          password: connectionDetails.password
        }) as string;

        debugLog(`RDP session established: ${sessionId}`);
        
        // Set connected status first
        setIsConnected(true);
        setConnectionStatus('connected');
        
        // Initialize canvas for RDP display
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error('Canvas not available');
        }
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          // Set canvas size based on resolution setting
          const [width, height] = settings.resolution.split('x').map(Number);
          canvas.width = width;
          canvas.height = height;
          
          // For now, show a connection message since we don't have real RDP rendering
          ctx.fillStyle = '#1f2937';
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = '#10b981';
          ctx.font = '24px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('RDP Connected', width / 2, height / 2);
          ctx.fillText(`Session: ${sessionId}`, width / 2, height / 2 + 40);
        }
      } catch (rdpError) {
        debugLog(`RDP connection failed, falling back to simulation: ${rdpError}`);
        
        // Fallback to simulation if RDP service fails
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Set connected status for simulation
        setIsConnected(true);
        setConnectionStatus('connected');
        
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error('Canvas not available');
        }
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          const [width, height] = settings.resolution.split('x').map(Number);
          canvas.width = width;
          canvas.height = height;
          
          try {
            // Draw simulated desktop with error message
            drawSimulatedDesktop(ctx, width, height);
            
            ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
            ctx.fillRect(10, 10, 300, 60);
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'left';
            ctx.fillText('RDP Connection Failed', 20, 30);
            ctx.fillText('Using simulation mode', 20, 50);
          } catch (simError) {
            throw simError; // Re-throw to be caught by outer catch
          }
        }
      }
    } catch (error) {
      setConnectionStatus('error');
      console.error('RDP initialization failed:', error);
    }
  }, [session, connection, settings.resolution]);

  const cleanup = useCallback(() => {
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, []);

  useEffect(() => {
    initializeRDPConnection();
    return () => {
      cleanup();
    };
  }, [session, initializeRDPConnection, cleanup]);


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
    
    debugLog(`RDP Click at: ${canvasX}, ${canvasY}`);
    
    // Simulate click response
    if (!canvas) return;
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
    debugLog(`RDP Key: ${event.key}`);
    
    // Handle special key combinations
    if (event.ctrlKey && event.altKey && event.key === 'Delete') {
      debugLog('Ctrl+Alt+Del sent to remote session');
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
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
                onChange={(e) => setSettings({...settings, colorDepth: parseInt(e.target.value)})}
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
      <div className="flex-1 flex items-center justify-center bg-black p-4 relative">
        <canvas
          ref={canvasRef}
          className="border border-gray-600 cursor-crosshair max-w-full max-h-full"
          onClick={handleCanvasClick}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          width={parseInt(settings.resolution.split('x')[0])}
          height={parseInt(settings.resolution.split('x')[1])}
          style={{
            imageRendering: 'pixelated',
            objectFit: 'contain',
            display: connectionStatus === 'connected' ? 'block' : 'none'
          }}
        />
        
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

export default RDPClient;
