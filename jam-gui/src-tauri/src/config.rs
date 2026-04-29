use webrtc::ice_transport::ice_server::RTCIceServer;

pub const FRAME_SIZE_MS: usize = 20;
pub const DEFAULT_OPUS_BITRATE: i32 = 64_000;
pub const RECONNECT_BASE_DELAY_MS: u64 = 1_000;
pub const RECONNECT_MAX_DELAY_MS: u64 = 30_000;
pub const RING_BUFFER_SIZE_MULT: usize = 4;
pub const RTP_PAYLOAD_TYPE: u8 = 111;
pub const EMA_ALPHA: f32 = 0.3;
pub const SILENCE_THRESHOLD_DBFS: f32 = -60.0;

pub const STUN_SERVER: &str = "stun:stun.l.google.com:19302";
pub const TURN_SERVER: &str = "turn:openrelay.metered.ca:80";
pub const TURN_USERNAME: &str = "openrelayproject";
pub const TURN_CREDENTIAL: &str = "openrelay";

pub fn default_ice_servers() -> Vec<RTCIceServer> {
    vec![
        RTCIceServer {
            urls: vec![STUN_SERVER.to_string()],
            ..Default::default()
        },
        RTCIceServer {
            urls: vec![TURN_SERVER.to_string()],
            username: TURN_USERNAME.to_string(),
            credential: TURN_CREDENTIAL.to_string(),
            ..Default::default()
        },
    ]
}
