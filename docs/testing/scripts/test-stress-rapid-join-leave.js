/**
 * TC-08: Rapid Peer Join/Leave Stress Test
 * 
 * Tests signaling server resilience under rapid peer changes
 * Simulates peers joining and leaving every 2 seconds
 */

const WebSocket = require('ws');

async function testRapidJoinLeave() {
  console.log('\n=== TC-08: Rapid Peer Join/Leave Stress Test ===\n');
  
  const SERVER_URL = 'ws://localhost:8080';
  const ROOM = 'stress-test-' + Date.now();
  const CYCLES = 5; // 5 peers join, then leave, repeated
  const PEERS_PER_CYCLE = 3;
  
  let successCount = 0;
  let failCount = 0;
  
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    console.log(`\n--- Cycle ${cycle + 1}/${CYCLES} ---`);
    
    // Create peers
    const peers = [];
    for (let i = 0; i < PEERS_PER_CYCLE; i++) {
      const peer = await createPeer(`P${cycle}-${i}`, SERVER_URL, ROOM);
      if (peer) {
        peers.push(peer);
        await new Promise(r => setTimeout(r, 100)); // Small delay between joins
      }
    }
    
    // Wait for all to settle
    await new Promise(r => setTimeout(r, 3000));
    
    // Verify all peers are in room
    const allJoined = peers.every(p => p.joined && p.uuid);
    const allNotified = peers.every(p => {
      const newPeerCount = p.received.filter(m => m.type === 'NewPeer').length;
      return newPeerCount === peers.length - 1;
    });
    
    if (allJoined && allNotified) {
      console.log(`✓ Cycle ${cycle + 1}: All ${PEERS_PER_CYCLE} peers joined successfully`);
      successCount++;
    } else {
      console.log(`✗ Cycle ${cycle + 1}: Failed - joined=${allJoined}, notified=${allNotified}`);
      failCount++;
    }
    
    // Disconnect all peers
    peers.forEach(p => {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) {
        p.ws.close();
      }
    });
    
    // Wait before next cycle
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n=== Results ===');
  console.log(`Passed: ${successCount}/${CYCLES}`);
  console.log(`Failed: ${failCount}/${CYCLES}`);
  
  if (failCount === 0) {
    console.log('\n✓ TC-08 STRESS TEST PASSED');
    return true;
  } else {
    console.log('\n✗ TC-08 STRESS TEST FAILED');
    return false;
  }
}

async function createPeer(name, serverUrl, room) {
  return new Promise((resolve) => {
    const ws = new WebSocket(serverUrl);
    const peer = {
      name,
      ws,
      uuid: null,
      joined: false,
      received: []
    };
    
    const timeout = setTimeout(() => {
      console.log(`[${name}] Timeout connecting`);
      resolve(null);
    }, 5000);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          peer.received.push(msg);
          
          if (msg.type === 'Welcome' && msg.data && msg.data.uuid) {
            peer.uuid = msg.data.uuid;
          }
          
          if (msg.type === 'PeerList' || msg.type === 'NewPeer') {
            // Send Join if not already joined
            if (!peer.joined && !peer.received.some(m => m.type === 'PeerList')) {
              ws.send(JSON.stringify({ type: 'Join', data: { room } }));
            }
          }
          
          if (msg.type === 'PeerList') {
            peer.joined = true;
          }
        } catch (e) {
          // Ignore parse errors
        }
      });
      
      // Initiate join
      ws.send(JSON.stringify({ type: 'Join', data: { room } }));
    });
    
    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    
    // Wait a bit for join to complete
    setTimeout(() => {
      resolve(peer);
    }, 500);
  });
}

// Main execution
async function run() {
  console.log('Starting TC-08: Rapid Peer Join/Leave Stress Test');
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
  
  const result = await testRapidJoinLeave();
  process.exit(result ? 0 : 1);
}

if (require.main === module) {
  run().catch(console.error);
}

module.exports = { testRapidJoinLeave };
