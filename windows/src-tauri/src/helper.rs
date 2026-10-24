//! 같은 실행 파일을 작은 도우미로도 쓴다(창 없이 바로 끝남).
//!  - git 의 GIT_ASKPASS: 연결한 계정 토큰으로 HTTPS 자격 증명 질문에 답한다.
//!  - Claude Code 훅: Gitrochi 가 띄운 세션의 이벤트를 상태 파일로 남긴다(에이전트 패널).

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// 앱 데이터 폴더(Windows: %APPDATA%\Gitrochi).
/// 맥에서 개발용으로 돌릴 때는 맥 버전 Gitrochi 앱의 폴더와 겹치지 않게 이름을 바꾼다.
pub fn data_dir() -> PathBuf {
    // CI/desktop self-tests must not replace a user's settings or agent sessions.
    if let Some(repo) = std::env::var_os("GITROCHI_SELFTEST") {
        let path = PathBuf::from(repo);
        if path.is_absolute() {
            if let Some(parent) = path.parent() { return parent.join(".gitrochi-selftest-data"); }
        }
    }
    let (name, legacy) = if cfg!(windows) { ("Gitrochi", "Branchwork") } else { ("Gitrochi (Tauri)", "Branchwork (Tauri)") };
    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join(name);
    // Called Branchwork up to 0.3.5: move that folder over the first time
    let old = base.join(legacy);
    if !dir.exists() && old.is_dir() {
        let _ = std::fs::rename(&old, &dir);
    }
    dir
}

/// 도우미로 불렸으면 처리하고 true
pub fn handle_cli() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--agent-hook") {
        agent_hook(args.get(2).cloned().unwrap_or_default());
        return true;
    }
    if std::env::var("GITROCHI_ASKPASS").ok().as_deref() == Some("1") {
        let code = askpass(args.get(1).map(String::as_str).unwrap_or(""));
        std::process::exit(code);
    }
    false
}

/// 질문 문구("Username for 'https://host': ")에 든 호스트로 계정을 골라 아이디/토큰을 출력
fn askpass(prompt: &str) -> i32 {
    let count: usize = std::env::var("GITROCHI_ASKPASS_COUNT").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    for i in 1..=count {
        let host = std::env::var(format!("GITROCHI_ASKPASS_HOST_{i}")).unwrap_or_default();
        if host.is_empty() || !prompt.contains(&host) {
            continue;
        }
        let user = std::env::var(format!("GITROCHI_ASKPASS_USER_{i}")).unwrap_or_default();
        let pass = std::env::var(format!("GITROCHI_ASKPASS_PASS_{i}")).unwrap_or_default();
        if pass.is_empty() {
            return 1;
        }
        let answer = if prompt.starts_with("Username") { user } else { pass };
        let mut out = std::io::stdout();
        let _ = writeln!(out, "{answer}");
        let _ = out.flush();
        return 0;
    }
    1
}

fn agent_hook(event: String) {
    let Ok(id) = std::env::var("GITROCHI_AGENT_ID") else { return };
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return;
    }
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let payload: serde_json::Value = serde_json::from_str(&input).unwrap_or(serde_json::Value::Null);
    let time = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let state = serde_json::json!({ "event": event, "time": time, "payload": payload });
    let dir = data_dir().join("agents");
    let _ = std::fs::create_dir_all(&dir);
    let tmp = dir.join(format!("{id}.state.tmp"));
    if std::fs::write(&tmp, state.to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, dir.join(format!("{id}.state")));
    }
}
