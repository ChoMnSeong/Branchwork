//! 저장소 폴더 감시: 파일이 바뀌면 화면에 알려 그래프·상태를 다시 읽게 한다.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct Watches(Mutex<HashMap<String, RecommendedWatcher>>);

/// .git/objects·logs 는 git 이 스스로 쓰는 곳이라 무시(되먹임 방지)
fn ignored(p: &str) -> bool {
    let p = p.replace('\\', "/");
    p.contains("/.git/objects") || p.contains("/.git/logs") || p.ends_with(".git/index.lock")
}

#[tauri::command]
pub fn watch_start(app: AppHandle, state: tauri::State<'_, Watches>, id: String, path: String) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let paths: Vec<String> = ev
                .paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .filter(|p| !ignored(p))
                .collect();
            if !paths.is_empty() {
                let _ = tx.send(paths);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(std::path::Path::new(&path), RecursiveMode::Recursive).map_err(|e| e.to_string())?;

    // 잇따른 변경을 0.3초씩 모아 한 번에 알린다. 감시를 멈추면(tx 가 사라지면) 끝난다.
    let event = format!("watch-{id}");
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch = first;
            while let Ok(more) = rx.recv_timeout(Duration::from_millis(300)) {
                if batch.len() < 200 {
                    batch.extend(more);
                }
            }
            batch.truncate(200);
            let _ = app.emit(&event, batch);
        }
    });

    state.0.lock().unwrap().insert(id, watcher);
    Ok(())
}

#[tauri::command]
pub fn watch_stop(state: tauri::State<'_, Watches>, id: String) {
    state.0.lock().unwrap().remove(&id);
}
