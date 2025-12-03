const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// GLOBAL STATE & SECURITY
// ==========================================
let K = false;   // Killed State (Global Override)
let T = 0;       // Total Users
let R = {};      // Region Counts { tz: count }
let A = {};      // Active Client Timezones { socket.id: tz }
let userLiveStates = {}; // Track individual toggle state

// Rate Limiting Tracker { socket.id: lastMessageTime }
const lastMsgTime = {};
const RATE_LIMIT_MS = 500; // Minimum 0.5s between messages

// --- SECURITY HELPER: Prevent XSS Injection ---
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

io.on('connection', (socket) => {
  T++;
  // Default new user to "Not Watching"
  userLiveStates[socket.id] = false; 
  
  console.log('🔌 Client connected:', socket.id);

  // 1. Send initial state
  socket.emit('z', { 
    isLive: userLiveStates[socket.id], 
    isKilled: K 
  });
  
  io.emit('t', T);
  io.emit('r', R);

  // 2. Timezone Report
  socket.on('r', (tz) => {
    A[socket.id] = tz;
    if (!R[tz]) R[tz] = 0;
    R[tz]++;
    io.emit('r', R);
  });

  // 3. TOGGLE REQUEST (User clicked "GO LIVE")
  socket.on('x', () => {
    // Toggle THIS USER'S state
    userLiveStates[socket.id] = !userLiveStates[socket.id];
    
    // Send update to THIS USER only
    socket.emit('z', { 
      isLive: userLiveStates[socket.id], 
      isKilled: K 
    });
    
    console.log(`👤 User ${socket.id} toggled view: ${userLiveStates[socket.id]} (Killed: ${K})`);
  });

  // ==========================================
  // SECURE CHAT & Q&A HANDLERS
  // ==========================================
  
  // Handle Chat Messages
  socket.on('chatMsg', (payload) => {
    // Rate Limit Check
    const now = Date.now();
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) {
      return; // Ignore spam
    }
    lastMsgTime[socket.id] = now;

    // Sanitize Input (Prevent Hacking)
    const safeUser = escapeHtml(payload.user);
    const safeText = escapeHtml(payload.text);
    const safeCountry = escapeHtml(payload.country);

    // Broadcast to ALL clients
    io.emit('chatIncoming', {
      id: Date.now() + Math.random(),
      user: safeUser,
      text: safeText,
      country: safeCountry,
      type: 'chat'
    });
  });

  // Handle Q&A Questions
  socket.on('qaAsk', (payload) => {
    // Rate Limit Check
    const now = Date.now();
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) return;
    lastMsgTime[socket.id] = now;

    const safeUser = escapeHtml(payload.user);
    const safeText = escapeHtml(payload.text);
    const safeCountry = escapeHtml(payload.country);

    // Broadcast Question
    io.emit('qaIncoming', {
      id: Date.now() + Math.random(),
      user: safeUser,
      text: safeText,
      country: safeCountry
    });
  });

  // Handle Q&A Replies
  socket.on('qaReply', (payload) => {
    const safeUser = escapeHtml(payload.user);
    const safeText = escapeHtml(payload.text);
    const threadId = payload.threadId; // ID is usually safe, but treat carefully

    // Broadcast Reply
    io.emit('qaReplyIncoming', {
      threadId: threadId,
      user: safeUser,
      text: safeText
    });
  });

  // ==========================================
  // ADMIN ACTIONS
  // ==========================================

  // KILL REQUEST (Admin Only)
  socket.on('k', () => {
    const ip = socket.handshake.address;
    console.log('⚠️ Kill requested from', ip);

    // 1. Set Global Kill Flag
    K = true;

    // 2. Reset all user states to "False"
    for (let id in userLiveStates) {
      userLiveStates[id] = false; 
    }

    // 3. GLOBAL BROADCAST: Force everyone OFF
    io.emit('z', { isLive: false, isKilled: true });
    
    // 4. Force Legacy Cleanup
    io.emit('d'); 

    console.log('💀 NUCLEAR KILL ACTIVATED');
  });

  // Disconnect
  socket.on('disconnect', () => {
    T--;
    const tz = A[socket.id];
    if (tz && R[tz] > 0) R[tz]--;
    
    delete A[socket.id];
    delete userLiveStates[socket.id];
    delete lastMsgTime[socket.id];

    io.emit('t', T);
    io.emit('r', R);
    
    console.log('🔌 Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
