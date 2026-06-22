use ::webrtc::ice_transport::ice_server::RTCIceServer;
use ::webrtc::peer_connection::configuration::RTCConfiguration;
use ::webrtc::peer_connection::RTCPeerConnection;
use ::webrtc::stats::StatsReportType;
use ::webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use ::webrtc::track::track_local::TrackLocal;
use anyhow::{Context, Result};
use opus::{Channels, Decoder};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::mpsc;

use crate::audio::{compute_audio_level, MixerMap};
use crate::config::RING_BUFFER_SIZE_MULT;
use crate::jitter_buffer::AdaptiveJitterBuffer;
use crate::messages::SignalMessage;

pub struct WebrtcContext {
    pub api: Arc<::webrtc::api::API>,
    pub local_track: Arc<TrackLocalStaticRTP>,
    pub mixer: Arc<Mutex<MixerMap>>,
    pub sig_tx: mpsc::Sender<SignalMessage>,
    pub handle: tauri::AppHandle,
    pub sample_rate: u32,
    pub samples_per_frame: usize,
}

pub struct PeerManager {
    peers: HashMap<String, Arc<RTCPeerConnection>>,
    /// uuid -> display name, learned from PeerList / NewPeer.
    names: HashMap<String, String>,
    /// ICE servers; seeded from config, overridden by the server's Welcome.
    ice_servers: Vec<RTCIceServer>,
}

impl PeerManager {
    pub fn new(ice_servers: Vec<RTCIceServer>) -> Self {
        PeerManager {
            peers: HashMap::new(),
            names: HashMap::new(),
            ice_servers,
        }
    }

    pub async fn handle_signal(
        &mut self,
        signal: SignalMessage,
        my_id: &mut Option<String>,
        ctx: &WebrtcContext,
    ) -> Result<()> {
        match signal {
            SignalMessage::Welcome { uuid, ice_servers } => {
                *my_id = Some(uuid);
                // Prefer the server-advertised ICE servers (single source of
                // truth); fall back to the config defaults already loaded.
                if !ice_servers.is_empty() {
                    self.ice_servers = ice_servers
                        .iter()
                        .map(|s| RTCIceServer {
                            urls: s.urls.clone(),
                            username: s.username.clone(),
                            credential: s.credential.clone(),
                            ..Default::default()
                        })
                        .collect();
                }
            }
            SignalMessage::Join { .. } => {}
            SignalMessage::PeerList {
                peers: remote_peers,
            } => {
                self.handle_peer_list(remote_peers, ctx).await;
            }
            SignalMessage::NewPeer { uuid: pid, name } => {
                // The newcomer received us in its PeerList and will send the
                // offer; we answer in the Offer handler. Offering here too would
                // make both sides offer simultaneously (glare) — each then hits
                // the `contains_key` guard below and drops the other's offer, so
                // no answer is ever produced and negotiation stalls. We only
                // remember the name so we can label the peer when it connects.
                self.names.insert(pid, name);
            }
            SignalMessage::Error { message } => {
                tracing::warn!("Signaling server error: {}", message);
                let _ = ctx.handle.emit("server-error", message);
            }
            SignalMessage::PeerLeft { uuid: pid } => {
                if let Some(pc) = self.peers.remove(&pid) {
                    let _ = pc.close().await;
                    let _ = ctx.handle.emit("peer-left", pid);
                }
            }
            SignalMessage::Offer { sdp, from, .. } => {
                if let Some(pid) = from {
                    self.handle_incoming_offer(&pid, &sdp, ctx).await?;
                }
            }
            SignalMessage::Answer { sdp, from, .. } => {
                if let Some(pid) = from {
                    self.handle_incoming_answer(&pid, &sdp).await?;
                }
            }
            SignalMessage::Ice {
                candidate, from, ..
            } => {
                if let Some(pid) = from {
                    self.handle_incoming_ice(&pid, &candidate).await?;
                }
            }
        }
        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }

    async fn handle_peer_list(
        &mut self,
        remote_peers: Vec<crate::messages::PeerInfo>,
        ctx: &WebrtcContext,
    ) {
        for peer in remote_peers {
            let pid = peer.uuid;
            if self.peers.contains_key(&pid) {
                continue;
            }
            self.names.insert(pid.clone(), peer.name.clone());
            let pc = match self
                .create_peer_connection(pid.clone(), peer.name.clone(), ctx)
                .await
            {
                Ok(pc) => pc,
                Err(e) => {
                    tracing::error!("Failed to create peer connection for {}: {:?}", pid, e);
                    continue;
                }
            };
            let offer = match pc.create_offer(None).await {
                Ok(o) => o,
                Err(e) => {
                    tracing::error!("Failed to create offer for {}: {:?}", pid, e);
                    continue;
                }
            };
            if let Err(e) = pc.set_local_description(offer.clone()).await {
                tracing::error!("Failed to set local description for {}: {:?}", pid, e);
                continue;
            }
            let sdp = match serde_json::to_string(&offer) {
                Ok(s) => s,
                Err(e) => {
                    tracing::error!("Failed to serialize offer for {}: {:?}", pid, e);
                    continue;
                }
            };
            let _ = ctx
                .sig_tx
                .send(SignalMessage::Offer {
                    target: pid.clone(),
                    sdp,
                    from: None,
                })
                .await;
            self.peers.insert(pid, pc);
        }
    }

