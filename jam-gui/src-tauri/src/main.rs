#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod backend;
mod config;
mod jitter_buffer;
mod logger;
mod messages;
mod signaling;
mod state;
mod webrtc;

use crate::backend::run_backend;
use crate::logger::init_tracing;
use crate::messages::AppCommand;
use crate::state::init_state;
use tokio::sync::{mpsc, watch};

// Startup is fatal-or-nothing: if the tokio runtime or the Tauri event loop
// cannot be created there is no meaningful recovery, so `expect` (which the
// project otherwise lints against) is the correct choice here.
#[allow(clippy::expect_used)]
fn main() {
    init_tracing();
    let (tx, rx) = mpsc::channel::<AppCommand>(64);
    let (app_state, backend_state) = init_state(tx);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            state::join_room,
            state::set_volume,
            state::leave_room,
            state::set_opus_bitrate,
            state::set_muted,
            state::list_audio_devices,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
                rt.block_on(async move {
                    if let Err(e) = run_backend(handle, backend_state, rx, shutdown_rx).await {
                        tracing::error!("Backend error: {:?}", e);
                    }
                });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    let _ = shutdown_tx.send(true);
}
