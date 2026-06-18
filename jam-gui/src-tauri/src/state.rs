use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use tokio::sync::mpsc;

use crate::messages::AppCommand;

pub struct AppState {
    pub tx: Mutex<mpsc::UnboundedSender<AppCommand>>,
    pub connected: Arc<AtomicBool>,
}

pub struct BackendState {
    pub connected: Arc<AtomicBool>,
}

pub fn init_state(
    tx: mpsc::UnboundedSender<AppCommand>,
) -> (AppState, BackendState) {
    let connected = Arc::new(AtomicBool::new(false));
    (
        AppState {
            tx: Mutex::new(tx),
            connected: connected.clone(),
        },
        BackendState { connected },
    )
}

#[tauri::command]
pub async fn join_room(
    state: State<'_, AppState>,
    room: String,
    name: String,
    server: String,
) -> Result<(), String> {
    if state.connected.load(Ordering::SeqCst) {
        return Err("Already connected to a room. Leave first.".to_string());
    }
    let (res_tx, res_rx) = tokio::sync::oneshot::channel();
    {
        let tx = state.tx.lock().map_err(|e| e.to_string())?;
        tx.send(AppCommand::Join {
            room,
            name,
            server,
            res_tx,
        })
        .map_err(|e| e.to_string())?;
    }
    res_rx
        .await
        .map_err(|_| "Internal backend error".to_string())?
}

#[tauri::command]
pub async fn leave_room(state: State<'_, AppState>) -> Result<(), String> {
    // Leave is idempotent. The user may click Cancel during an in-flight
    // auto-reconnect (where `connected` is already false); guard-clicking
    // them with "Not connected" would block the only path that stops the
    // reconnect loop. The backend resets last_join unconditionally and the
    // connected flag flip is a no-op when already false.
    let (res_tx, res_rx) = tokio::sync::oneshot::channel();
    {
        let tx = state.tx.lock().map_err(|e| e.to_string())?;
        tx.send(AppCommand::Leave { res_tx })
            .map_err(|e| e.to_string())?;
    }
    let result = res_rx
        .await
        .map_err(|_| "Internal backend error".to_string())?;
    // Force-clear the connected flag even when the backend Leave failed:
    // the user's intent was to disconnect, so we don't want the
    // `join_room` guard to refuse their next reconnect attempt.
    state.connected.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn set_volume(state: State<AppState>, peer_id: String, vol: f32) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AppCommand::SetVolume { peer_id, vol })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_opus_bitrate(state: State<AppState>, bitrate: i32) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AppCommand::SetOpusBitrate { bitrate })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_muted(state: State<AppState>, muted: bool) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AppCommand::SetMute { muted })
        .map_err(|e| e.to_string())?;
    Ok(())
}
