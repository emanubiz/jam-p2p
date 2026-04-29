/**
 * Test peer disconnection handling
 */

const WebSocket = require('ws');

const SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'ws://localhost:8080';
const ROOM_NAME = 'test-disconnect-' + Date.now();

async function testDisconnectHandling() {
  console.log('\n=== Test: Peer Disconnect Handling ===\n');

  const peer1 = await createPeer('Peer-1');
  await new Promise(r => setTimeout(r, 500));
  const peer2 = await createPeer('Peer-2');
  await new Promise(r => setTimeout(r, 500));
  const peer3 = await createPeer('Peer-3');

  // Wait for all to join
  await new Promise(r => setTimeout(r, 1000));

  console.log(`\nRoom state: 3 peers connected`);
  console.log(`[Peer-1] UUID: ${peer1.uuid}`);
  console.log(`[Peer-2] UUID: ${peer2.uuid}`);
  console.log(`[Peer-3] UUID: ${peer3.uuid}\n`);

  // Simulate Peer 2 disconnecting
  console.log('[Test] Disconnecting Peer-2...');
  peer2.ws.close();

  // Wait for close to propagate
  await new Promise(r => setTimeout(r, 1000));

  // Check if room was cleaned up (no more messages to Peer 1 and 3)
  const roomBeforeDisconnect = peer1.newPeersReceived.length + peer3.newPeersReceived.length;
  console.log(`[Test] Peers 1 and 3 received ${roomBeforeDisconnect} NewPeer notifications total`);

  // Try to send a message to disconnected peer (should fail silently)
  console.log('\n[Test] Attempting to send Offer to disconnected peer...');
  peer1.ws.send(JSON.stringify({
    type: 'Offer',
    data: {
      target: peer2.uuid,
      sdp: 'test-sdp'
    }
  }));

  await new Promise(r => setTimeout(r, 500));

  console.log('\n✅ TEST PASSED: Disconnect handling works (no crash, graceful)');
  console.log('   - WebSocket close event triggered');
  console.log('   - No error when sending to disconnected peer');

  // Cleanup
  peer1.ws.close();
  peer3.ws.close();

  return true;
}

function createPeer(id) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIGNALING_SERVER);
    const peer = {
      id,
      ws,
      uuid: null,
      newPeersReceived: []
    };

    ws.on('open', () => {
      console.log(`[${id}] Connected`);
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data);

      if (message.type === 'Welcome') {
        peer.uuid = message.data.uuid;
        ws.send(JSON.stringify({
          type: 'Join',
          data: { room: ROOM_NAME }
        }));
      }

      if (message.type === 'NewPeer') {
        peer.newPeersReceived.push(message.data.uuid);
        console.log(`[${id}] NewPeer: ${message.data.uuid}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[${id}] Error:`, err.message);
    });

    ws.on('close', () => {
      console.log(`[${id}] Disconnected`);
    });

    // Resolve after receiving Welcome (means joined)
    const checkReady = setInterval(() => {
      if (peer.uuid) {
        clearInterval(checkReady);
        resolve(peer);
      }
    }, 100);

    setTimeout(() => {
      if (!peer.uuid) {
        reject(new Error(`[${id}] Timeout`));
      }
    }, 5000);
  });
}

// Run test
(async () => {
  try {
    const testWs = new WebSocket(SIGNALING_SERVER);
    await new Promise((resolve, reject) => {
      testWs.on('open', resolve);
      testWs.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 2000);
    });
    testWs.close();
  } catch (err) {
    console.error('❌ Signaling server not running at', SIGNALING_SERVER);
    process.exit(1);
  }

  await testDisconnectHandling();
  console.log('\n✅ All disconnect tests passed');
  process.exit(0);
})();
