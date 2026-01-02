import React, { useState, useRef, useEffect, useCallback } from 'react';
import { debugLog } from '../utils/debugLogger';
import { 
  ArrowLeft, 
  ArrowRight, 
  RotateCcw, 
  ExternalLink, 
  Shield, 
  ShieldAlert,
  Globe,
  Lock,
  AlertTriangle,
  User
} from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { useConnections } from '../contexts/useConnections';

interface WebBrowserProps {
  session: ConnectionSession;
}

export const WebBrowser: React.FC<WebBrowserProps> = ({ session }) => {
  const { state } = useConnections();
  const connection = state.connections.find(c => c.id === session.connectionId);

  // Build a URL and apply basic auth credentials if configured
  const buildUrlWithAuth = useCallback((url: string): string => {
    if (
      connection?.authType === 'basic' &&
      connection.basicAuthUsername &&
      connection.basicAuthPassword
    ) {
      try {
        const parsed = new URL(url);

        // Only inject credentials if not already present
        if (!parsed.username && !parsed.password) {
          parsed.username = connection.basicAuthUsername;
          parsed.password = connection.basicAuthPassword;
        }
        return parsed.toString();
      } catch (error) {
        console.error('Failed to apply basic auth to URL:', error);
      }
    }
    return url;
  }, [connection]);

  const [currentUrl, setCurrentUrl] = useState(() => {
    const protocol = session.protocol === 'https' ? 'https' : 'http';
    const port = session.protocol === 'https' ? 443 : 80;
    const urlPort = port === 80 || port === 443 ? '' : `:${port}`;
    const baseUrl = `${protocol}://${session.hostname}${urlPort}`;
    return buildUrlWithAuth(baseUrl);
  });
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>('');
  const [isSecure, setIsSecure] = useState(session.protocol === 'https');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Rebuild URL with credentials when connection data becomes available
  useEffect(() => {
    if (connection) {
      setCurrentUrl(prev => buildUrlWithAuth(prev));
      setInputUrl(prev => buildUrlWithAuth(prev));
    }
  }, [connection, buildUrlWithAuth]);


  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = inputUrl.trim();

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }

    url = buildUrlWithAuth(url);

    setCurrentUrl(url);
    setIsSecure(url.startsWith('https://'));
    setLoadError('');
    setIsLoading(true);
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    setLoadError('');

    // Handle basic authentication if configured
    if (connection?.authType === 'basic' && connection.basicAuthUsername && connection.basicAuthPassword) {
      try {
        const iframe = iframeRef.current;
        if (iframe && iframe.contentWindow) {
          // Note: Due to CORS restrictions, we can't directly inject auth headers
          // This would need to be handled by a proxy server or browser extension
          debugLog('Basic auth configured for:', connection.basicAuthUsername);
        }
      } catch (error) {
        console.warn('Cannot access iframe content due to CORS restrictions');
      }
    }
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setLoadError('Failed to load the webpage. This might be due to CORS restrictions, authentication requirements, or the site being unavailable.');
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      setIsLoading(true);
      setLoadError('');
      iframeRef.current.src = currentUrl;
    }
  };

  const handleBack = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.history.back();
      } catch (error) {
        console.warn('Cannot access iframe history due to CORS restrictions');
      }
    }
  };

  const handleForward = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.history.forward();
      } catch (error) {
        console.warn('Cannot access iframe history due to CORS restrictions');
      }
    }
  };

  const handleOpenExternal = () => {
    const urlToOpen = buildUrlWithAuth(currentUrl);
    window.open(urlToOpen, '_blank', 'noopener,noreferrer');
  };

  const getSecurityIcon = () => {
    if (isSecure) {
      return <Lock size={14} className="text-green-400" />;
    } else {
      return <ShieldAlert size={14} className="text-yellow-400" />;
    }
  };

  const getAuthIcon = () => {
    if (connection?.authType === 'basic') {
      return <User size={14} className="text-blue-400" title="Basic Authentication" />;
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Browser Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-3">
        {/* Navigation Bar */}
        <div className="flex items-center space-x-3 mb-3">
          <div className="flex space-x-1">
            <button
              onClick={handleBack}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
              title="Back"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              onClick={handleForward}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
              title="Forward"
            >
              <ArrowRight size={16} />
            </button>
            <button
              onClick={handleRefresh}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
              title="Refresh"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          {/* URL Bar */}
          <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                {getSecurityIcon()}
                {getAuthIcon()}
                <Globe size={14} className="text-gray-400" />
              </div>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="w-full pl-16 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                placeholder="Enter URL..."
              />
            </div>
          </form>

          <button
            onClick={handleOpenExternal}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Open in new tab"
          >
            <ExternalLink size={16} />
          </button>
        </div>

        {/* Security Info */}
        <div className="flex items-center space-x-2 text-xs">
          {isSecure ? (
            <div className="flex items-center space-x-1 text-green-400">
              <Shield size={12} />
              <span>Secure connection (HTTPS)</span>
            </div>
          ) : (
            <div className="flex items-center space-x-1 text-yellow-400">
              <AlertTriangle size={12} />
              <span>Not secure (HTTP)</span>
            </div>
          )}
          <span className="text-gray-500">•</span>
          <span className="text-gray-400">Connected to {session.hostname}</span>
          {connection?.authType === 'basic' && (
            <>
              <span className="text-gray-500">•</span>
              <span className="text-blue-400">Basic Auth: {connection.basicAuthUsername}</span>
            </>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
              <p className="text-gray-400">Loading {currentUrl}...</p>
            </div>
          </div>
        )}

        {loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <AlertTriangle size={48} className="text-yellow-400 mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Unable to load webpage</h3>
            <p className="text-gray-400 mb-4 max-w-md">{loadError}</p>
            <div className="space-y-2">
              <button
                onClick={handleRefresh}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                Try Again
              </button>
              <div className="text-sm text-gray-500">
                <p>Common issues:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>The website blocks embedding (X-Frame-Options)</li>
                  <li>CORS restrictions prevent loading</li>
                  <li>Authentication required</li>
                  <li>The server is not responding</li>
                  <li>Invalid URL or hostname</li>
                </ul>
              </div>
              <button
                onClick={handleOpenExternal}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors mx-auto"
              >
                <ExternalLink size={16} />
                <span>Open in New Tab</span>
              </button>
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={currentUrl}
            className="w-full h-full border-0"
            title={session.name}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer-when-downgrade"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        )}
      </div>
    </div>
  );
};
