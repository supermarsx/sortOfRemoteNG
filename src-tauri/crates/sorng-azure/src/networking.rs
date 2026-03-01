//! Azure Networking – VNets, subnets, NSGs, public IPs, NICs, load balancers.

use log::debug;

use crate::client::AzureClient;
use crate::types::{
    AzureResult, LoadBalancer, NetworkInterface, NetworkSecurityGroup, PublicIpAddress,
    Subnet, VirtualNetwork,
};

// ─── Virtual Networks ───────────────────────────────────────────────

pub async fn list_vnets(client: &AzureClient) -> AzureResult<Vec<VirtualNetwork>> {
    let api = &client.config().api_version_network;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Network/virtualNetworks?api-version={}",
        api
    ))?;
    debug!("list_vnets → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_vnets_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<VirtualNetwork>> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/virtualNetworks?api-version={}",
        api
    ))?;
    debug!("list_vnets_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_vnet(
    client: &AzureClient,
    rg: &str,
    vnet_name: &str,
) -> AzureResult<VirtualNetwork> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/virtualNetworks/{}?api-version={}",
        vnet_name, api
    ))?;
    debug!("get_vnet({}/{}) → {}", rg, vnet_name, url);
    client.get_json(&url).await
}

pub async fn delete_vnet(
    client: &AzureClient,
    rg: &str,
    vnet_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/virtualNetworks/{}?api-version={}",
        vnet_name, api
    ))?;
    debug!("delete_vnet({}/{}) → {}", rg, vnet_name, url);
    client.delete(&url).await
}

// ─── Subnets ────────────────────────────────────────────────────────

pub async fn list_subnets(
    client: &AzureClient,
    rg: &str,
    vnet_name: &str,
) -> AzureResult<Vec<Subnet>> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/virtualNetworks/{}/subnets?api-version={}",
        vnet_name, api
    ))?;
    debug!("list_subnets({}/{}) → {}", rg, vnet_name, url);
    client.get_all_pages(&url).await
}

pub async fn get_subnet(
    client: &AzureClient,
    rg: &str,
    vnet_name: &str,
    subnet_name: &str,
) -> AzureResult<Subnet> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/virtualNetworks/{}/subnets/{}?api-version={}",
        vnet_name, subnet_name, api
    ))?;
    debug!("get_subnet({}/{}/{}) → {}", rg, vnet_name, subnet_name, url);
    client.get_json(&url).await
}

// ─── Network Security Groups ────────────────────────────────────────

pub async fn list_nsgs(client: &AzureClient) -> AzureResult<Vec<NetworkSecurityGroup>> {
    let api = &client.config().api_version_network;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Network/networkSecurityGroups?api-version={}",
        api
    ))?;
    debug!("list_nsgs → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_nsgs_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<NetworkSecurityGroup>> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/networkSecurityGroups?api-version={}",
        api
    ))?;
    debug!("list_nsgs_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_nsg(
    client: &AzureClient,
    rg: &str,
    nsg_name: &str,
) -> AzureResult<NetworkSecurityGroup> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/networkSecurityGroups/{}?api-version={}",
        nsg_name, api
    ))?;
    debug!("get_nsg({}/{}) → {}", rg, nsg_name, url);
    client.get_json(&url).await
}

pub async fn delete_nsg(
    client: &AzureClient,
    rg: &str,
    nsg_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/networkSecurityGroups/{}?api-version={}",
        nsg_name, api
    ))?;
    debug!("delete_nsg({}/{}) → {}", rg, nsg_name, url);
    client.delete(&url).await
}

// ─── Public IP Addresses ────────────────────────────────────────────

pub async fn list_public_ips(client: &AzureClient) -> AzureResult<Vec<PublicIpAddress>> {
    let api = &client.config().api_version_network;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Network/publicIPAddresses?api-version={}",
        api
    ))?;
    debug!("list_public_ips → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_public_ips_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<PublicIpAddress>> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/publicIPAddresses?api-version={}",
        api
    ))?;
    debug!("list_public_ips_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_public_ip(
    client: &AzureClient,
    rg: &str,
    pip_name: &str,
) -> AzureResult<PublicIpAddress> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/publicIPAddresses/{}?api-version={}",
        pip_name, api
    ))?;
    debug!("get_public_ip({}/{}) → {}", rg, pip_name, url);
    client.get_json(&url).await
}

pub async fn delete_public_ip(
    client: &AzureClient,
    rg: &str,
    pip_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/publicIPAddresses/{}?api-version={}",
        pip_name, api
    ))?;
    debug!("delete_public_ip({}/{}) → {}", rg, pip_name, url);
    client.delete(&url).await
}

