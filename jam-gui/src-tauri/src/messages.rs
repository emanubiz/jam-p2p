use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "data")]
pub enum SignalMessage {
    Welcome {
        uuid: String,
    },
    Join {
        room: String,
        name: String,
    },
    PeerList {
        peers: Vec<String>,
    },
    NewPeer {
        uuid: String,
    },
    PeerLeft {
        uuid: String,
    },
    Offer {
        target: String,
        sdp: String,
        from: Option<String>,
    },
    Answer {
        target: String,
        sdp: String,
        from: Option<String>,
    },
    Ice {
        target: String,
        candidate: String,
        from: Option<String>,
    },
}

#[derive(Debug)]
pub enum AppCommand {
    Join {
        room: String,
        name: String,
        server: String,
        res_tx: tokio::sync::oneshot::Sender<Result<(), String>>,
    },
    Leave {
        res_tx: tokio::sync::oneshot::Sender<Result<(), String>>,
    },
    SetVolume {
        peer_id: String,
        vol: f32,
    },
    SetOpusBitrate {
        bitrate: i32,
    },
    SetMute {
        muted: bool,
    },
}
