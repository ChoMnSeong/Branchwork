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

/// 이미지를 받아 data: 주소로(사내 GitLab 의 프로필 사진은 토큰이 있어야 열리기도 해서 웹뷰 대신 여기서 받는다)
#[tauri::command]
pub async fn http_image(url: String, headers: HashMap<String, String>) -> Option<String> {
    let mut req = client().get(&url).timeout(Duration::from_secs(15));
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let kind = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if !kind.starts_with("image/") {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > 2_000_000 {
        return None;
    }
    Some(format!("data:{kind};base64,{}", base64(&bytes)))
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
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
