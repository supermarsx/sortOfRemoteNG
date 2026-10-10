        // The native renderer already executes this bundled closure. Invoke its
        // hooks directly: no DOM script sink, Trusted Types policy, or CSP edit.
        injectProxy(enableStyleSheetsProxy, enableCustomElementRegistryProxy);
        {
            // Upstream's non-composed attach event cannot escape an existing
            // shadow root. Feed just those late open hosts into its own discovery
            // callback; retain the engine's conversion/observation pipeline.
            const proto = Element.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(proto, "attachShadow");
            const ownedStyles = staticStyleMap;
            let active = true;
            const attach = function (...args) {
                const root = Reflect.apply(descriptor.value, this, args);
                if (active && root.mode === "open") {
                    const host = this;
                    queueMicrotask(() => {
                        try {
                            if (!active || !host.isConnected || host.ownerDocument !== document) return;
                            let parent = host.getRootNode();
                            const nested = Boolean(parent.host);
                            while (parent.host) {
                                if (parent.host.shadowRoot !== parent) return;
                                parent = parent.host.getRootNode();
                            }
                            if (parent !== document) return;
                            if (nested) elementsDefinitionCallback?.([host]);
                            // Late attachment also bypasses upstream's inline-style
                            // discovery (even at document level). Reuse its watcher
                            // and converter only where no watcher exists yet.
                            const updateInline = element => overrideInlineStyle(
                                element, theme, ignoredInlineSelectors, ignoredImageAnalysisSelectors
                            );
                            const discoverInline = scope => {
                                if (!shadowRootsWithOverrides.has(scope)) createShadowStaticStyleOverrides(scope);
                                getInlineStyleElements(scope).forEach(updateInline);
                            };
                            const watchInline = scope => {
                                if (treeObservers.has(scope)) return;
                                discoverInline(scope);
                                deepWatchForInlineStyles(scope, updateInline, discoverInline);
                            };
                            watchInline(root);
                            iterateShadowHosts(root, element => watchInline(element.shadowRoot));
                            variablesStore.matchVariablesAndDependents();
                        } catch {
                            // Optional appearance work must not emit an uncaught
                            // page error if vendor discovery or a DOM API throws.
                        }
                    });
                }
                return root;
            };
            document.addEventListener("__darkreader__cleanUp", () => {
                active = false;
                // The vendor cleaner runs first and restores its original
                // descriptor. Only unwrap ours if it is still installed.
                if (Object.getOwnPropertyDescriptor(proto, "attachShadow")?.value === attach) {
                    Object.defineProperty(proto, "attachShadow", descriptor);
                }
                // Upstream removes inline/override sheets, but omits the shadow
                // inversion sheet. Retain exact owned nodes, not a page scan.
                shadowRootsWithOverrides.forEach(root => ownedStyles.get(root)?.get("darkreader--invert")?.remove());
            }, { once: true });
            if (descriptor && typeof descriptor.value === "function" && (descriptor.configurable || descriptor.writable)) {
                Object.defineProperty(proto, "attachShadow", { ...descriptor, value: attach });
            }
        }
