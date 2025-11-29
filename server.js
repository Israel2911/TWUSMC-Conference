const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let isStreamLive = false;
let totalUsers = 0;

// Store active users: { "socket_id": "Asia/Kolkata" }
let activeClients = {};

// Store counts: { "Asia/Kolkata": 5, "America/New_York": 2 }
let regionCounts = {};

io.on('connection', (socket) => {
  totalUsers++;
  
  // Send current Live State immediately
  socket.emit('status-update', isStreamLive);
  io.emit('total-update', totalUsers);
  io.emit('region-update', regionCounts); // Send existing counts

  // 1. User reports their location (Timezone)
  socket.on('report-location', (timezone) => {
    activeClients[socket.id] = timezone;
    
    // Increment Region Count
    if (!regionCounts[timezone]) regionCounts[timezone] = 0;
    regionCounts[timezone]++;
    
    // Broadcast new map to everyone
    io.emit('region-update', regionCounts);
  });

  // 2. Admin Toggle
  socket.on('admin-toggle', (status) => {
    isStreamLive = status;
    io.emit('status-update', isStreamLive);
  });

  // 3. User leaves
  socket.on('disconnect', () => {
    totalUsers--;
    
    // Decrement their specific region
    const userTZ = activeClients[socket.id];
    if (userTZ && regionCounts[userTZ] > 0) {
      regionCounts[userTZ]--;
    }
    delete activeClients[socket.id];

    io.emit('total-update', totalUsers);
    io.emit('region-update', regionCounts);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
