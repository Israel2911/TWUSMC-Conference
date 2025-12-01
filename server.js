const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// L = live, K = killed, T = total, R = region counts, A = active clients
let L = false;
let K = false;
let T = 0;
let R = {};
let A = {};

// TODO: set your own admin IP(s)
const ADMINS = ['127.0.0.1']; // add your IP here

io.on('connection', (socket) => {
  T++;
  socket.emit('z', L && !K);   // live state
  io.emit('t', T);             // total viewers
  io.emit('r', R);             // region map

  // timezone report
  socket.on('r', (tz) => {
    A[socket.id] = tz;
    if (!R[tz]) R[tz] = 0;
    R[tz]++;
    io.emit('r', R);
  });

  // live toggle request (anyone)
  socket.on('x', () => {
    if (K) {
      socket.emit('z', false);
      return;
    }
    L = !L;
    io.emit('z', L);
  });

  // kill request (admin only by IP)
  socket.on('k', () => {
    const ip = socket.handshake.address;
    if (!ADMINS.includes(ip)) {
      console.log('⚠️ Kill denied from', ip);
      return;
    }
    K = true;
    L = false;
    io.emit('z', false);
    io.emit('d'); // tell all clients to destroy feed
    console.log('💀 NUCLEAR KILL from', ip);
  });

  // disconnect
  socket.on('disconnect', () => {
    T--;
    const tz = A[socket.id];
    if (tz && R[tz] > 0) R[tz]--;
    delete A[socket.id];
    io.emit('t', T);
    io.emit('r', R);
  });
});

// heartbeat live state
setInterval(() => {
  io.emit('z', L && !K);
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