    async fn handle_incoming_offer(
        &mut self,
        pid: &str,
        sdp: &str,
        ctx: &WebrtcContext,
    ) -> Result<()> {
        if self.peers.contains_key(pid) {
            return Ok(());
        }
        let name = self.names.get(pid).cloned().unwrap_or_default();
        let pc = self
            .create_peer_connection(pid.to_string(), name, ctx)
            .await?;
        pc.set_remote_description(serde_json::from_str(sdp)?)
            .await?;
        let answer = pc.create_answer(None).await?;
        pc.set_local_description(answer.clone()).await?;
        let answer_sdp = serde_json::to_string(&answer).context("failed to serialize answer")?;
        let _ = ctx
            .sig_tx
            .send(SignalMessage::Answer {
                target: pid.to_string(),
                sdp: answer_sdp,
                from: None,
            })
            .await;
        self.peers.insert(pid.to_string(), pc);
        Ok(())
    }

    async fn handle_incoming_answer(&self, pid: &str, sdp: &str) -> Result<()> {
        if let Some(pc) = self.peers.get(pid) {
            pc.set_remote_description(serde_json::from_str(sdp)?)
                .await?;
        }
        Ok(())
    }

    async fn handle_incoming_ice(&self, pid: &str, candidate: &str) -> Result<()> {
        if let Some(pc) = self.peers.get(pid) {
            let _ = pc.add_ice_candidate(serde_json::from_str(candidate)?).await;
        }
        Ok(())
    }

    pub async fn close_all(&mut self, handle: &tauri::AppHandle) {
        for (pid, pc) in self.peers.drain() {
            tracing::info!("Closing peer connection: {}", pid);
            let _ = pc.close().await;
            let _ = handle.emit("peer-left", pid);
        }
    }

    /// Poll WebRTC stats for each connected peer and emit Tauri events.
    pub async fn poll_and_emit_stats(&self, handle: &tauri::AppHandle) {
        let mut session_rtt_ms: f64 = 0.0;
        let mut session_rtt_count = 0u32;
        let mut session_packets_lost: i64 = 0;
        let mut session_bytes_in: u64 = 0;
        let mut session_bytes_out: u64 = 0;

        for (pid, pc) in &self.peers {
            let stats = pc.get_stats().await;
            let mut rtt_ms: Option<f64> = None;
            let mut candidate_pair_rtt_ms: Option<f64> = None;
            let mut packets_lost: i64 = 0;
            let mut bytes_received: u64 = 0;
            let mut bytes_sent: u64 = 0;

            for report in stats.reports.values() {
                match report {
                    StatsReportType::RemoteInboundRTP(s) if s.kind == "audio" => {
                        packets_lost = s.packets_lost;
                        if let Some(rtt) = s.round_trip_time {
                            rtt_ms = Some(rtt * 1000.0);
                        }
                    }
                    StatsReportType::InboundRTP(s) if s.kind == "audio" => {
                        bytes_received = s.bytes_received;
                    }
                    StatsReportType::OutboundRTP(s) if s.kind == "audio" => {
                        bytes_sent = s.bytes_sent;
                    }
                    StatsReportType::CandidatePair(s)
                        if s.nominated && s.current_round_trip_time > 0.0 =>
                    {
                        candidate_pair_rtt_ms = Some(s.current_round_trip_time * 1000.0);
                    }
                    _ => {}
                }
            }

            if rtt_ms.is_none() {
                rtt_ms = candidate_pair_rtt_ms;
            }

            if let Some(rtt) = rtt_ms {
                session_rtt_ms += rtt;
                session_rtt_count += 1;
            }
            session_packets_lost += packets_lost;
            session_bytes_in += bytes_received;
            session_bytes_out += bytes_sent;

            let _ = handle.emit(
                "peer-stats",
                serde_json::json!({
                    "id": pid,
                    "rttMs": rtt_ms,
                    "packetsLost": packets_lost,
                    "bytesReceived": bytes_received,
                    "bytesSent": bytes_sent,
                }),
            );
        }

        if session_rtt_count > 0 || session_bytes_in > 0 || session_bytes_out > 0 {
            let avg_rtt_ms = if session_rtt_count > 0 {
                Some(session_rtt_ms / f64::from(session_rtt_count))
            } else {
                None
            };
            let _ = handle.emit(
                "session-stats",
                serde_json::json!({
                    "avgRttMs": avg_rtt_ms,
                    "packetsLost": session_packets_lost,
                    "bytesReceived": session_bytes_in,
                    "bytesSent": session_bytes_out,
                }),
            );
        }
    }

