//! 자동 업데이트: GitHub Releases 의 latest.json 을 보고, 서명이 맞는 새 설치 파일만 받아 설치한다.

use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum UpdateEvent {
    Progress { downloaded: u64, total: Option<u64> },
    Finished,
}

/// 새 버전이 있으면 정보, 없으면 None. endpoint 는 자동 점검용(서명은 그대로 확인한다).
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>, endpoint: Option<String>) -> Result<Option<UpdateInfo>, String> {
    let updater = match endpoint {
        Some(e) => {
            let url = e.parse().map_err(|err: url::ParseError| err.to_string())?;
            app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?
        }
        None => app.updater().map_err(|e| e.to_string())?,
    };
    let found = updater.check().await.map_err(|e| e.to_string())?;
    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *pending.0.lock().unwrap() = found;
    Ok(info)
}

/// 받은 설치 파일의 서명을 확인한 뒤 설치한다. 끝나면 화면 쪽에서 다시 시작한다.
#[tauri::command]
pub async fn update_install(pending: State<'_, PendingUpdate>, on_event: Channel<UpdateEvent>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("No update was found. Check again.")?;
    let mut downloaded: u64 = 0;
    let progress = on_event.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.send(UpdateEvent::Progress { downloaded, total });
            },
            move || {
                let _ = on_event.send(UpdateEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())
}

/// 자동 점검용: 받기만 하고 서명을 확인한다(설치하지 않음). 받은 바이트 수를 돌려준다.
#[tauri::command]
pub async fn update_verify(pending: State<'_, PendingUpdate>) -> Result<usize, String> {
    let update = pending.0.lock().unwrap().take().ok_or("No update was found")?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    Ok(bytes.len())
}

#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}
