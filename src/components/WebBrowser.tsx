import React, { useState, useRef, useEffect, useCallback } from 'react';
import { debugLog } from '../utils/debugLogger';
import { invoke } from '@tauri-apps/api/core';
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

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  content_type: string | null;
  final_url: string;
  response_time_ms: number;
}

interface WebBrowserProps {
  session: ConnectionSession;
}

export const WebBrowser: React.FC<WebBrowserProps> = ({ session }) => {
  const { state } = useConnections();
  const connection = state.connections.find(c => c.id === session.connectionId);

  const [currentUrl, setCurrentUrl] = useState(() => {
    const protocol = session.protocol === 'https' ? 'https' : 'http';
    const port = session.protocol === 'https' ? 443 : 80;
    const urlPort = port === 80 || port === 443 ? '' : `:${port}`;
    const baseUrl = `${protocol}://${session.hostname}${urlPort}`;
    return baseUrl;
  });
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>('');
  const [isSecure, setIsSecure] = useState(session.protocol === 'https');
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [useProxy, setUseProxy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const iconCount = 2 + (connection?.authType === 'basic' ? 1 : 0);
  const iconPadding = 12 + iconCount * 18;

  // Check if basic auth is required
  const requiresBasicAuth = connection?.authType === 'basic' && 
                            connection.basicAuthUsername && 
                            connection.basicAuthPassword;

  // Inject a script to intercept link clicks and form submissions in proxy mode
  const injectNavigationInterceptor = useCallback((html: string, baseUrl: string): string => {
    const interceptorScript = `
      <script>
        (function() {
          // Intercept link clicks
          document.addEventListener('click', function(e) {
            var target = e.target;
            while (target && target.tagName !== 'A') {
              target = target.parentElement;
            }
            if (target && target.href && !target.href.startsWith('javascript:') && !target.href.startsWith('#')) {
              e.preventDefault();
              window.parent.postMessage({ type: 'navigate', url: target.href }, '*');
            }
          }, true);

          // Intercept form submissions
          document.addEventListener('submit', function(e) {
            var form = e.target;
            if (form.method && form.method.toLowerCase() === 'get') {
              e.preventDefault();
              var formData = new FormData(form);
              var params = new URLSearchParams(formData);
              var url = form.action || window.location.href;
              var separator = url.includes('?') ? '&' : '?';
              window.parent.postMessage({ type: 'navigate', url: url + separator + params.toString() }, '*');
            }
          }, true);
        })();
      </script>
    `;
    
    // Insert the script before </body> or at the end
    if (html.includes('</body>')) {
      return html.replace('</body>', interceptorScript + '</body>');
    } else if (html.includes('</html>')) {
      return html.replace('</html>', interceptorScript + '</html>');
    } else {
      return html + interceptorScript;
    }
  }, []);

  // Fetch content via Tauri backend with credentials
  const fetchWithCredentials = useCallback(async (url: string, addToHistory = true) => {
    setIsLoading(true);
    setLoadError('');
    setHtmlContent('');

    try {
      const response: HttpResponse = await invoke('http_get', {
        url,
        username: requiresBasicAuth ? connection?.basicAuthUsername : null,
        password: requiresBasicAuth ? connection?.basicAuthPassword : null,
        headers: null,
      });

      if (response.status >= 200 && response.status < 400) {
        // Rewrite relative URLs to absolute
        const finalUrl = response.final_url || url;
        const baseUrl = new URL(finalUrl);
        let content = response.body;
        
        // Simple URL rewriting for resources
        content = content.replace(
          /(href|src)=["'](?!https?:\/\/|data:|javascript:|#)([^"']+)["']/gi,
          (match, attr, path) => {
            const absoluteUrl = new URL(path, baseUrl).href;
            return `${attr}="${absoluteUrl}"`;
          }
        );

        // Inject navigation interceptor for proxy mode
        content = injectNavigationInterceptor(content, finalUrl);

        setHtmlContent(content);
        setCurrentUrl(finalUrl);
        setInputUrl(finalUrl);
        setUseProxy(true);
        
        // Update history
        if (addToHistory) {
          setHistory(prev => {
            const newHistory = prev.slice(0, historyIndex + 1);
            newHistory.push(finalUrl);
            return newHistory;
          });
          setHistoryIndex(prev => prev + 1);
        }
        
        debugLog('Content loaded via proxy with credentials:', finalUrl);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Proxy fetch failed:', error);
      setLoadError(`Failed to load page: ${error instanceof Error ? error.message : String(error)}`);
      // Fall back to iframe only if basic auth is not required
      if (!requiresBasicAuth) {
        setUseProxy(false);
        setHtmlContent('');
      }
    } finally {
      setIsLoading(false);
    }
  }, [connection, requiresBasicAuth, injectNavigationInterceptor, historyIndex]);

  // Listen for navigation messages from the iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'navigate' && event.data.url) {
        // Navigate to the clicked URL through the proxy
        fetchWithCredentials(event.data.url);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchWithCredentials]);

  // Initial load with credentials if configured
  useEffect(() => {
    if (requiresBasicAuth) {
      fetchWithCredentials(currentUrl);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = inputUrl.trim();

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }

    setCurrentUrl(url);
    setIsSecure(url.startsWith('https://'));
    setLoadError('');
    
    // Use proxy if auth is configured
    if (requiresBasicAuth) {
      fetchWithCredentials(url);
    } else {
      setUseProxy(false);
      setHtmlContent('');
      setIsLoading(true);
    }
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    setLoadError('');
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setLoadError('Failed to load the webpage. This might be due to CORS restrictions, authentication requirements, or the site being unavailable.');
  };

  const handleRefresh = () => {
    if (useProxy && requiresBasicAuth) {
      fetchWithCredentials(currentUrl, false);
    } else if (iframeRef.current) {
      setIsLoading(true);
      setLoadError('');
      iframeRef.current.src = currentUrl;
    }
  };

  const canGoBack = useProxy ? historyIndex > 0 : true;
  const canGoForward = useProxy ? historyIndex < history.length - 1 : true;

  const handleBack = () => {
    if (useProxy && requiresBasicAuth) {
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        fetchWithCredentials(history[newIndex], false);
      }
    } else if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.history.back();
      } catch (error) {
        console.warn('Cannot access iframe history due to CORS restrictions');
      }
    }
  };

  const handleForward = () => {
    if (useProxy && requiresBasicAuth) {
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        fetchWithCredentials(history[newIndex], false);
      }
    } else if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.history.forward();
      } catch (error) {
        console.warn('Cannot access iframe history due to CORS restrictions');
      }
    }
  };

  const handleOpenExternal = () => {
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
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
      return <span data-tooltip="Basic Authentication"><User size={14} className="text-blue-400" /></span>;
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
              disabled={!canGoBack}
              className={`p-2 rounded transition-colors ${
                canGoBack 
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-white' 
                  : 'text-gray-600 cursor-not-allowed'
              }`}
              title="Back"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              onClick={handleForward}
              disabled={!canGoForward}
              className={`p-2 rounded transition-colors ${
                canGoForward 
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-white' 
                  : 'text-gray-600 cursor-not-allowed'
              }`}
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
                className="w-full pr-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                style={{ paddingLeft: `${iconPadding}px` }}
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
        ) : useProxy && htmlContent ? (
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            className="w-full h-full border-0"
            title={session.name}
            onLoad={handleIframeLoad}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
          />
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