    async fn create_peer_connection(
        &self,
        pid: String,
        name: String,
        ctx: &WebrtcContext,
    ) -> Result<Arc<RTCPeerConnection>> {
        let config = RTCConfiguration {
            ice_servers: self.ice_servers.clone(),
            ..Default::default()
        };
        let pc = ctx.api.new_peer_connection(config).await?;
        let track_auth = ctx.local_track.clone() as Arc<dyn TrackLocal + Send + Sync>;
        pc.add_track(track_auth).await?;

        let h_state_pc = ctx.handle.clone();
        let p_state = pid.clone();
        let name_state = name;
        pc.on_peer_connection_state_change(Box::new(move |s| {
            let h_emit = h_state_pc.clone();
            let p_clone = p_state.clone();
            let name_clone = name_state.clone();
            Box::pin(async move {
                match s {
                    ::webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState::Connected => {
                        tracing::info!("Peer {} connected", p_clone);
                        let _ = h_emit.emit(
                            "peer-joined",
                            serde_json::json!({ "id": p_clone, "name": name_clone }),
                        );
                    }
                    ::webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState::Disconnected => {
                        tracing::info!("Peer {} disconnected", p_clone);
                        let _ = h_emit.emit("peer-left", p_clone.clone());
                    }
                    ::webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState::Failed => {
                        tracing::warn!("Peer {} connection failed", p_clone);
                    }
                    _ => {}
                }
            })
        }));

        let mixer_clone = ctx.mixer.clone();
        let peer_id_clone = pid.clone();
        let handle_clone = ctx.handle.clone();
        let sample_rate = ctx.sample_rate;
        let samples_per_frame = ctx.samples_per_frame;
        pc.on_track(Box::new(move |track, _, _| {
            let mixer_inner = mixer_clone.clone();
            let p_inner = peer_id_clone.clone();
            let h_emit = handle_clone.clone();
            Box::pin(async move {
                tracing::info!("Received track from peer {}", p_inner);
                let jitter_buf = AdaptiveJitterBuffer::new(
                    sample_rate,
                    samples_per_frame,
                    RING_BUFFER_SIZE_MULT,
                );
                mixer_inner
                    .lock()
                    .insert(p_inner.clone(), (jitter_buf, 1.0));
                let mut dec = match Decoder::new(sample_rate, Channels::Mono) {
                    Ok(d) => d,
                    Err(e) => {
                        tracing::error!("Failed to create Opus decoder: {:?}", e);
                        return;
                    }
                };
                let mut pcm = vec![0f32; samples_per_frame * 2];
                let mut prev_level: f32 = 0.0f32;
                let mut last_emit = std::time::Instant::now();
                while let Ok((rtp, _)) = track.read_rtp().await {
                    if let Ok(len) = dec.decode_float(&rtp.payload, &mut pcm, false) {
                        let samples = &pcm[..len];
                        if let Some((buf, _)) = mixer_inner.lock().get_mut(&p_inner) {
                            buf.push_with_rtp_ts(samples, rtp.header.timestamp);
                        }
                        prev_level = compute_audio_level(samples, prev_level);
                        if last_emit.elapsed().as_millis() >= crate::config::VU_THROTTLE_MS {
                            let _ = h_emit.emit(
                                "peer-level",
                                serde_json::json!({ "id": p_inner, "level": prev_level }),
                            );
                            last_emit = std::time::Instant::now();
                        }
                    }
                }
                tracing::info!("Track from peer {} ended", p_inner);
                mixer_inner.lock().remove(&p_inner);
            })
        }));

        let tx_ice = ctx.sig_tx.clone();
        let p_ice = pid.clone();
        pc.on_ice_candidate(Box::new(move |c| {
            let tx = tx_ice.clone();
            let p = p_ice.clone();
            Box::pin(async move {
                if let Some(c) = c {
                    match c.to_json() {
                        Ok(j) => match serde_json::to_string(&j) {
                            Ok(candidate) => {
                                let _ = tx
                                    .send(SignalMessage::Ice {
                                        target: p,
                                        candidate,
                                        from: None,
                                    })
                                    .await;
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Failed to serialize ICE candidate for peer {}: {:?}",
                                    p,
                                    e
                                );
                            }
                        },
                        Err(e) => {
                            tracing::warn!(
                                "Failed to convert ICE candidate to JSON for peer {}: {:?}",
                                p,
                                e
                            );
                        }
                    }
                }
            })
        }));

        Ok(Arc::new(pc))
    }
}
