//! 내장 터미널: 의사 터미널(Windows ConPTY, macOS pty)에서 셸을 띄우고 입출력을 화면과 주고받는다.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys(Arc<Mutex<HashMap<String, PtyHandle>>>);

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PtyEvent {
    Data { data: String },
    Exit { code: Option<i32> },
}

/// 바이트 덩어리를 UTF-8 로 바꾸되, 끝에 잘린 글자(한글 등)는 다음 덩어리로 넘긴다
fn decode(carry: &mut Vec<u8>, chunk: &[u8]) -> String {
    carry.extend_from_slice(chunk);
    let mut out = String::new();
    loop {
        match std::str::from_utf8(carry) {
            Ok(s) => {
                out.push_str(s);
                carry.clear();
                break;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                out.push_str(std::str::from_utf8(&carry[..valid]).unwrap_or(""));
                match e.error_len() {
                    // 잘못된 바이트는 대체 문자로 바꾸고 계속
                    Some(n) => {
                        out.push('\u{FFFD}');
                        carry.drain(..valid + n);
                    }
                    // 덩어리 끝에서 글자가 잘림 → 남겨 둔다
                    None => {
                        carry.drain(..valid);
                        break;
                    }
                }
            }
        }
    }
    out
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    state: tauri::State<'_, Ptys>,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: String,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<Option<u32>, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let exe = crate::process::find_program(&program).map(|p| p.to_string_lossy().into_owned()).unwrap_or(program);
    let mut cmd = CommandBuilder::new(exe);
    cmd.args(&args);
    cmd.cwd(crate::process::native(&cwd));
    for (k, v) in &env {
        cmd.env(k, v);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let pid = child.process_id();
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    state.0.lock().unwrap().insert(id.clone(), PtyHandle { master: pair.master, writer, killer });

    let exit_code: Arc<Mutex<Option<Option<i32>>>> = Arc::new(Mutex::new(None));

    // 셸이 끝나길 기다렸다가 의사 터미널을 닫는다(ConPTY 는 닫아야 출력 쪽이 끝난다)
    {
        let exit_code = exit_code.clone();
        let id = id.clone();
        let ptys = state.0.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code() as i32);
            *exit_code.lock().unwrap() = Some(code);
            std::thread::sleep(Duration::from_millis(150));
            ptys.lock().unwrap().remove(&id);
        });
    }

    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut carry = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = decode(&mut carry, &buf[..n]);
                    if !text.is_empty() && on_event.send(PtyEvent::Data { data: text }).is_err() {
                        break;
                    }
                }
            }
        }
        // 종료 코드가 정해질 때까지 잠깐 기다린다
        let mut code = None;
        for _ in 0..50 {
            if let Some(c) = *exit_code.lock().unwrap() {
                code = c;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = on_event.send(PtyEvent::Exit { code });
    });

    Ok(pid)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<'_, Ptys>, id: String, data: String) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let h = map.get_mut(&id).ok_or("The terminal is already closed")?;
    h.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    h.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: tauri::State<'_, Ptys>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    if let Some(h) = map.get(&id) {
        h.master
            .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<'_, Ptys>, id: String) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(h) = map.get_mut(&id) {
        let _ = h.killer.kill();
    }
    Ok(())
}
