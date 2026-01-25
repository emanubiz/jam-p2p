#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod logger;

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures::StreamExt;
use opus::{Application, Channels, Decoder, Encoder};
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapRb,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{State, Emitter}; 
use tokio::sync::mpsc;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::{TrackLocal, TrackLocalWriter};

use crate::logger::init_tracing;

const SAMPLE_RATE: u32 = 48000;
const FRAME_SIZE_MS: usize = 20;
const SAMPLES_PER_FRAME: usize = (SAMPLE_RATE as usize * FRAME_SIZE_MS) / 1000;

type MixerMap = HashMap<String, (HeapCons<f32>, f32)>;

#[derive(Debug)]
enum AppCommand {
    Join { 
        room: String, 
        name: String, 
        server: String, 
        res_tx: tokio::sync::oneshot::Sender<Result<(), String>> 
    },
    SetVolume { peer_id: String, vol: f32 },
}

struct AppState {
    tx: Mutex<mpsc::UnboundedSender<AppCommand>>,
}

#[tauri::command]
async fn join_room(state: State<'_, AppState>, room: String, name: String, server: String) -> Result<(), String> {
    let (res_tx, res_rx) = tokio::sync::oneshot::channel();
    {
        let tx = state.tx.lock().map_err(|e| e.to_string())?;
        tx.send(AppCommand::Join { room, name, server, res_tx }).map_err(|e| e.to_string())?;
    }
    res_rx.await.map_err(|_| "Errore interno del backend".to_string())?
}

#[tauri::command]
fn set_volume(state: State<AppState>, peer_id: String, vol: f32) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AppCommand::SetVolume { peer_id, vol }).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "data")]
enum SignalMessage {
    Welcome { uuid: String },
    Join { room: String, name: String },
    PeerList { peers: Vec<String> },
    NewPeer { uuid: String },
    Offer { target: String, sdp: String, from: Option<String> },
    Answer { target: String, sdp: String, from: Option<String> },
    Ice { target: String, candidate: String, from: Option<String> },
}

