const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// GLOBAL STATE
let K = false;   // Killed State (Global Override)
let T = 0;       // Total Users
let R = {};      // Region Counts { tz: count }
let A = {};      // Active Client Timezones { socket.id: tz }

// USER STATES (Track individual toggle state)
// { "socket_id_1": true, "socket_id_2": false }
let userLiveStates = {}; 

// Admin IP Allowlist (Add real IPs later)
const ADMINS = ['127.0.0.1']; 

io.on('connection', (socket) => {
  T++;
  // Default new user to "Not Watching" (false)
  userLiveStates[socket.id] = false; 
  
  console.log('🔌 Client connected:', socket.id);

  // Send initial state to THIS user only
  // If Global Kill is active, they get Killed state. Otherwise, their local false state.
  socket.emit('z', { 
    isLive: userLiveStates[socket.id] && !K, 
    isKilled: K 
  });
  
  io.emit('t', T);
  io.emit('r', R);

  // Timezone Report
  socket.on('r', (tz) => {
    A[socket.id] = tz;
    if (!R[tz]) R[tz] = 0;
    R[tz]++;
    io.emit('r', R);
  });

  // TOGGLE REQUEST (User clicked "GO LIVE")
  socket.on('x', () => {
    // 1. If Global Kill is active, deny toggle & force update
    if (K) {
      socket.emit('z', { isLive: false, isKilled: true });
      console.log(`⛔ Toggle blocked for ${socket.id} (Kill Active)`);
      return;
    }

    // 2. Toggle THIS USER'S state only
    userLiveStates[socket.id] = !userLiveStates[socket.id];
    
    // 3. Send update to THIS USER only (socket.emit, NOT io.emit)
    socket.emit('z', { 
      isLive: userLiveStates[socket.id], 
      isKilled: false 
    });
    
    console.log(`👤 User ${socket.id} toggled view: ${userLiveStates[socket.id]}`);
  });

  // KILL REQUEST (Admin Only)
  socket.on('k', () => {
    const ip = socket.handshake.address;
    console.log('⚠️ Kill requested from', ip);

    /* Uncomment for IP security later
    if (!ADMINS.includes(ip)) return;
    */

    // 1. Set Global Kill Flag
    K = true;

    // 2. Reset all user states to "False" (optional, but cleaner)
    // Or just let K override them.
    for (let id in userLiveStates) {
      userLiveStates[id] = false; 
    }

    // 3. GLOBAL BROADCAST (io.emit)
    // Force everyone to "Killed" state immediately
    io.emit('z', { isLive: false, isKilled: true });
    
    // 4. Force Legacy Cleanup (removes iframe)
    io.emit('d'); 

    console.log('💀 NUCLEAR KILL ACTIVATED - All users forced to Teams Mode');
  });

  // Disconnect
  socket.on('disconnect', () => {
    T--;
    const tz = A[socket.id];
    if (tz && R[tz] > 0) R[tz]--;
    
    // Cleanup tracking maps
    delete A[socket.id];
    delete userLiveStates[socket.id];

    io.emit('t', T);
    io.emit('r', R);
    
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Heartbeat (Keep state in sync)
setInterval(() => {
  // We need to send unique states to each user, so io.emit doesn't work well here
  // unless we loop. But for performance, we can just emit global stats.
  // OR: simpler heartbeat just ensures connection.
  
  // If we really need state sync (e.g. server restart recovery), we iterate:
  const sockets = io.sockets.sockets; // Map of all connected sockets
  for (const [id, socket] of sockets) {
     if (userLiveStates[id] !== undefined) {
        socket.emit('z', { 
           isLive: userLiveStates[id] && !K, 
           isKilled: K 
        });
     }
  }
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
