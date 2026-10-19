//! 외부 프로그램(git, gh, claude) 실행

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

#[derive(Serialize)]
pub struct ProcOutput {
    status: i32,
    stdout: String,
    stderr: String,
}

/// PATH 에서 프로그램을 찾는다(Windows 는 PATHEXT 의 .exe/.cmd 등도 붙여 본다)
pub fn find_program(program: &str) -> Option<PathBuf> {
    if program.contains('/') || program.contains('\\') {
        let p = PathBuf::from(program);
        return p.is_file().then_some(p);
    }
    let exts: Vec<String> = if cfg!(windows) {
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        let mut v = vec![String::new()];
        v.extend(pathext.split(';').filter(|e| !e.is_empty()).map(|e| e.to_lowercase()));
        v
    } else {
        vec![String::new()]
    };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{program}{ext}"));
            if candidate.is_file() && (cfg!(windows) && !ext.is_empty() || !cfg!(windows)) {
                return Some(candidate);
            }
        }
    }
    None
}

#[tauri::command]
pub fn which(program: String) -> Option<String> {
    find_program(&program).map(|p| p.to_string_lossy().into_owned())
}

pub fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn run_blocking(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    stdin: Option<String>,
    timeout: Duration,
) -> Result<ProcOutput, String> {
    let exe = find_program(&program).unwrap_or_else(|| PathBuf::from(&program));
    let mut cmd = Command::new(&exe);
    cmd.args(&args)
        .envs(&env)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
        if !Path::new(dir).is_dir() {
            return Err(format!("폴더가 없습니다: {dir}"));
        }
        cmd.current_dir(dir);
    }
    hide_window(&mut cmd);
    let name = Path::new(&program).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or(program.clone());
    let mut child = cmd.spawn().map_err(|e| format!("{name} 을(를) 실행하지 못했습니다: {e}"))?;

    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        std::thread::spawn(move || {
            let _ = pipe.write_all(input.as_bytes());
        });
    }
    // 출력이 많을 때 파이프가 가득 차 멈추지 않도록 stdout·stderr 를 따로 비운다
    let mut out = child.stdout.take().ok_or("stdout")?;
    let mut err = child.stderr.take().ok_or("stderr")?;
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = err.read_to_end(&mut buf);
        buf
    });

    let status = match child.wait_timeout(timeout).map_err(|e| e.to_string())? {
        Some(s) => s.code().unwrap_or(-1),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            -2
        }
    };
    let stdout = out_thread.join().unwrap_or_default();
    let stderr = err_thread.join().unwrap_or_default();
    let mut stderr = String::from_utf8_lossy(&stderr).into_owned();
    if status == -2 {
        stderr.push_str(&format!("\n{name} 이(가) {}초 안에 끝나지 않아 중단했습니다.", timeout.as_secs()));
    }
    Ok(ProcOutput { status, stdout: String::from_utf8_lossy(&stdout).into_owned(), stderr })
}

/// 프로그램을 실행하고 끝날 때까지 기다린다. 종료 코드와 출력을 그대로 돌려준다.
#[tauri::command]
pub async fn run_process(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    stdin: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<ProcOutput, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(120_000));
    tauri::async_runtime::spawn_blocking(move || run_blocking(program, args, cwd, env.unwrap_or_default(), stdin, timeout))
        .await
        .map_err(|e| e.to_string())?
}
