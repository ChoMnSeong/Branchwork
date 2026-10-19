//! Branchwork 백엔드: 화면(웹)은 여기 명령으로 git·셸·파일·네트워크·자격 증명을 다룬다.
//! git 동작은 새로 구현하지 않고 시스템 git 을 그대로 실행한다.

pub mod helper;
mod net;
mod process;
mod pty;
mod system;
mod watch;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // 이미 켜져 있으면 새로 띄우지 않고 기존 창을 앞으로
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 배포본에서는 웹뷰의 브라우저 단축키(F5 새로 고침, Ctrl+F 찾기, Ctrl+P 인쇄 등)를 끈다 — 앱 단축키와 겹치지 않게
            #[cfg(all(windows, not(debug_assertions)))]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.with_webview(|wv| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows::core::Interface;
                    if let Ok(core) = wv.controller().CoreWebView2() {
                        if let Ok(settings) = core.Settings() {
                            if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
                                let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
                            }
                        }
                    }
                });
            }
            // 화면 쪽이 준비 신호를 못 보내도(오류 등) 창이 영영 안 뜨는 일이 없게
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .manage(pty::Ptys::default())
        .manage(watch::Watches::default())
        .invoke_handler(tauri::generate_handler![
            process::run_process,
            process::which,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            watch::watch_start,
            watch::watch_stop,
            net::http_request,
            net::resolve_host,
            system::secret_get,
            system::secret_set,
            system::fs_exists,
            system::fs_read_text,
            system::fs_read_head,
            system::fs_write_text,
            system::fs_list,
            system::fs_remove,
            system::fs_mkdirs,
            system::env_info,
            system::pick_folder,
            system::open_url,
            system::reveal_path,
            system::open_terminal,
            system::app_ready,
        ])
        .run(tauri::generate_context!())
        .expect("Branchwork 를 시작하지 못했습니다");
}
