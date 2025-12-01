const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// L = live, K = killed, T = total, R = region counts, A = active clients
let L = false;   // is stream live
let K = false;   // has nuclear kill been activated
let T = 0;       // total users
let R = {};      // region counts { tz: count }
let A = {};      // active clients { socket.id: tz }

// Admin IPs (for now we log the IP and allow all, then you can tighten later)
const ADMINS = ['127.0.0.1']; // adjust later if you want strict IP check

io.on('connection', (socket) => {
  T++;
  console.log('🔌 Client connected:', socket.id, 'from', socket.handshake.address);

  // send initial state to new client
  socket.emit('z', L && !K); // live state
  io.emit('t', T);           // total viewers
  io.emit('r', R);           // region map

  // timezone report (region tracking)
  socket.on('r', (tz) => {
    A[socket.id] = tz;
    if (!R[tz]) R[tz] = 0;
    R[tz]++;
    io.emit('r', R);
  });

  // live toggle request (anyone)
  socket.on('x', () => {
    // if nuclear kill is active, ignore toggle
    if (K) {
      socket.emit('z', false);
      console.log('⛔ Live toggle blocked (kill active) from', socket.id);
      return;
    }
    L = !L;
    io.emit('z', L);
    console.log('🟢 Live toggled. Now live =', L);
  });

  // kill request (admin-only in future, for now allowed for testing)
  socket.on('k', () => {
    const ip = socket.handshake.address;
    console.log('⚠️ Kill requested from', ip);

    // For testing on Render, allow all IPs so you can verify behavior.
    // Later, you can uncomment this block and set ADMINS to your real IPs:
    /*
    if (!ADMINS.includes(ip)) {
      console.log('❌ Kill denied (not in ADMINS):', ip);
      return;
    }
    */

    // Nuclear kill: permanently mark killed and force live off
    K = true;
    L = false;

    // Tell all clients: not live anymore
    io.emit('z', false);

    // Tell all clients: destroy feed and show Teams backup
    io.emit('d');

    console.log('💀 NUCLEAR KILL ACTIVATED (all clients will drop video)');
  });

  // disconnect handling
  socket.on('disconnect', () => {
    T--;
    const tz = A[socket.id];
    if (tz && R[tz] > 0) {
      R[tz]--;
    }
    delete A[socket.id];

    io.emit('t', T);
    io.emit('r', R);

    console.log('🔌 Client disconnected:', socket.id);
  });
});

// heartbeat live state (keeps clients in sync if they reconnect)
setInterval(() => {
  io.emit('z', L && !K);
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
