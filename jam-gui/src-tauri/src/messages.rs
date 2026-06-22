use serde::{Deserialize, Serialize};

/// Events emitted from the WebSocket layer to signal lifecycle changes.
#[derive(Debug, Clone)]
pub enum WsEvent {
    /// The WS reader loop exited (connection dropped or closed).
    Disconnected,
}

/// One ICE server entry as advertised by the signaling server's `Welcome`.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct IceServerConfig {
    #[serde(default)]
    pub urls: Vec<String>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub credential: String,
}

/// A peer entry in a `PeerList`, carrying its display name.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerInfo {
    pub uuid: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "data")]
pub enum SignalMessage {
    Welcome {
        uuid: String,
        #[serde(rename = "iceServers", default)]
        ice_servers: Vec<IceServerConfig>,
    },
    Join {
        room: String,
        name: String,
    },
    PeerList {
        peers: Vec<PeerInfo>,
    },
    NewPeer {
        uuid: String,
        #[serde(default)]
        name: String,
    },
    PeerLeft {
        uuid: String,
    },
    /// Server-side error (e.g. room full, room limit reached).
    Error {
        message: String,
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

#[cfg(test)]
mod signal_tests {
    //! Wire-protocol regression tests. The serde names and shapes here are
    //! part of the contract with `jam-signaler/server.js`; if any of these
    //! break, the server and Rust client will silently fail to negotiate.
    use super::*;

    #[test]
    fn welcome_with_ice_servers_round_trip() {
        let msg = SignalMessage::Welcome {
            uuid: "abc".to_string(),
            ice_servers: vec![IceServerConfig {
                urls: vec!["stun:stun.l.google.com:19302".to_string()],
                username: "u".to_string(),
                credential: "p".to_string(),
            }],
        };
        let s = serde_json::to_string(&msg).unwrap();
        // Server emits `iceServers` (camelCase); rename on the Rust side
        // must produce the same key.
        assert!(s.contains("\"iceServers\""), "serialized JSON was: {s}");
        let back: SignalMessage = serde_json::from_str(&s).unwrap();
        match back {
            SignalMessage::Welcome { uuid, ice_servers } => {
                assert_eq!(uuid, "abc");
                assert_eq!(ice_servers.len(), 1);
                assert_eq!(ice_servers[0].urls[0], "stun:stun.l.google.com:19302");
                assert_eq!(ice_servers[0].username, "u");
                assert_eq!(ice_servers[0].credential, "p");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn welcome_without_ice_servers_uses_default() {
        // Backwards-compatible: a server that omits iceServers must still parse.
        let json = r#"{"type":"Welcome","data":{"uuid":"abc"}}"#;
        let msg: SignalMessage = serde_json::from_str(json).unwrap();
        match msg {
            SignalMessage::Welcome { uuid, ice_servers } => {
                assert_eq!(uuid, "abc");
                assert!(ice_servers.is_empty());
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn welcome_ice_server_with_optional_fields_omitted() {
        // STUN-only entries don't carry username/credential; default should
        // fill them with empty strings rather than failing the parse.
        let json = r#"{"type":"Welcome","data":{"uuid":"x","iceServers":[{"urls":["stun:s"]}]}}"#;
        let msg: SignalMessage = serde_json::from_str(json).unwrap();
        match msg {
            SignalMessage::Welcome { ice_servers, .. } => {
                assert_eq!(ice_servers.len(), 1);
                assert_eq!(ice_servers[0].urls, vec!["stun:s".to_string()]);
                assert_eq!(ice_servers[0].username, "");
                assert_eq!(ice_servers[0].credential, "");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn peer_list_with_names() {
        let json =
            r#"{"type":"PeerList","data":{"peers":[{"uuid":"a","name":"Alice"},{"uuid":"b"}]}}"#;
        let msg: SignalMessage = serde_json::from_str(json).unwrap();
        match msg {
            SignalMessage::PeerList { peers } => {
                assert_eq!(peers.len(), 2);
                assert_eq!(peers[0].uuid, "a");
                assert_eq!(peers[0].name, "Alice");
                assert_eq!(peers[1].uuid, "b");
                // Missing name field deserializes via #[serde(default)].
                assert_eq!(peers[1].name, "");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn new_peer_with_name() {
        let json = r#"{"type":"NewPeer","data":{"uuid":"x","name":"Bob"}}"#;
        let msg: SignalMessage = serde_json::from_str(json).unwrap();
        match msg {
            SignalMessage::NewPeer { uuid, name } => {
                assert_eq!(uuid, "x");
                assert_eq!(name, "Bob");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn new_peer_without_name_uses_default() {
        // Backwards-compatible: a server that omits name must still parse.
        let json = r#"{"type":"NewPeer","data":{"uuid":"x"}}"#;
        let msg: SignalMessage = serde_json::from_str(json).unwrap();
        match msg {
            SignalMessage::NewPeer { uuid, name } => {
                assert_eq!(uuid, "x");
                assert_eq!(name, "");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn error_message_round_trip() {
        let json = r#"{"type":"Error","data":{"message":"Room is full"}}"#;
        let msg: SignalMessage = serde_json::from_str(json).unwrap();
        match msg {
            SignalMessage::Error { ref message } => assert_eq!(message, "Room is full"),
            _ => panic!("wrong variant"),
        }
        let back = serde_json::to_string(&msg).unwrap();
        assert!(back.contains("Room is full"));
    }
}
