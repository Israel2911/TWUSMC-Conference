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
let userLiveStates = {}; 

// Admin IP Allowlist (Add real IPs later)
const ADMINS = ['127.0.0.1']; 

io.on('connection', (socket) => {
  T++;
  // Default new user to "Not Watching"
  userLiveStates[socket.id] = false; 
  
  console.log('🔌 Client connected:', socket.id);

  // Send initial state
  socket.emit('z', { 
    isLive: userLiveStates[socket.id], 
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
    // FIX: We do NOT block the toggle anymore if K is true.
    // We allow the user to turn their view ON so they can see the Teams link.
    
    // Toggle THIS USER'S state
    userLiveStates[socket.id] = !userLiveStates[socket.id];
    
    // Send update to THIS USER only
    socket.emit('z', { 
      isLive: userLiveStates[socket.id], 
      isKilled: K 
    });
    
    console.log(`👤 User ${socket.id} toggled view: ${userLiveStates[socket.id]} (Killed: ${K})`);
  });

  // KILL REQUEST (Admin Only)
  socket.on('k', () => {
    const ip = socket.handshake.address;
    console.log('⚠️ Kill requested from', ip);

    // 1. Set Global Kill Flag
    K = true;

    // 2. Reset all user states to "False" so they are forced off initially
    // They must click "GO LIVE" again to see the Teams link
    for (let id in userLiveStates) {
      userLiveStates[id] = false; 
    }

    // 3. GLOBAL BROADCAST
    // Force everyone to close their screens immediately
    io.emit('z', { isLive: false, isKilled: true });
    
    // 4. Force Legacy Cleanup (removes iframe)
    io.emit('d'); 

    console.log('💀 NUCLEAR KILL ACTIVATED - Users reset to off');
  });

  // Disconnect
  socket.on('disconnect', () => {
    T--;
    const tz = A[socket.id];
    if (tz && R[tz] > 0) R[tz]--;
    
    delete A[socket.id];
    delete userLiveStates[socket.id];

    io.emit('t', T);
    io.emit('r', R);
    
    console.log('🔌 Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
