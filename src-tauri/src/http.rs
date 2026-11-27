use std::time::Duration;

use crate::error::AppResult;

/// HTTP client for long-running log streams.
///
/// Avoid a total request timeout so large or slow logs can finish downloading.
/// The request fails only if connecting or receiving data stalls.
pub fn stream_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(120))
        .build()?)
}
