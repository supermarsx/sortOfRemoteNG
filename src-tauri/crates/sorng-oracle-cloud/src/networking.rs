use crate::client::OciClient;
use crate::error::OciResult;
use crate::types::{
    OciInternetGateway, OciLoadBalancer, OciNatGateway, OciNetworkSecurityGroup, OciRouteTable,
    OciSecurityList, OciSubnet, OciVcn,
};

/// Networking operations for VCNs, subnets, security lists, gateways, and load balancers.
pub struct NetworkingManager;

impl NetworkingManager {
    // ── VCNs ─────────────────────────────────────────────────────────

    pub async fn list_vcns(client: &OciClient, compartment_id: &str) -> OciResult<Vec<OciVcn>> {
        client
            .get(
                "iaas",
                &format!("/20160918/vcns?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_vcn(client: &OciClient, vcn_id: &str) -> OciResult<OciVcn> {
        client
            .get("iaas", &format!("/20160918/vcns/{vcn_id}"))
            .await
    }

    pub async fn create_vcn(
        client: &OciClient,
        compartment_id: &str,
        display_name: &str,
        cidr_block: &str,
    ) -> OciResult<OciVcn> {
        client
            .post(
                "iaas",
                "/20160918/vcns",
                &serde_json::json!({
                    "compartmentId": compartment_id,
                    "displayName": display_name,
                    "cidrBlock": cidr_block,
                }),
            )
            .await
    }

    pub async fn delete_vcn(client: &OciClient, vcn_id: &str) -> OciResult<()> {
        client
            .delete("iaas", &format!("/20160918/vcns/{vcn_id}"))
            .await
    }

    // ── Subnets ──────────────────────────────────────────────────────

    pub async fn list_subnets(
        client: &OciClient,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciSubnet>> {
        let mut path = format!("/20160918/subnets?compartmentId={compartment_id}");
        if let Some(vid) = vcn_id {
            path.push_str(&format!("&vcnId={vid}"));
        }
        client.get("iaas", &path).await
    }

    pub async fn get_subnet(client: &OciClient, subnet_id: &str) -> OciResult<OciSubnet> {
        client
            .get("iaas", &format!("/20160918/subnets/{subnet_id}"))
            .await
    }

    pub async fn create_subnet(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OciSubnet> {
        client.post("iaas", "/20160918/subnets", body).await
    }

    pub async fn delete_subnet(client: &OciClient, subnet_id: &str) -> OciResult<()> {
        client
            .delete("iaas", &format!("/20160918/subnets/{subnet_id}"))
            .await
    }

    // ── Security Lists ───────────────────────────────────────────────

    pub async fn list_security_lists(
        client: &OciClient,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciSecurityList>> {
        let mut path = format!("/20160918/securityLists?compartmentId={compartment_id}");
        if let Some(vid) = vcn_id {
            path.push_str(&format!("&vcnId={vid}"));
        }
        client.get("iaas", &path).await
    }

    pub async fn get_security_list(
        client: &OciClient,
        security_list_id: &str,
    ) -> OciResult<OciSecurityList> {
        client
            .get(
                "iaas",
                &format!("/20160918/securityLists/{security_list_id}"),
            )
            .await
    }

    pub async fn create_security_list(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OciSecurityList> {
        client.post("iaas", "/20160918/securityLists", body).await
    }

    pub async fn update_security_list(
        client: &OciClient,
        security_list_id: &str,
        body: &serde_json::Value,
    ) -> OciResult<OciSecurityList> {
        client
            .put(
                "iaas",
                &format!("/20160918/securityLists/{security_list_id}"),
                body,
            )
            .await
    }

    pub async fn delete_security_list(client: &OciClient, security_list_id: &str) -> OciResult<()> {
        client
            .delete(
                "iaas",
                &format!("/20160918/securityLists/{security_list_id}"),
            )
            .await
    }

    // ── Route Tables ─────────────────────────────────────────────────

    pub async fn list_route_tables(
        client: &OciClient,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciRouteTable>> {
        let mut path = format!("/20160918/routeTables?compartmentId={compartment_id}");
        if let Some(vid) = vcn_id {
            path.push_str(&format!("&vcnId={vid}"));
        }
        client.get("iaas", &path).await
    }

    pub async fn get_route_table(
        client: &OciClient,
        route_table_id: &str,
    ) -> OciResult<OciRouteTable> {
        client
            .get("iaas", &format!("/20160918/routeTables/{route_table_id}"))
            .await
    }

    pub async fn update_route_table(
        client: &OciClient,
        route_table_id: &str,
        body: &serde_json::Value,
    ) -> OciResult<OciRouteTable> {
        client
            .put(
                "iaas",
                &format!("/20160918/routeTables/{route_table_id}"),
                body,
            )
            .await
    }

    // ── Internet Gateways ────────────────────────────────────────────

    pub async fn list_internet_gateways(
        client: &OciClient,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciInternetGateway>> {
        let mut path = format!("/20160918/internetGateways?compartmentId={compartment_id}");
        if let Some(vid) = vcn_id {
            path.push_str(&format!("&vcnId={vid}"));
        }
        client.get("iaas", &path).await
    }

    pub async fn create_internet_gateway(
        client: &OciClient,
        compartment_id: &str,
        vcn_id: &str,
        display_name: &str,
        is_enabled: bool,
    ) -> OciResult<OciInternetGateway> {
        client
            .post(
                "iaas",
                "/20160918/internetGateways",
                &serde_json::json!({
                    "compartmentId": compartment_id,
                    "vcnId": vcn_id,
                    "displayName": display_name,
                    "isEnabled": is_enabled,
                }),
            )
            .await
    }

    pub async fn delete_internet_gateway(client: &OciClient, igw_id: &str) -> OciResult<()> {
        client
            .delete("iaas", &format!("/20160918/internetGateways/{igw_id}"))
            .await
    }

    // ── NAT Gateways ─────────────────────────────────────────────────

    pub async fn list_nat_gateways(
        client: &OciClient,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciNatGateway>> {
        let mut path = format!("/20160918/natGateways?compartmentId={compartment_id}");
        if let Some(vid) = vcn_id {
            path.push_str(&format!("&vcnId={vid}"));
        }
        client.get("iaas", &path).await
    }

    pub async fn create_nat_gateway(
        client: &OciClient,
        compartment_id: &str,
        vcn_id: &str,
        display_name: &str,
    ) -> OciResult<OciNatGateway> {
        client
            .post(
                "iaas",
                "/20160918/natGateways",
                &serde_json::json!({
                    "compartmentId": compartment_id,
                    "vcnId": vcn_id,
                    "displayName": display_name,
                }),
            )
            .await
    }

    pub async fn delete_nat_gateway(client: &OciClient, nat_gw_id: &str) -> OciResult<()> {
        client
            .delete("iaas", &format!("/20160918/natGateways/{nat_gw_id}"))
            .await
    }

    // ── Network Security Groups ──────────────────────────────────────

    pub async fn list_network_security_groups(
        client: &OciClient,
        compartment_id: &str,
        vcn_id: Option<&str>,
    ) -> OciResult<Vec<OciNetworkSecurityGroup>> {
        let mut path = format!("/20160918/networkSecurityGroups?compartmentId={compartment_id}");
        if let Some(vid) = vcn_id {
            path.push_str(&format!("&vcnId={vid}"));
        }
        client.get("iaas", &path).await
    }

    pub async fn get_network_security_group(
        client: &OciClient,
        nsg_id: &str,
    ) -> OciResult<OciNetworkSecurityGroup> {
        client
            .get("iaas", &format!("/20160918/networkSecurityGroups/{nsg_id}"))
            .await
    }

    // ── Load Balancers ───────────────────────────────────────────────

    pub async fn list_load_balancers(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciLoadBalancer>> {
        client
            .get(
                "iaas",
                &format!("/20160918/loadBalancers?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_load_balancer(client: &OciClient, lb_id: &str) -> OciResult<OciLoadBalancer> {
        client
            .get("iaas", &format!("/20160918/loadBalancers/{lb_id}"))
            .await
    }

    pub async fn create_load_balancer(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OciLoadBalancer> {
        client.post("iaas", "/20160918/loadBalancers", body).await
    }

    pub async fn delete_load_balancer(client: &OciClient, lb_id: &str) -> OciResult<()> {
        client
            .delete("iaas", &format!("/20160918/loadBalancers/{lb_id}"))
            .await
    }
}