fn main() {
    init_tracing();
    let (tx, mut rx) = mpsc::unbounded_channel::<AppCommand>();

    tauri::Builder::default()
        .manage(AppState { tx: Mutex::new(tx) })
        .invoke_handler(tauri::generate_handler![join_room, set_volume])
        .setup(|app| {
            let handle = app.handle().clone();
            thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async move {
                    if let Err(e) = run_backend_loop(&mut rx, handle).await {
                        tracing::error!("Backend error: {:?}", e);
                    }
                });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn run_backend_loop(rx: &mut mpsc::UnboundedReceiver<AppCommand>, handle: tauri::AppHandle) -> Result<()> {
    let host = cpal::default_host();
    let input_dev = host.default_input_device().context("no input device")?;
    let output_dev = host.default_output_device().context("no output device")?;
    let config_in: cpal::StreamConfig = input_dev.default_input_config()?.into();
    let config_out: cpal::StreamConfig = output_dev.default_output_config()?.into();

    let rb_mic = HeapRb::<f32>::new((SAMPLE_RATE as usize).max(1024));
    let (mut mic_prod, mut mic_cons) = rb_mic.split();
    let mixer_sources: Arc<Mutex<MixerMap>> = Arc::new(Mutex::new(HashMap::new()));
    let mixer_injector = mixer_sources.clone();

    let input_stream = input_dev.build_input_stream(&config_in, move |data: &[f32], _| { let _ = mic_prod.push_slice(data); }, |_| {}, None)?;
    let mixer_lock = mixer_sources.clone();
    let output_stream = output_dev.build_output_stream(&config_out, move |data: &mut [f32], _| {
        data.fill(0.0);
        if let Ok(mut sources) = mixer_lock.lock() {
            for (_, (consumer, vol)) in sources.iter_mut() {
                for sample in data.iter_mut() { if let Some(s) = consumer.try_pop() { *sample += s * (*vol); } }
            }
        }
        for s in data.iter_mut() { *s = s.tanh(); }
    }, |_| {}, None)?;

    input_stream.play()?;
    output_stream.play()?;

    let mut m = MediaEngine::default();
    m.register_default_codecs()?;
    let api = Arc::new(APIBuilder::new().with_media_engine(m).build());
    let ice_servers = vec![RTCIceServer { urls: vec!["stun:stun.l.google.com:19302".to_string()], ..Default::default() }];
    let local_track = Arc::new(TrackLocalStaticRTP::new(RTCRtpCodecCapability { mime_type: "audio/opus".to_owned(), ..Default::default() }, "audio".to_owned(), "webrtc-rs".to_owned()));

    let track_clone = local_track.clone();
    thread::spawn(move || {
        let mut encoder = Encoder::new(SAMPLE_RATE, Channels::Mono, Application::Voip).unwrap();
        let mut pcm_buf = Vec::with_capacity(SAMPLES_PER_FRAME);
        let mut out_buf = [0u8; 1024];
        let mut seq: u16 = 0;
        loop {
            while pcm_buf.len() < SAMPLES_PER_FRAME { if let Some(s) = mic_cons.try_pop() { pcm_buf.push(s); } else { thread::sleep(std::time::Duration::from_millis(2)); } }
            if let Ok(len) = encoder.encode_float(&pcm_buf, &mut out_buf) {
                let _ = track_clone.write_rtp(&webrtc::rtp::packet::Packet {
                    header: webrtc::rtp::header::Header { payload_type: 111, sequence_number: seq, timestamp: seq as u32 * SAMPLES_PER_FRAME as u32, ..Default::default() },
                    payload: bytes::Bytes::copy_from_slice(&out_buf[..len]),
                });
                seq = seq.wrapping_add(1);
            }
            pcm_buf.clear();
        }
    });

    let mut peers: HashMap<String, Arc<RTCPeerConnection>> = HashMap::new();
    let mut ws_sender = None;
    let mut my_id: Option<String> = None;
    let (sig_tx, mut sig_rx) = mpsc::unbounded_channel::<SignalMessage>();
    let (ws_in_tx, mut ws_in_rx) = mpsc::unbounded_channel::<String>();

    loop {
        tokio::select! {
            Some(cmd) = rx.recv() => {
                match cmd {
                    AppCommand::Join { server, room, name, res_tx } => {
                        match tokio_tungstenite::connect_async(&server).await {
                            Ok((ws, _)) => {
                                let (write, mut read) = ws.split();
                                ws_sender = Some(write);
                                let tx_inner = ws_in_tx.clone();
                                tokio::spawn(async move {
                                    while let Some(Ok(msg)) = read.next().await {
                                        if let tokio_tungstenite::tungstenite::Message::Text(t) = msg { let _ = tx_inner.send(t); }
                                    }
                                });
                                let _ = sig_tx.send(SignalMessage::Join { room, name });
                                let _ = res_tx.send(Ok(()));
                            },
                            Err(e) => {
                                let _ = res_tx.send(Err(format!("Connessione fallita: {}", e)));
                            }
                        }
                    },
                    AppCommand::SetVolume { peer_id, vol } => {
                        if let Ok(mut sources) = mixer_sources.lock() {
                            if let Some((_, v)) = sources.get_mut(&peer_id) { *v = vol; }
                        }
                    }
                }
            }
            Some(msg) = sig_rx.recv() => {
                if let Some(ws) = ws_sender.as_mut() {
                    if let Ok(json) = serde_json::to_string(&msg) {
                        use futures::SinkExt;
                        let _ = ws.send(tokio_tungstenite::tungstenite::Message::Text(json)).await;
                    }
                }
            }
            Some(text) = ws_in_rx.recv() => {
                if let Ok(signal) = serde_json::from_str::<SignalMessage>(&text) {
                    handle_signal(signal, &mut peers, &mut my_id, local_track.clone(), sig_tx.clone(), mixer_injector.clone(), &api, ice_servers.clone(), handle.clone()).await?;
                }
            }
        }
    }
}

async fn handle_signal(
    signal: SignalMessage,
    peers: &mut HashMap<String, Arc<RTCPeerConnection>>,
    my_id: &mut Option<String>,
    local_track: Arc<TrackLocalStaticRTP>,
    sig_tx: mpsc::UnboundedSender<SignalMessage>,
    mixer: Arc<Mutex<MixerMap>>,
    api: &Arc<webrtc::api::API>,
    ice_servers: Vec<RTCIceServer>,
    handle: tauri::AppHandle,
) -> Result<()> {
    
    let create_pc = |pid: String, sig_tx: mpsc::UnboundedSender<SignalMessage>, local_track: Arc<TrackLocalStaticRTP>, mixer: Arc<Mutex<MixerMap>>, api: Arc<webrtc::api::API>, ice_servers: Vec<RTCIceServer>, h: tauri::AppHandle| async move {
        let config = RTCConfiguration { ice_servers, ..Default::default() };
        let pc = api.new_peer_connection(config).await?;
        let track_auth = local_track as Arc<dyn TrackLocal + Send + Sync>;
        pc.add_track(track_auth).await?;

        let h_state = h.clone();
        let p_state = pid.clone();
        pc.on_peer_connection_state_change(Box::new(move |s| {
            if s == webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState::Connected {
                let _ = h_state.emit("peer-joined", p_state.clone());
            }
            Box::pin(async move {})
        }));

        let m = mixer.clone(); let p_id = pid.clone();
        pc.on_track(Box::new(move |track, _, _| {
            let m_inner = m.clone(); let p_inner = p_id.clone();
            Box::pin(async move {
                let rb = HeapRb::<f32>::new(SAMPLE_RATE as usize * 2);
                let (mut prod, cons) = rb.split();
                if let Ok(mut s) = m_inner.lock() { s.insert(p_inner.clone(), (cons, 1.0)); }
                let mut dec = Decoder::new(SAMPLE_RATE, Channels::Mono).unwrap();
                let mut pcm = vec![0f32; 1920];
                while let Ok((rtp, _)) = track.read_rtp().await {
                    if let Ok(len) = dec.decode_float(&rtp.payload, &mut pcm, false) { let _ = prod.push_slice(&pcm[..len]); }
                }
                if let Ok(mut s) = m_inner.lock() { s.remove(&p_inner); }
            })
        }));

        let tx_ice = sig_tx.clone(); let p_ice = pid.clone();
        pc.on_ice_candidate(Box::new(move |c| {
            let tx = tx_ice.clone(); let p = p_ice.clone();
            Box::pin(async move {
                if let Some(c) = c {
                    if let Ok(j) = c.to_json() {
                        let _ = tx.send(SignalMessage::Ice { target: p, candidate: serde_json::to_string(&j).unwrap(), from: None });
                    }
                }
            })
        }));
        Ok::<Arc<RTCPeerConnection>, anyhow::Error>(Arc::new(pc))
    };

    match signal {
        SignalMessage::Welcome { uuid } => { *my_id = Some(uuid); }
        SignalMessage::PeerList { peers: remote_peers } => {
            for pid in remote_peers {
                let pc = create_pc(pid.clone(), sig_tx.clone(), local_track.clone(), mixer.clone(), api.clone().into(), ice_servers.clone(), handle.clone()).await?;
                let offer = pc.create_offer(None).await?;
                pc.set_local_description(offer.clone()).await?;
                let _ = sig_tx.send(SignalMessage::Offer { target: pid.clone(), sdp: serde_json::to_string(&offer).unwrap(), from: None });
                peers.insert(pid, pc);
            }
        }
        SignalMessage::Offer { sdp, from, .. } => {
            if let Some(pid) = from {
                let pc = create_pc(pid.clone(), sig_tx.clone(), local_track, mixer, api.clone().into(), ice_servers, handle).await?;
                pc.set_remote_description(serde_json::from_str(&sdp)?).await?;
                let answer = pc.create_answer(None).await?;
                pc.set_local_description(answer.clone()).await?;
                let _ = sig_tx.send(SignalMessage::Answer { target: pid.clone(), sdp: serde_json::to_string(&answer).unwrap(), from: None });
                peers.insert(pid, pc);
            }
        }
        SignalMessage::Answer { sdp, from, .. } => {
            if let Some(pid) = from {
                if let Some(pc) = peers.get(&pid) { pc.set_remote_description(serde_json::from_str(&sdp)?).await?; }
            }
        }
        SignalMessage::Ice { candidate, from, .. } => {
            if let Some(pid) = from {
                if let Some(pc) = peers.get(&pid) { let _ = pc.add_ice_candidate(serde_json::from_str(&candidate)?).await; }
            }
        }
        _ => {}
    }
    Ok(())
}