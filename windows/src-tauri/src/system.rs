//! 파일·자격 증명·대화상자·탐색기 등 운영체제 기능

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const SERVICE: &str = "Branchwork";

// MARK: 자격 증명(Windows 자격 증명 관리자 / macOS 키체인)

#[tauri::command]
pub fn secret_get(name: String) -> Option<String> {
    keyring::Entry::new(SERVICE, &name).ok()?.get_password().ok()
}

#[tauri::command]
pub fn secret_set(name: String, value: Option<String>) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &name).map_err(|e| e.to_string())?;
    match value.filter(|v| !v.is_empty()) {
        Some(v) => entry.set_password(&v).map_err(|e| e.to_string()),
        None => {
            let _ = entry.delete_credential();
            Ok(())
        }
    }
}

// MARK: 파일

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_read_text(path: String) -> Option<String> {
    std::fs::read(&path).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

#[derive(Serialize)]
pub struct FileHead {
    text: String,
    binary: bool,
    truncated: bool,
    size: u64,
}

/// 파일 앞부분(새 파일 diff 용). NUL 이 있으면 바이너리로 본다.
#[tauri::command]
pub fn fs_read_head(path: String, max: usize) -> Result<FileHead, String> {
    use std::io::Read;
    let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut buf = Vec::new();
    f.take(max as u64).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let binary = buf.iter().take(8000).any(|&b| b == 0);
    Ok(FileHead {
        text: if binary { String::new() } else { String::from_utf8_lossy(&buf).into_owned() },
        binary,
        truncated: (buf.len() as u64) < size,
        size,
    })
}

/// 임시 파일에 쓰고 바꿔치기(쓰다 끊겨도 원래 파일이 깨지지 않게)
#[tauri::command]
pub fn fs_write_text(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("tmp-write");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_list(path: String) -> Vec<String> {
    std::fs::read_dir(&path)
        .map(|it| it.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn fs_remove(path: String) {
    let p = Path::new(&path);
    if p.is_dir() {
        let _ = std::fs::remove_dir_all(p);
    } else {
        let _ = std::fs::remove_file(p);
    }
}

#[tauri::command]
pub fn fs_mkdirs(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

// MARK: 환경

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    os: &'static str,
    home: String,
    data_dir: String,
    exe: String,
    temp: String,
    shell: String,
    version: String,
    /// 자동 점검(CI): 열어 볼 테스트 저장소 경로
    selftest: Option<String>,
}

#[tauri::command]
pub fn env_info(app: AppHandle) -> EnvInfo {
    let shell = if cfg!(windows) {
        crate::process::find_program("pwsh")
            .or_else(|| crate::process::find_program("powershell"))
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "powershell.exe".into())
    } else {
        std::env::var("SHELL").ok().filter(|s| Path::new(s).exists()).unwrap_or_else(|| "/bin/zsh".into())
    };
    EnvInfo {
        os: std::env::consts::OS,
        home: dirs::home_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        data_dir: crate::helper::data_dir().to_string_lossy().into_owned(),
        exe: std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        temp: std::env::temp_dir().to_string_lossy().into_owned(),
        shell,
        version: app.package_info().version.to_string(),
        selftest: std::env::var("BRANCHWORK_SELFTEST").ok().filter(|s| !s.is_empty()),
    }
}

// MARK: 대화상자·탐색기·브라우저

#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: String, start: Option<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file().set_title(&title);
        if let Some(s) = start.filter(|s| Path::new(s).is_dir()) {
            d = d.set_directory(s);
        }
        d.blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("웹 주소만 열 수 있습니다".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// 탐색기(Finder)에서 파일·폴더를 선택해 보여 준다
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(PathBuf::from(crate::process::native(&path))).map_err(|e| e.to_string())
}

/// 바깥 터미널 앱으로 폴더 열기(Windows Terminal → PowerShell, macOS Terminal)
#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let path = crate::process::native(&path);
    if cfg!(windows) {
        if let Some(wt) = crate::process::find_program("wt") {
            Command::new(wt).args(["-d", &path]).spawn().map_err(|e| e.to_string())?;
            return Ok(());
        }
        let shell = crate::process::find_program("pwsh")
            .or_else(|| crate::process::find_program("powershell"))
            .ok_or("PowerShell 을 찾지 못했습니다")?;
        let mut cmd = Command::new(shell);
        cmd.arg("-NoExit").current_dir(&path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            cmd.creation_flags(CREATE_NEW_CONSOLE);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    } else {
        Command::new("open").args(["-a", "Terminal", &path]).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 화면이 준비되면 창을 보여 준다(처음부터 띄우면 흰 화면이 번쩍인다)
#[tauri::command]
pub fn app_ready(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        // 자동 점검 중에는 다른 작업을 방해하지 않게 앞으로 가져오지 않는다
        if std::env::var("BRANCHWORK_SELFTEST").is_err() {
            let _ = w.set_focus();
        } else if std::env::var("BRANCHWORK_SELFTEST_ON_TOP").is_ok() {
            // 개발 중 화면 캡처용: 포커스는 가져오지 않고 맨 위에만 띄운다
            let _ = w.set_always_on_top(true);
            // 맥은 비활성 앱의 창을 화면에 올리지 않으므로 강제로 올린다
            #[cfg(target_os = "macos")]
            if let Ok(ptr) = w.ns_window() {
                unsafe {
                    let obj = &*(ptr as *mut objc2::runtime::AnyObject);
                    let _: () = objc2::msg_send![obj, orderFrontRegardless];
                }
            }
        }
    }
}
