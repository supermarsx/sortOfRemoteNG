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

  // Check if basic auth is required - when true, ALL requests go through Rust backend
  const requiresBasicAuth = connection?.authType === 'basic' && 
                            connection.basicAuthUsername && 
                            connection.basicAuthPassword;

  // Create a blob URL map for proxied resources
  const blobUrlCache = useRef<Map<string, string>>(new Map());

  // Cleanup blob URLs on unmount
  useEffect(() => {
    const cache = blobUrlCache.current;
    return () => {
      cache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
      cache.clear();
    };
  }, []);

  // Proxy a resource and return a blob URL
  const proxyResource = useCallback(async (url: string): Promise<string> => {
    // Check cache first
    if (blobUrlCache.current.has(url)) {
      return blobUrlCache.current.get(url)!;
    }

    try {
      const response: HttpResponse = await invoke('http_get', {
        url,
        username: requiresBasicAuth ? connection?.basicAuthUsername : null,
        password: requiresBasicAuth ? connection?.basicAuthPassword : null,
        headers: null,
      });

      if (response.status >= 200 && response.status < 400) {
        // Determine MIME type
        const contentType = response.content_type || 'application/octet-stream';
        
        // Convert response body to blob - check if it's binary data (base64)
        let blob: Blob;
        if (contentType.startsWith('image/') || contentType.includes('font') || 
            contentType.includes('application/javascript') || contentType.includes('text/css')) {
          // For binary content, try to decode as base64 if the backend sends it that way
          // Otherwise use the raw body
          try {
            const binaryString = atob(response.body);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            blob = new Blob([bytes], { type: contentType });
          } catch {
            // Not base64, use as text
            blob = new Blob([response.body], { type: contentType });
          }
        } else {
          blob = new Blob([response.body], { type: contentType });
        }
        
        const blobUrl = URL.createObjectURL(blob);
        blobUrlCache.current.set(url, blobUrl);
        return blobUrl;
      }
    } catch (error) {
      console.warn('Failed to proxy resource:', url, error);
    }
    
    return url; // Fall back to original URL
  }, [connection, requiresBasicAuth]);

  // Inject a script to intercept link clicks, form submissions, and resource loading
  const injectNavigationInterceptor = useCallback((html: string, baseUrl: string): string => {
    const interceptorScript = `
      <script>
        (function() {
          // Map to track pending resource proxy requests
          var pendingResources = {};

          // Listen for proxied resource responses from parent
          window.addEventListener('message', function(e) {
            if (e.data && e.data.type === 'resource_proxied') {
              // Find images with matching src or originalSrc and update them
              var imgs = document.querySelectorAll('img[data-original-src="' + e.data.originalUrl + '"], img[src="' + e.data.originalUrl + '"]');
              imgs.forEach(function(img) {
                img.src = e.data.blobUrl;
              });
              // Also try to find by element ID
              if (e.data.elementId && pendingResources[e.data.elementId]) {
                pendingResources[e.data.elementId].src = e.data.blobUrl;
                delete pendingResources[e.data.elementId];
              }
            }
          });

          // Intercept link clicks
          document.addEventListener('click', function(e) {
            var target = e.target;
            while (target && target.tagName !== 'A') {
              target = target.parentElement;
            }
            if (target && target.href && !target.href.startsWith('javascript:') && !target.href.startsWith('#') && !target.href.startsWith('blob:')) {
              e.preventDefault();
              window.parent.postMessage({ type: 'navigate', url: target.href }, '*');
            }
          }, true);

          // Intercept form submissions (both GET and POST)
          document.addEventListener('submit', function(e) {
            var form = e.target;
            e.preventDefault();
            var formData = new FormData(form);
            var url = form.action || window.location.href;
            
            if (form.method && form.method.toLowerCase() === 'post') {
              // For POST, serialize form data
              var data = {};
              formData.forEach(function(value, key) { data[key] = value; });
              window.parent.postMessage({ 
                type: 'form_submit', 
                url: url, 
                method: 'POST',
                data: data
              }, '*');
            } else {
              // GET request
              var params = new URLSearchParams(formData);
              var separator = url.includes('?') ? '&' : '?';
              window.parent.postMessage({ type: 'navigate', url: url + separator + params.toString() }, '*');
            }
          }, true);

          // Request resource proxying for failed images
          document.addEventListener('error', function(e) {
            var target = e.target;
            if (target.tagName === 'IMG' && target.src && !target.src.startsWith('blob:') && !target.src.startsWith('data:') && !target.dataset.proxyAttempted) {
              target.dataset.proxyAttempted = 'true';
              var elementId = target.id || ('img_' + Math.random().toString(36).substr(2, 9));
              pendingResources[elementId] = target;
              window.parent.postMessage({ type: 'proxy_resource', url: target.src, elementId: elementId }, '*');
            }
          }, true);

          // Also proactively try to proxy images that might need auth
          setTimeout(function() {
            document.querySelectorAll('img').forEach(function(img) {
              // Proxy ALL images when basic auth is configured (data-needs-proxy attribute or any external image)
              var needsProxy = img.dataset.needsProxy === 'true' || 
                              (img.src && !img.src.startsWith('blob:') && !img.src.startsWith('data:'));
              if (needsProxy && img.src && !img.dataset.proxyAttempted) {
                img.dataset.proxyAttempted = 'true';
                var elementId = img.id || ('img_' + Math.random().toString(36).substr(2, 9));
                pendingResources[elementId] = img;
                // Stop the browser from loading the image directly (prevents auth dialog)
                var originalSrc = img.src;
                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // Tiny transparent gif
                img.dataset.originalSrc = originalSrc;
                window.parent.postMessage({ type: 'proxy_resource', url: originalSrc, elementId: elementId }, '*');
              }
            });
          }, 50);
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

  // Fetch content via Rust backend with credentials - ALL basic auth requests go through here
  const fetchWithCredentials = useCallback(async (url: string, addToHistory = true, method: string = 'GET', postData?: Record<string, string>) => {
    setIsLoading(true);
    setLoadError('');
    setHtmlContent('');

    try {
      debugLog('WebBrowser', 'Fetching via Rust backend', { url, method, hasAuth: requiresBasicAuth });
      
      // Use http_fetch for full control, or http_get/http_post for simpler requests
      let response: HttpResponse;
      
      if (method === 'POST' && postData) {
        // Use http_post for POST requests
        const body = new URLSearchParams(postData).toString();
        response = await invoke('http_post', {
          url,
          body,
          username: requiresBasicAuth ? connection?.basicAuthUsername : null,
          password: requiresBasicAuth ? connection?.basicAuthPassword : null,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } else {
        // Use http_get for GET requests
        response = await invoke('http_get', {
          url,
          username: requiresBasicAuth ? connection?.basicAuthUsername : null,
          password: requiresBasicAuth ? connection?.basicAuthPassword : null,
          headers: null,
        });
      }

      if (response.status >= 200 && response.status < 400) {
        // Rewrite relative URLs to absolute
        const finalUrl = response.final_url || url;
        const baseUrl = new URL(finalUrl);
        let content = response.body;
        
        // Simple URL rewriting for resources
        content = content.replace(
          /(href|src)=["'](?!https?:\/\/|data:|javascript:|#|blob:)([^"']+)["']/gi,
          (match, attr, path) => {
            const absoluteUrl = new URL(path, baseUrl).href;
            return `${attr}="${absoluteUrl}"`;
          }
        );

        // When basic auth is required, proactively proxy all images to prevent auth dialogs
        if (requiresBasicAuth) {
          // Mark all images for immediate proxying via message events
          // The interceptor script will handle proxying them
          const imgRegex = /<img\s+([^>]*src=["']([^"']+)["'][^>]*)>/gi;
          content = content.replace(imgRegex, (match, attrs, src) => {
            // Skip already processed images (blob: or data:)
            if (src.startsWith('blob:') || src.startsWith('data:')) {
              return match;
            }
            // Add a data attribute to mark for proxying
            return match.replace(/<img\s+/, '<img data-needs-proxy="true" ');
          });
        }

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
        
        debugLog('WebBrowser', 'Content loaded via Rust backend', { finalUrl, status: response.status });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Rust backend fetch failed:', error);
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

  // Listen for navigation messages from the iframe - all go through Rust backend
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (!event.data) return;

      if (event.data.type === 'navigate' && event.data.url) {
        // Navigate to the clicked URL through Rust backend
        fetchWithCredentials(event.data.url);
      } else if (event.data.type === 'form_submit' && event.data.url) {
        // Handle form submission through Rust backend
        if (event.data.method === 'POST') {
          // POST requests go through Rust backend with proper body
          fetchWithCredentials(event.data.url, true, 'POST', event.data.data);
        } else {
          // GET requests with form data
          const params = new URLSearchParams(event.data.data).toString();
          const separator = event.data.url.includes('?') ? '&' : '?';
          fetchWithCredentials(event.data.url + separator + params);
        }
      } else if (event.data.type === 'proxy_resource' && event.data.url) {
        // Proxy the resource through Rust backend and send blob URL back
        const blobUrl = await proxyResource(event.data.url);
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'resource_proxied',
            originalUrl: event.data.url,
            blobUrl: blobUrl,
            elementId: event.data.elementId
          }, '*');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchWithCredentials, proxyResource]);

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