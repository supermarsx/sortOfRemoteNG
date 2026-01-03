import React, { useState, useRef, useEffect } from 'react';
import { Maximize2, Minimize2, Grid3X3, LayoutGrid, ExternalLink, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { ConnectionSession, TabLayout } from '../types/connection';
import { Resizable } from 'react-resizable';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

interface TabLayoutManagerProps {
  sessions: ConnectionSession[];
  activeSessionId?: string;
  layout: TabLayout;
  onLayoutChange: (layout: TabLayout) => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionDetach: (sessionId: string) => void;
  children: React.ReactNode;
}

export const TabLayoutManager: React.FC<TabLayoutManagerProps> = ({
  sessions,
  activeSessionId,
  layout,
  onLayoutChange,
  onSessionSelect,
  onSessionClose,
  onSessionDetach,
  children,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragSession, setDragSession] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleLayoutModeChange = (mode: TabLayout['mode']) => {
    const newLayout: TabLayout = {
      mode,
      sessions: sessions.map((session, index) => {
        let position;
        
        switch (mode) {
          case 'sideBySide':
            position = {
              x: (index % 2) * 50,
              y: Math.floor(index / 2) * 50,
              width: 50,
              height: 50,
            };
            break;
          case 'mosaic':
            const cols = Math.ceil(Math.sqrt(sessions.length));
            const rows = Math.ceil(sessions.length / cols);
            const colIndex = index % cols;
            const rowIndex = Math.floor(index / cols);
            position = {
              x: (colIndex / cols) * 100,
              y: (rowIndex / rows) * 100,
              width: 100 / cols,
              height: 100 / rows,
            };
            break;
          case 'miniMosaic':
            const miniCols = Math.ceil(Math.sqrt(sessions.length));
            const miniRows = Math.ceil(sessions.length / miniCols);
            const miniColIndex = index % miniCols;
            const miniRowIndex = Math.floor(index / miniCols);
            position = {
              x: (miniColIndex / miniCols) * 100,
              y: (miniRowIndex / miniRows) * 100,
              width: 100 / miniCols,
              height: 100 / miniRows,
            };
            break;
          default: // tabs
            position = {
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            };
        }
        
        return {
          sessionId: session.id,
          position,
        };
      }),
    };
    
    onLayoutChange(newLayout);
  };

  const handleSessionResize = (sessionId: string, width: number, height: number) => {
    const sessionLayout = layout.sessions.find(s => s.sessionId === sessionId);
    if (!sessionLayout) return;

    const newLayout: TabLayout = {
      ...layout,
      sessions: layout.sessions.map(s =>
        s.sessionId === sessionId
          ? {
              ...s,
              position: {
                ...s.position,
                width: (width / (containerRef.current?.clientWidth || 1)) * 100,
                height: (height / (containerRef.current?.clientHeight || 1)) * 100,
              },
            }
          : s
      ),
    };
    
    onLayoutChange(newLayout);
  };

  const handleSessionMove = (sessionId: string, x: number, y: number) => {
    const newLayout: TabLayout = {
      ...layout,
      sessions: layout.sessions.map(s =>
        s.sessionId === sessionId
          ? {
              ...s,
              position: {
                ...s.position,
                x: (x / (containerRef.current?.clientWidth || 1)) * 100,
                y: (y / (containerRef.current?.clientHeight || 1)) * 100,
              },
            }
          : s
      ),
    };
    
    onLayoutChange(newLayout);
  };

  const renderTabsLayout = () => (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="flex bg-gray-800 border-b border-gray-700 overflow-x-auto">
        {sessions.map(session => (
          <div
            key={session.id}
            className={`flex items-center px-4 py-2 border-r border-gray-700 cursor-pointer min-w-0 ${
              session.id === activeSessionId
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700/50'
            }`}
            onClick={() => onSessionSelect(session.id)}
          >
            <span className="truncate mr-2">{session.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSessionClose(session.id);
              }}
              className="text-gray-400 hover:text-white"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      
      {/* Content */}
      <div className="flex-1">
        {children}
      </div>
    </div>
  );

  const renderMosaicLayout = () => (
    <div ref={containerRef} className="relative h-full">
      {layout.sessions.map(sessionLayout => {
        const session = sessions.find(s => s.id === sessionLayout.sessionId);
        if (!session) return null;

        const isActive = session.id === activeSessionId;
        const style = {
          position: 'absolute' as const,
          left: `${sessionLayout.position.x}%`,
          top: `${sessionLayout.position.y}%`,
          width: `${sessionLayout.position.width}%`,
          height: `${sessionLayout.position.height}%`,
          zIndex: isActive ? 10 : 1,
        };

        return (
          <Resizable
            key={session.id}
            width={(sessionLayout.position.width / 100) * (containerRef.current?.clientWidth || 1)}
            height={(sessionLayout.position.height / 100) * (containerRef.current?.clientHeight || 1)}
            onResize={(e, { size }) => {
              handleSessionResize(session.id, size.width, size.height);
            }}
            minConstraints={[200, 150]}
          >
            <div
              style={style}
              className={`border-2 transition-all ${
                isActive ? 'border-blue-500' : 'border-gray-600'
              }`}
              onClick={() => onSessionSelect(session.id)}
            >
              {/* Session Header */}
              <div className="bg-gray-800 border-b border-gray-700 px-2 py-1 flex items-center justify-between">
                <span className="text-white text-sm truncate">{session.name}</span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSessionDetach(session.id);
                    }}
                    className="text-gray-400 hover:text-white"
                    title="Detach"
                  >
                    <ExternalLink size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSessionClose(session.id);
                    }}
                    className="text-gray-400 hover:text-white"
                  >
                    ×
                  </button>
                </div>
              </div>
              
              {/* Session Content */}
              <div className="h-full">
                {isActive && children}
              </div>
            </div>
          </Resizable>
        );
      })}
    </div>
  );

  const renderMiniMosaicLayout = () => (
    <div className="grid grid-cols-4 gap-2 h-full p-2">
      {sessions.map(session => (
        <div
          key={session.id}
          className={`border-2 rounded cursor-pointer transition-all ${
            session.id === activeSessionId
              ? 'border-blue-500 bg-blue-900/20'
              : 'border-gray-600 hover:border-gray-500'
          }`}
          onClick={() => onSessionSelect(session.id)}
        >
          <div className="bg-gray-800 px-2 py-1 text-xs text-white truncate">
            {session.name}
          </div>
          <div className="h-full bg-gray-900 flex items-center justify-center">
            <span className="text-gray-500 text-xs">Preview</span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Layout Controls */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleLayoutModeChange('tabs')}
            className={`p-2 rounded transition-colors ${
              layout.mode === 'tabs' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title="Tabs"
          >
            <Minimize2 size={16} />
          </button>
          
          <button
            onClick={() => handleLayoutModeChange('sideBySide')}
            className={`p-2 rounded transition-colors ${
              layout.mode === 'sideBySide' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title="Side by Side"
          >
            <Maximize2 size={16} />
          </button>
          
          <button
            onClick={() => handleLayoutModeChange('mosaic')}
            className={`p-2 rounded transition-colors ${
              layout.mode === 'mosaic' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title="Mosaic"
          >
            <Grid3X3 size={16} />
          </button>
          
          <button
            onClick={() => handleLayoutModeChange('miniMosaic')}
            className={`p-2 rounded transition-colors ${
              layout.mode === 'miniMosaic' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title="Mini Mosaic"
          >
            <LayoutGrid size={16} />
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-gray-400 text-sm">
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Layout Content */}
      <div className="flex-1 overflow-hidden">
        {layout.mode === 'tabs' && renderTabsLayout()}
        {(layout.mode === 'sideBySide' || layout.mode === 'mosaic') && renderMosaicLayout()}
        {layout.mode === 'miniMosaic' && renderMiniMosaicLayout()}
      </div>
    </div>
  );
};