// ─── Network Interfaces ─────────────────────────────────────────────

pub async fn list_nics(client: &AzureClient) -> AzureResult<Vec<NetworkInterface>> {
    let api = &client.config().api_version_network;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Network/networkInterfaces?api-version={}",
        api
    ))?;
    debug!("list_nics → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_nics_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<NetworkInterface>> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/networkInterfaces?api-version={}",
        api
    ))?;
    debug!("list_nics_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_nic(
    client: &AzureClient,
    rg: &str,
    nic_name: &str,
) -> AzureResult<NetworkInterface> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/networkInterfaces/{}?api-version={}",
        nic_name, api
    ))?;
    debug!("get_nic({}/{}) → {}", rg, nic_name, url);
    client.get_json(&url).await
}

// ─── Load Balancers ─────────────────────────────────────────────────

pub async fn list_load_balancers(client: &AzureClient) -> AzureResult<Vec<LoadBalancer>> {
    let api = &client.config().api_version_network;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Network/loadBalancers?api-version={}",
        api
    ))?;
    debug!("list_load_balancers → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_load_balancers_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<LoadBalancer>> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/loadBalancers?api-version={}",
        api
    ))?;
    debug!("list_load_balancers_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_load_balancer(
    client: &AzureClient,
    rg: &str,
    lb_name: &str,
) -> AzureResult<LoadBalancer> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/loadBalancers/{}?api-version={}",
        lb_name, api
    ))?;
    debug!("get_load_balancer({}/{}) → {}", rg, lb_name, url);
    client.get_json(&url).await
}

pub async fn delete_load_balancer(
    client: &AzureClient,
    rg: &str,
    lb_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_network;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Network/loadBalancers/{}?api-version={}",
        lb_name, api
    ))?;
    debug!("delete_load_balancer({}/{}) → {}", rg, lb_name, url);
    client.delete(&url).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AzureCredentials;

    #[test]
    fn vnet_url_pattern() {
        let mut c = AzureClient::new();
        c.set_credentials(AzureCredentials { subscription_id: "s1".into(), ..Default::default() });
        let url = c.resource_group_url("rg1", "/providers/Microsoft.Network/virtualNetworks?api-version=2024-01-01").unwrap();
        assert!(url.contains("virtualNetworks"));
    }

    #[test]
    fn vnet_deserialize() {
        let json = r#"{"id":"x","name":"vnet1","location":"eastus","tags":{},"properties":{"addressSpace":{"addressPrefixes":["10.0.0.0/16"]},"subnets":[],"provisioningState":"Succeeded"}}"#;
        let v: VirtualNetwork = serde_json::from_str(json).unwrap();
        assert_eq!(v.name, "vnet1");
        let props = v.properties.unwrap();
        assert_eq!(
            props.address_space.unwrap().address_prefixes,
            vec!["10.0.0.0/16"]
        );
    }

    #[test]
    fn nsg_deserialize() {
        let json = r#"{"id":"x","name":"nsg1","location":"eastus","tags":{},"properties":{"securityRules":[],"provisioningState":"Succeeded"}}"#;
        let nsg: NetworkSecurityGroup = serde_json::from_str(json).unwrap();
        assert_eq!(nsg.name, "nsg1");
    }

    #[test]
    fn public_ip_deserialize() {
        let json = r#"{"id":"x","name":"pip1","location":"eastus","properties":{"ipAddress":"20.1.2.3","publicIPAllocationMethod":"Static"}}"#;
        let pip: PublicIpAddress = serde_json::from_str(json).unwrap();
        assert_eq!(pip.name, "pip1");
        assert_eq!(pip.properties.unwrap().ip_address, Some("20.1.2.3".into()));
    }

    #[test]
    fn nic_deserialize() {
        let json = r#"{"id":"x","name":"nic1","location":"eastus","properties":{"ipConfigurations":[],"macAddress":"00-01-02-03-04-05"}}"#;
        let nic: NetworkInterface = serde_json::from_str(json).unwrap();
        assert_eq!(nic.name, "nic1");
        assert_eq!(nic.properties.unwrap().mac_address, Some("00-01-02-03-04-05".into()));
    }

    #[test]
    fn lb_deserialize() {
        let json = r#"{"id":"x","name":"lb1","location":"eastus","tags":{},"sku":{"name":"Standard"}}"#;
        let lb: LoadBalancer = serde_json::from_str(json).unwrap();
        assert_eq!(lb.name, "lb1");
        assert_eq!(lb.sku.unwrap().name, Some("Standard".into()));
    }
}
