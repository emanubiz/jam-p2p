/**
 * TC-09: Simultaneous Join Race Condition Test
 * 
 * Tests what happens when 3+ peers join the same room simultaneously
 * (within 100ms of each other)
 */

const WebSocket = require('ws');

async function testSimultaneousJoin() {
  console.log('\n=== TC-09: Simultaneous Join Race Condition Test ===\n');
  
  const SERVER_URL = 'ws://localhost:8080';
  const ROOM = 'race-test-' + Date.now();
  const NUM_PEERS = 3;
  
  console.log(`Connecting ${NUM_PEERS} peers simultaneously to room "${ROOM}"...`);
  
  // Create all peers and connect them
  const peerPromises = [];
  const peers = [];
  
  for (let i = 0; i < NUM_PEERS; i++) {
    peerPromises.push(createAndJoinPeer(`Peer-${i}`, SERVER_URL, ROOM));
  }
  
  // Wait for all peers to be created
  const results = await Promise.all(peerPromises);
  results.forEach((p, i) => {
    if (p) {
      peers.push(p);
      console.log(`[Peer-${i}] Connected with UUID: ${p.uuid}`);
    }
  });
  
  if (peers.length !== NUM_PEERS) {
    console.log(`✗ Only ${peers.length}/${NUM_PEERS} peers connected`);
    return false;
  }
  
  // Wait for all signaling to complete
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('\n--- Verification ---');
  
  let allCorrect = true;
  
  // Check each peer received correct notifications
  // Signaling server behavior:
  // - PeerList shows peers already in room BEFORE this peer joined
  // - NewPeer notifications received AFTER this peer joined
  peers.forEach((peer, idx) => {
    const newPeerNotifications = peer.received.filter(m => m.type === 'NewPeer');
    const peerListMsg = peer.received.find(m => m.type === 'PeerList');
    const expectedNewPeers = NUM_PEERS - idx - 1; // Peer-0 gets 2, Peer-1 gets 1, Peer-2 gets 0
    const expectedPeerList = idx; // Peer-0 gets 0, Peer-1 gets 1, Peer-2 gets 2
    
    console.log(`[${peer.name}] NewPeer notifications: ${newPeerNotifications.length}/${expectedNewPeers}`);
    
    if (newPeerNotifications.length !== expectedNewPeers) {
      console.log(`  ✗ Expected ${expectedNewPeers} NewPeer notifications, got ${newPeerNotifications.length}`);
      allCorrect = false;
    } else {
      console.log(`  ✓ Correct number of NewPeer notifications`);
    }
    
    if (peerListMsg) {
      const peerListCount = peerListMsg.data.peers.length;
      console.log(`[${peer.name}] PeerList count: ${peerListCount}/${expectedPeerList}`);
      if (peerListCount !== expectedPeerList) {
        console.log(`  ✗ Expected ${expectedPeerList} peers in PeerList, got ${peerListCount}`);
        allCorrect = false;
      } else {
        console.log(`  ✓ Correct PeerList count`);
      }
    } else {
      console.log(`[${peer.name}] No PeerList received`);
      allCorrect = false;
    }
    
    // Check for duplicate UUIDs in notifications
    const newPeerUuids = newPeerNotifications.map(m => m.data.uuid);
    const uniqueUuids = new Set(newPeerUuids);
    if (uniqueUuids.size !== newPeerUuids.length) {
      console.log(`  ✗ Duplicate UUIDs detected in notifications!`);
      allCorrect = false;
    } else {
      console.log(`  ✓ No duplicate UUIDs`);
    }
  });
  
  // Check for duplicate UUIDs across all peers
  const allUuids = peers.map(p => p.uuid);
  const uniqueAllUuids = new Set(allUuids);
  if (uniqueAllUuids.size !== allUuids.length) {
    console.log(`\n✗ Duplicate UUIDs across peers!`);
    console.log(`  UUIDs: ${allUuids.join(', ')}`);
    allCorrect = false;
  } else {
    console.log(`\n✓ All peer UUIDs are unique`);
  }
  
  // Check peer lists
  peers.forEach((peer) => {
    const peerListMsg = peer.received.find(m => m.type === 'PeerList');
    if (peerListMsg) {
      const peerList = peerListMsg.data.peers;
      console.log(`[${peer.name}] PeerList contains ${peerList.length} peers`);
      
      if (peerList.length !== NUM_PEERS - 1) {
        console.log(`  ✗ Expected ${NUM_PEERS - 1} peers in list, got ${peerList.length}`);
        allCorrect = false;
      }
    }
  });
  
  // Cleanup
  peers.forEach(p => { if (p.ws) p.ws.close(); });
  
  if (allCorrect) {
    console.log('\n✓ TC-09 SIMULTANEOUS JOIN TEST PASSED');
    return true;
  } else {
    console.log('\n✗ TC-09 SIMULTANEOUS JOIN TEST FAILED');
    return false;
  }
}

async function createAndJoinPeer(name, serverUrl, room) {
  return new Promise((resolve) => {
    const ws = new WebSocket(serverUrl);
    const peer = {
      name,
      ws,
      uuid: null,
      joined: false,
      received: []
    };
    
    let initialized = false;
    
    ws.on('open', () => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          peer.received.push(msg);
          
          if (msg.type === 'Welcome' && msg.data && msg.data.uuid) {
            peer.uuid = msg.data.uuid;
            // Send Join immediately after getting UUID
            ws.send(JSON.stringify({ type: 'Join', data: { room } }));
          }
          
          if (msg.type === 'PeerList') {
            peer.joined = true;
          }
        } catch (e) {
          // Ignore parse errors
        }
      });
    });
    
    ws.on('error', () => {
      resolve(null);
    });
    
    // Resolve after a short delay to allow signaling
    setTimeout(() => {
      resolve(peer);
    }, 500);
  });
}

// Main execution
async function run() {
  console.log('Starting TC-09: Simultaneous Join Race Condition Test');
  console.log('Make sure signaling server is running on port 8080!\n');
  
  // Quick server check
  try {
    const testWs = new WebSocket('ws://localhost:8080');
    await new Promise((resolve, reject) => {
      testWs.on('open', () => {
        testWs.close();
        resolve();
      });
      testWs.on('error', reject);
    });
  } catch (err) {
    console.error('ERROR: Signaling server not running on port 8080!');
    process.exit(1);
  }
  
  const result = await testSimultaneousJoin();
  process.exit(result ? 0 : 1);
}

if (require.main === module) {
  run().catch(console.error);
}

module.exports = { testSimultaneousJoin };
