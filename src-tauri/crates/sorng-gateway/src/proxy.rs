//! # Proxy Engine
//!
//! Connection proxying engine — manages proxy routes and TCP/UDP relay for
//! forwarding connections through the gateway.

use crate::types::*;
use std::collections::HashMap;

/// The proxy engine manages proxy routes and forwards traffic.
pub struct ProxyEngine {
    /// Registered proxy routes indexed by route ID
    routes: HashMap<String, ProxyRoute>,
    /// Port → route_id mapping for quick lookup
    port_map: HashMap<u16, String>,
}

impl Default for ProxyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl ProxyEngine {
    pub fn new() -> Self {
        Self {
            routes: HashMap::new(),
            port_map: HashMap::new(),
        }
    }

    /// Add a new proxy route.
    pub fn add_route(&mut self, route: ProxyRoute) -> Result<(), String> {
        // Check for port conflicts
        if self.port_map.contains_key(&route.listen_port) {
            return Err(format!(
                "Port {} is already in use by another route",
                route.listen_port
            ));
        }

        let route_id = route.id.clone();
        let listen_port = route.listen_port;

        self.routes.insert(route_id.clone(), route);
        self.port_map.insert(listen_port, route_id);

        Ok(())
    }

    /// Remove a proxy route.
    pub fn remove_route(&mut self, route_id: &str) -> Result<(), String> {
        let route = self.routes.remove(route_id).ok_or("Route not found")?;
        self.port_map.remove(&route.listen_port);
        Ok(())
    }

    /// Get a route by ID.
    pub fn get_route(&self, route_id: &str) -> Option<&ProxyRoute> {
        self.routes.get(route_id)
    }

    /// Get a route by listen port.
    pub fn get_route_by_port(&self, port: u16) -> Option<&ProxyRoute> {
        self.port_map
            .get(&port)
            .and_then(|route_id| self.routes.get(route_id))
    }

    /// List all routes.
    pub fn list_routes(&self) -> Vec<&ProxyRoute> {
        self.routes.values().collect()
    }

    /// List only enabled routes.
    pub fn list_enabled_routes(&self) -> Vec<&ProxyRoute> {
        self.routes.values().filter(|r| r.enabled).collect()
    }

    /// Enable or disable a route.
    pub fn set_route_enabled(&mut self, route_id: &str, enabled: bool) -> Result<(), String> {
        let route = self.routes.get_mut(route_id).ok_or("Route not found")?;
        route.enabled = enabled;
        Ok(())
    }

    /// Update a route's target.
    pub fn update_route_target(
        &mut self,
        route_id: &str,
        target_host: String,
        target_port: u16,
    ) -> Result<(), String> {
        let route = self.routes.get_mut(route_id).ok_or("Route not found")?;
        route.target_host = target_host;
        route.target_port = target_port;
        Ok(())
    }

    /// Check if a port is available in the proxy port range.
    pub fn is_port_available(&self, port: u16) -> bool {
        !self.port_map.contains_key(&port)
    }

    /// Find the next available port in a range.
    pub fn next_available_port(&self, start: u16, end: u16) -> Option<u16> {
        (start..=end).find(|&port| !self.port_map.contains_key(&port))
    }

    /// Get the total number of routes.
    pub fn route_count(&self) -> usize {
        self.routes.len()
    }

    /// Get the number of enabled routes.
    pub fn enabled_route_count(&self) -> usize {
        self.routes.values().filter(|r| r.enabled).count()
    }

    /// Resolve a target address for proxying.
    /// Returns (host, port) for the upstream connection.
    pub fn resolve_target(&self, route_id: &str) -> Result<(String, u16), String> {
        let route = self.routes.get(route_id).ok_or("Route not found")?;
        if !route.enabled {
            return Err("Route is disabled".to_string());
        }
        Ok((route.target_host.clone(), route.target_port))
    }
}
