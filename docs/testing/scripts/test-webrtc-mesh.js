/**
 * WebRTC Mesh Connection Test (Node.js)
 * 
 * Tests WebRTC mesh topology without Tauri by using the webrtc crate's
 * Node.js bindings or a simplified peer connection simulation.
 * 
 * Note: Full WebRTC in Node.js requires native libraries. This script
 * tests the signaling flow and validates that the correct number of
 * peer connections would be established in a mesh topology.
 */

const WebSocket = require('ws');

/**
 * Simulate a WebRTC peer that connects via signaling server
 * and tracks connection state
 */
class MeshPeer {
  constructor(name, port = 8080) {
    this.name = name;
    this.ws = null;
    this.uuid = null;
    this.room = null;
    this.connections = new Map(); // peerId -> connection state
    this.port = port;
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${this.port}`);
      
      this.ws.on('open', () => {
        this.connected = true;
        this.ws.on('message', (data) => {
          const msg = JSON.parse(data);
          this.handleMessage(msg);
        });
        resolve();
      });

      this.ws.on('error', (err) => {
        console.error(`[${this.name}] Error:`, err.message);
        reject(err);
      });
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'Welcome':
        this.uuid = msg.data.uuid;
        console.log(`[${this.name}] Assigned UUID: ${this.uuid}`);
        break;
      
      case 'PeerList':
        const peers = msg.data.peers;
        console.log(`[${this.name}] Peers in room: ${peers.length}`);
        // In a real implementation, this peer would create Offer for each peer in the list
        peers.forEach(peerId => {
          this.initiateConnection(peerId);
        });
        break;
      
      case 'NewPeer':
        const newPeerId = msg.data.uuid;
        console.log(`[${this.name}] New peer joined: ${newPeerId}`);
        // In a real implementation, this peer would create Offer for the new peer
        this.initiateConnection(newPeerId);
        break;
      
      case 'Offer':
        if (msg.data.from) {
          console.log(`[${this.name}] Received Offer from ${msg.data.from}`);
          this.connections.set(msg.data.from, { state: 'receiving-offer' });
          // In real impl: create Answer and send back
          this.sendAnswer(msg.data.from, msg.data.sdp);
        }
        break;
      
      case 'Answer':
        if (msg.data.from) {
          console.log(`[${this.name}] Received Answer from ${msg.data.from}`);
          this.connections.set(msg.data.from, { state: 'connected' });
        }
        break;
      
      case 'Ice':
        // Handle ICE candidate
        break;
    }
  }

  initiateConnection(peerId) {
    if (peerId === this.uuid) return;
    if (this.connections.has(peerId)) return;
    
    console.log(`[${this.name}] Initiating connection to ${peerId}`);
    this.connections.set(peerId, { state: 'initiating' });
    
    // In real WebRTC: createOffer, setLocalDescription, send Offer via signaling
    this.sendOffer(peerId);
  }

  sendOffer(targetId) {
    const fakeSdp = `offer-sdp-${this.uuid}-to-${targetId}`;
    this.ws.send(JSON.stringify({
      type: 'Offer',
      data: { target: targetId, sdp: fakeSdp }
    }));
  }

  sendAnswer(targetId, offerSdp) {
    const fakeSdp = `answer-sdp-${this.uuid}-to-${targetId}`;
    this.ws.send(JSON.stringify({
      type: 'Answer',
      data: { target: targetId, sdp: fakeSdp }
    }));
    this.connections.set(targetId, { state: 'connected' });
  }

  joinRoom(room) {
    this.room = room;
    this.ws.send(JSON.stringify({ type: 'Join', data: { room } }));
  }

  getConnectionCount() {
    return this.connections.size;
  }

  getConnectionStates() {
    return Array.from(this.connections.entries()).map(([peerId, state]) => ({
      peerId,
      state: state.state
    }));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

/**
 * Test: Verify mesh topology connections
 * 
 * For N peers, each peer should have N-1 connections
 * Total connections in mesh = N × (N-1) / 2
 */
async function testMeshTopology() {
  console.log('\n=== Test: WebRTC Mesh Topology (3 Peers) ===\n');
  
  const peers = [
    new MeshPeer('Peer-A'),
    new MeshPeer('Peer-B'),
    new MeshPeer('Peer-C')
  ];
  
  try {
    // Connect all peers
    console.log('Connecting peers to signaling server...');
    await Promise.all(peers.map(p => p.connect()));
    await new Promise(r => setTimeout(r, 500));
    
    // Join same room
    console.log('\nJoining room "mesh-test"...');
    peers.forEach(p => p.joinRoom('mesh-test'));
    
    // Wait for signaling to complete
    await new Promise(r => setTimeout(r, 2000));
    
    // Verify mesh topology
    console.log('\n--- Mesh Topology Verification ---');
    let allConnected = true;
    
    peers.forEach((peer, idx) => {
      const connCount = peer.getConnectionCount();
      const expected = 2; // 3 peers - 1 = 2 connections each
      console.log(`[${peer.name}] Connections: ${connCount}/${expected}`);
      
      if (connCount !== expected) {
        allConnected = false;
        console.log(`  ✗ Expected ${expected} connections, got ${connCount}`);
      } else {
        console.log(`  ✓ Correct number of connections`);
        peer.getConnectionStates().forEach(conn => {
          console.log(`    → ${conn.peerId}: ${conn.state}`);
        });
      }
    });
    
    // Verify total unique connections
    const totalTrackedConnections = peers.reduce((sum, p) => sum + p.getConnectionCount(), 0);
    const expectedTotal = 6; // 3 peers × 2 connections / 2 (each counted twice) = 3 unique, but we track bidirectionally
    console.log(`\nTotal tracked connections: ${totalTrackedConnections}`);
    console.log(`Expected (bidirectional): ${expectedTotal}`);
    
    if (allConnected && totalTrackedConnections === expectedTotal) {
      console.log('\n✓ MESH TOPOLOGY TEST PASSED');
      return true;
    } else {
      console.log('\n✗ MESH TOPOLOGY TEST FAILED');
      return false;
    }
    
  } catch (err) {
    console.error('Test failed:', err.message);
    return false;
  } finally {
    peers.forEach(p => p.disconnect());
  }
}

/**
 * Test: 4-Peer Mesh
 */
async function testFourPeerMesh() {
  console.log('\n=== Test: WebRTC Mesh Topology (4 Peers) ===\n');
  
  const peers = [
    new MeshPeer('Peer-A'),
    new MeshPeer('Peer-B'),
    new MeshPeer('Peer-C'),
    new MeshPeer('Peer-D')
  ];
  
  try {
    await Promise.all(peers.map(p => p.connect()));
    await new Promise(r => setTimeout(r, 500));
    
    peers.forEach(p => p.joinRoom('4peer-mesh-test'));
    await new Promise(r => setTimeout(r, 3000));
    
    console.log('\n--- Mesh Topology Verification (4 Peers) ---');
    let allConnected = true;
    const expectedConn = 3; // 4 peers - 1 = 3 each
    
    peers.forEach(peer => {
      const connCount = peer.getConnectionCount();
      console.log(`[${peer.name}] Connections: ${connCount}/${expectedConn}`);
      if (connCount !== expectedConn) {
        allConnected = false;
      }
    });
    
    const totalTracked = peers.reduce((sum, p) => sum + p.getConnectionCount(), 0);
    const expectedTotal = 12; // 4 × 3 bidirectional
    console.log(`Total tracked connections: ${totalTracked}/${expectedTotal}`);
    
    if (allConnected && totalTracked === expectedTotal) {
      console.log('\n✓ 4-PEER MESH TEST PASSED');
      return true;
    } else {
      console.log('\n✗ 4-PEER MESH TEST FAILED');
      return false;
    }
    
  } catch (err) {
    console.error('Test failed:', err.message);
    return false;
  } finally {
    peers.forEach(p => p.disconnect());
  }
}

// Main execution
async function runAllTests() {
  console.log('Starting WebRTC Mesh Tests');
  console.log('Signaling server assumed running on port 8080!\n');
  
  // Skip server check - already verified
  // Run tests directly
  const results = {
    threePeerMesh: await testMeshTopology(),
    fourPeerMesh: await testFourPeerMesh()
  };
  
  console.log('\n=== Test Results ===');
  console.log(`3-Peer Mesh: ${results.threePeerMesh ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`4-Peer Mesh: ${results.fourPeerMesh ? '✓ PASS' : '✗ FAIL'}`);
  
  const allPassed = Object.values(results).every(r => r === true);
  console.log(`\nOverall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  
  process.exit(allPassed ? 0 : 1);
}

if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { MeshPeer, testMeshTopology, testFourPeerMesh };
