// ── sorng-warpgate/src/parameters.rs ────────────────────────────────────────
//! Warpgate system parameter management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct ParameterManager;

impl ParameterManager {
    /// GET /parameters
    pub async fn get(client: &WarpgateClient) -> WarpgateResult<WarpgateParameters> {
        let resp = client.get("/parameters").await?;
        let params: WarpgateParameters = serde_json::from_value(resp)?;
        Ok(params)
    }

    /// PUT /parameters
    pub async fn update(client: &WarpgateClient, req: &UpdateParametersRequest) -> WarpgateResult<()> {
        let body = serde_json::to_value(req)?;
        client.put("/parameters", &body).await?;
        Ok(())
    }
}
