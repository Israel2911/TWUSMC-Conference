const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- GLOBAL STATE ---
let K = false;   // Kill State
let T = 0;       // Total Users
let R = {};      // Region Counts
let A = {};      // Active Timezones
let userLiveStates = {}; 

// --- HISTORY STORAGE ---
const MAX_HISTORY = 50;
const chatHistory = []; 
const qaHistory = [];   

const lastMsgTime = {};
const RATE_LIMIT_MS = 500;

function escapeHtml(text) {
  if (!text) return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "'");
}

io.on('connection', (socket) => {
  T++;
  userLiveStates[socket.id] = false; 
  console.log('🔌 Client connected:', socket.id);

  // 1. Send Initial State + HISTORY
  socket.emit('z', { isLive: userLiveStates[socket.id], isKilled: K });
  socket.emit('initialLoad', { chat: chatHistory, qa: qaHistory });
  io.emit('t', T);
  io.emit('r', R);

  // 2. Timezone
  socket.on('r', (tz) => {
    A[socket.id] = tz;
    if (!R[tz]) R[tz] = 0;
    R[tz]++;
    io.emit('r', R);
  });

  // 3. Toggle
  socket.on('x', () => {
    userLiveStates[socket.id] = !userLiveStates[socket.id];
    socket.emit('z', { isLive: userLiveStates[socket.id], isKilled: K });
  });

  // --- CHAT HANDLER ---
  socket.on('chatMsg', (payload) => {
    const now = Date.now();
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) return;
    lastMsgTime[socket.id] = now;

    const msgData = {
      id: Date.now() + Math.random(),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country),
      type: 'chat'
    };
    chatHistory.push(msgData);
    if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
    io.emit('chatIncoming', msgData);
  });

  // --- Q&A HANDLER ---
  socket.on('qaAsk', (payload) => {
    const now = Date.now();
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) return;
    lastMsgTime[socket.id] = now;

    const threadData = {
      id: Date.now() + Math.random(),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country),
      replies: []
    };
    qaHistory.push(threadData);
    io.emit('qaIncoming', threadData);
  });

  // --- REPLY HANDLER ---
  socket.on('qaReply', (payload) => {
    const replyData = { user: escapeHtml(payload.user), text: escapeHtml(payload.text) };
    const thread = qaHistory.find(t => t.id == payload.threadId);
    if (thread) thread.replies.push(replyData);
    io.emit('qaReplyIncoming', { threadId: payload.threadId, ...replyData });
  });

  // --- KILL SWITCH ---
  socket.on('k', () => {
    K = true;
    for (let id in userLiveStates) userLiveStates[id] = false; 
    io.emit('z', { isLive: false, isKilled: true });
    io.emit('d'); 
  });

  socket.on('disconnect', () => {
    T--;
    const tz = A[socket.id];
    if (tz && R[tz] > 0) R[tz]--;
    delete A[socket.id];
    delete userLiveStates[socket.id];
    delete lastMsgTime[socket.id];
    io.emit('t', T);
    io.emit('r', R);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });
