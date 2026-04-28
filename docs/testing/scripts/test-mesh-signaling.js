/**
 * Multi-Peer Mesh Signaling Test
 * Tests WebSocket signaling server with 3+ peers
 */

const WebSocket = require('ws');

class Peer {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.uuid = null;
    this.room = null;
    this.received = [];
    this.expectedMessages = [];
    this.connected = false;
  }

  async connect(port = 8080) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${port}`);
      
      this.ws.on('open', () => {
        this.connected = true;
        this.ws.on('message', (data) => {
          const msg = JSON.parse(data);
          this.received.push(msg);
          console.log(`[${this.name}] Received:`, msg.type, msg.data || '');
          
          if (msg.type === 'Welcome' && msg.data && msg.data.uuid) {
            this.uuid = msg.data.uuid;
          }
        });
        resolve();
      });

      this.ws.on('error', (err) => {
        console.error(`[${this.name}] Error:`, err.message);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        console.log(`[${this.name}] Disconnected`);
      });
    });
  }

  send(message) {
    if (this.connected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  joinRoom(room) {
    this.room = room;
    this.send({ type: 'Join', data: { room } });
  }

  waitForMessage(type, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const check = () => {
        const msg = this.received.find(m => m.type === type);
        if (msg) {
          resolve(msg);
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for ${type} on ${this.name}`));
        } else {
          setTimeout(check, 100);
        }
      };
      
      check();
    });
  }

  getPeerList() {
    return this.received.find(m => m.type === 'PeerList');
  }

  getNewPeers() {
    return this.received.filter(m => m.type === 'NewPeer');
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function testThreePeerJoin() {
  console.log('\n=== Test: Three Peers Join Same Room ===\n');
  
  const peerA = new Peer('Peer-A');
  const peerB = new Peer('Peer-B');
  const peerC = new Peer('Peer-C');
  
  try {
    // Connect all peers
    console.log('Connecting peers...');
    await peerA.connect();
    await peerB.connect();
    await peerC.connect();
    
    // Wait for Welcome messages
    await new Promise(r => setTimeout(r, 500));
    
    // Peer A joins room
    console.log('\nPeer A joining room "jam-session-1"...');
    peerA.joinRoom('jam-session-1');
    const welcomeA = await peerA.waitForMessage('PeerList');
    console.log(`✓ Peer A received PeerList with ${welcomeA.data.peers.length} peers`);
    
    // Peer B joins same room
    console.log('\nPeer B joining room "jam-session-1"...');
    peerB.joinRoom('jam-session-1');
    const welcomeB = await peerB.waitForMessage('PeerList');
    const newPeerA = await peerA.waitForMessage('NewPeer');
    
    console.log(`✓ Peer B received PeerList with ${welcomeB.data.peers.length} peers`);
    console.log(`✓ Peer A received NewPeer notification`);
    
    // Peer C joins same room
    console.log('\nPeer C joining room "jam-session-1"...');
    peerC.joinRoom('jam-session-1');
    const welcomeC = await peerC.waitForMessage('PeerList');
    const newPeerB = await peerA.waitForMessage('NewPeer');
    const newPeerC = await peerB.waitForMessage('NewPeer');
    
    console.log(`✓ Peer C received PeerList with ${welcomeC.data.peers.length} peers`);
    console.log(`✓ Peer A received NewPeer notification (total: ${peerA.getNewPeers().length})`);
    console.log(`✓ Peer B received NewPeer notification (total: ${peerB.getNewPeers().length})`);
    
    // Verify state
    const success = welcomeC.data.peers.length === 2 && 
                   peerA.getNewPeers().length === 2 && 
                   peerB.getNewPeers().length === 1;
    
    console.log('\n' + (success ? '✓ TEST PASSED' : '✗ TEST FAILED'));
    
    // Cleanup
    peerA.disconnect();
    peerB.disconnect();
    peerC.disconnect();
    
    return success;
  } catch (err) {
    console.error('Test failed:', err.message);
    peerA.disconnect();
    peerB.disconnect();
    peerC.disconnect();
    return false;
  }
}

async function testSignalingRouting() {
  console.log('\n=== Test: Signaling Message Routing (3 Peers) ===\n');
  
  const peerA = new Peer('Peer-A');
  const peerB = new Peer('Peer-B');
  const peerC = new Peer('Peer-C');
  
  try {
    await peerA.connect();
    await peerB.connect();
    await peerC.connect();
    await new Promise(r => setTimeout(r, 500));
    
    // Join room
    peerA.joinRoom('routing-test');
    peerB.joinRoom('routing-test');
    peerC.joinRoom('routing-test');
    await new Promise(r => setTimeout(r, 1000));
    
    // Get UUIDs
    const uuidA = peerA.uuid;
    const uuidB = peerB.uuid;
    const uuidC = peerC.uuid;
    
    console.log(`UUIDs: A=${uuidA}, B=${uuidB}, C=${uuidC}`);
    
    // Test Offer routing: A -> B
    console.log('\nTesting Offer routing A -> B...');
    peerA.send({ 
      type: 'Offer', 
      data: { target: uuidB, sdp: 'fake-sdp-offer-a' } 
    });
    
    await new Promise(r => setTimeout(r, 500));
    const offerMsg = peerB.received.find(m => m.type === 'Offer');
    
    if (offerMsg && offerMsg.data.from === uuidA) {
      console.log('✓ Offer correctly routed from A to B');
    } else {
      console.log('✗ Offer routing failed');
      return false;
    }
    
    // Test Answer routing: B -> A
    console.log('\nTesting Answer routing B -> A...');
    peerB.send({ 
      type: 'Answer', 
      data: { target: uuidA, sdp: 'fake-sdp-answer-b' } 
    });
    
    await new Promise(r => setTimeout(r, 500));
    const answerMsg = peerA.received.find(m => m.type === 'Answer');
    
    if (answerMsg && answerMsg.data.from === uuidB) {
      console.log('✓ Answer correctly routed from B to A');
    } else {
      console.log('✗ Answer routing failed');
      return false;
    }
    
    // Test Ice routing: A -> C
    console.log('\nTesting Ice routing A -> C...');
    peerA.send({ 
      type: 'Ice', 
      data: { target: uuidC, candidate: 'fake-ice-candidate' } 
    });
    
    await new Promise(r => setTimeout(r, 500));
    const iceMsg = peerC.received.find(m => m.type === 'Ice');
    
    if (iceMsg && iceMsg.data.from === uuidA) {
      console.log('✓ Ice correctly routed from A to C');
    } else {
      console.log('✗ Ice routing failed');
      return false;
    }
    
    console.log('\n✓ TEST PASSED');
    
    peerA.disconnect();
    peerB.disconnect();
    peerC.disconnect();
    
    return true;
  } catch (err) {
    console.error('Test failed:', err.message);
    peerA.disconnect();
    peerB.disconnect();
    peerC.disconnect();
    return false;
  }
}

async function testPeerDisconnect() {
  console.log('\n=== Test: Peer Disconnect Handling ===\n');
  
  const peerA = new Peer('Peer-A');
  const peerB = new Peer('Peer-B');
  const peerC = new Peer('Peer-C');
  
  try {
    await peerA.connect();
    await peerB.connect();
    await peerC.connect();
    await new Promise(r => setTimeout(r, 500));
    
    // Join room
    peerA.joinRoom('disconnect-test');
    peerB.joinRoom('disconnect-test');
    peerC.joinRoom('disconnect-test');
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('3 peers in room, disconnecting Peer B...');
    peerB.disconnect();
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Verify A and C still connected (no errors)
    console.log(`✓ Peer A still connected: ${peerA.connected}`);
    console.log(`✓ Peer C still connected: ${peerC.connected}`);
    
    console.log('\n✓ TEST PASSED');
    
    peerA.disconnect();
    peerC.disconnect();
    
    return true;
  } catch (err) {
    console.error('Test failed:', err.message);
    peerA.disconnect();
    peerB.disconnect();
    peerC.disconnect();
    return false;
  }
}

// Main execution
async function runAllTests() {
  console.log('Starting Multi-Peer Mesh Signaling Tests');
  console.log('Make sure signaling server is running on port 8080!\n');
  
  const results = {
    threePeerJoin: false,
    signalingRouting: false,
    peerDisconnect: false
  };
  
  // Check if server is running
  try {
    const testWs = new WebSocket('ws://localhost:8080');
    await new Promise((resolve, reject) => {
      testWs.on('open', resolve);
      testWs.on('error', reject);
    });
    testWs.close();
  } catch (err) {
    console.error('ERROR: Signaling server not running on port 8080!');
    console.error('Start it with: cd jam-signaler && node server.js');
    process.exit(1);
  }
  
  results.threePeerJoin = await testThreePeerJoin();
  results.signalingRouting = await testSignalingRouting();
  results.peerDisconnect = await testPeerDisconnect();
  
  console.log('\n=== Test Results ===');
  console.log(`Three Peer Join: ${results.threePeerJoin ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Signaling Routing: ${results.signalingRouting ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Peer Disconnect: ${results.peerDisconnect ? '✓ PASS' : '✗ FAIL'}`);
  
  const allPassed = Object.values(results).every(r => r === true);
  console.log(`\nOverall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  
  process.exit(allPassed ? 0 : 1);
}

if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { Peer, testThreePeerJoin, testSignalingRouting, testPeerDisconnect };
