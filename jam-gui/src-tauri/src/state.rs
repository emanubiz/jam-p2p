use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;
use tokio::sync::mpsc;

use crate::messages::AppCommand;

pub struct AppState {
    pub tx: Mutex<mpsc::Sender<AppCommand>>,
    pub connected: Arc<AtomicBool>,
}

pub struct BackendState {
    pub connected: Arc<AtomicBool>,
}

pub fn init_state(tx: mpsc::Sender<AppCommand>) -> (AppState, BackendState) {
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
    token: Option<crate::messages::RoomToken>,
) -> Result<(), String> {
    if state.connected.load(Ordering::SeqCst) {
        return Err("Already connected to a room. Leave first.".to_string());
    }
    let (res_tx, res_rx) = tokio::sync::oneshot::channel();
    // Clone the Sender out of the mutex and drop the guard before awaiting: a
    // parking_lot MutexGuard is !Send, so holding it across `.await` would make
    // this command's future !Send, which Tauri's command system rejects.
    let sender = state.tx.lock().clone();
    sender
        .send(AppCommand::Join {
            room,
            name,
            server,
            token,
            res_tx,
        })
        .await
        .map_err(|e| e.to_string())?;
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
    let sender = state.tx.lock().clone();
    sender
        .send(AppCommand::Leave { res_tx })
        .await
        .map_err(|e| e.to_string())?;
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
pub async fn set_volume(
    state: State<'_, AppState>,
    peer_id: String,
    vol: f32,
) -> Result<(), String> {
    let sender = state.tx.lock().clone();
    sender
        .send(AppCommand::SetVolume { peer_id, vol })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_opus_bitrate(state: State<'_, AppState>, bitrate: i32) -> Result<(), String> {
    let sender = state.tx.lock().clone();
    sender
        .send(AppCommand::SetOpusBitrate { bitrate })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_muted(state: State<'_, AppState>, muted: bool) -> Result<(), String> {
    let sender = state.tx.lock().clone();
    sender
        .send(AppCommand::SetMute { muted })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
