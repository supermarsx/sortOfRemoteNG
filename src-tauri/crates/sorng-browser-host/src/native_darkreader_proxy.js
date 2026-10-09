        // The native renderer already executes this bundled closure. Invoke its
        // hooks directly: no DOM script sink, Trusted Types policy, or CSP edit.
        injectProxy(enableStyleSheetsProxy, enableCustomElementRegistryProxy);
