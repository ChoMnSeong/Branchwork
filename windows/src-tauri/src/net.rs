//! GitHub·GitLab·Anthropic API 요청(사내 GitLab 은 CORS 가 없어 웹뷰 대신 여기서 보낸다)

use serde::Serialize;
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    body: String,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Branchwork")
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("HTTP client")
    })
}

#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<HttpResponse, String> {
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client().request(m, &url).timeout(Duration::from_millis(timeout_ms.unwrap_or(30_000)));
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("응답 시간이 초과됐습니다: {url}")
        } else if e.is_connect() {
            format!("서버에 연결하지 못했습니다: {url}")
        } else {
            e.to_string()
        }
    })?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, body })
}

/// 호스트 이름이 가리키는 IP 주소들(같은 서버의 다른 도메인인지 볼 때)
#[tauri::command]
pub async fn resolve_host(host: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), 443)
            .to_socket_addrs()
            .map(|it| it.map(|a| a.ip().to_string()).collect())
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}
