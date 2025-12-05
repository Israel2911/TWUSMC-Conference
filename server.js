const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const helmet = require('helmet'); // SECURITY: Hides server info
const cors = require('cors');     // SECURITY: Restricts access
const rateLimit = require('express-rate-limit'); // SECURITY: Prevents spam

const app = express();
const server = http.createServer(app);

// --- SECURITY CONFIGURATION ---
// 1. Secure Headers (Prevents XSS and Sniffing)
app.use(helmet({
  contentSecurityPolicy: false, // Allow YouTube iframes
}));

// 2. CORS (Only allow your own domain)
app.use(cors({
  origin: "*", // CHANGE THIS to your actual domain (e.g., "https://human-space.com") in production!
  methods: ["GET", "POST"]
}));

// 3. Rate Limiting (Prevents DDoS on the main page)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

app.use(express.static(path.join(__dirname, 'public')));

// Socket.io Security Setup
const io = new Server(server, {
  cors: {
    origin: "*", // CHANGE THIS in production
    methods: ["GET", "POST"]
  }
});

// --- GLOBAL STATE ---
let K = false; 
let T = 0;     
let R = {};    
let A = {};    
let userLiveStates = {}; 

// SECURITY: Admin Password for Kill Switch
const ADMIN_PASS = "TWU2025"; // CHANGE THIS!

// --- HISTORY STORAGE ---
const MAX_HISTORY = 60;
let chatHistory = []; 
let qaHistory = [];

// --- SECURITY & SPAM ---
const lastMsgTime = {};
const spamCount = {};
const RATE_LIMIT_MS = 800;
const MAX_MSG_LENGTH = 500;

// --- AI FACILITATOR ---
const AI_NAME = "🤖 Session Facilitator";
const AI_QUESTIONS = [
  "How do you see AI influencing moral decision-making in your field?",
  "What role does empathy play in the future of digital leadership?",
  "How can education systems adapt to the rapid pace of technological change?",
  "What is the biggest challenge for cross-cultural collaboration today?",
  "How do we maintain human connection in an increasingly virtual world?",
  "What defines 'scholarly excellence' in the age of artificial intelligence?",
  "Can leadership truly be taught, or is it an inherent trait enhanced by technology?"
];
let aiIndex = 0;

// AI Timer: 10 seconds for testing (Change back to 180000 for production)
setInterval(() => {
  if (K) return;
  const qText = AI_QUESTIONS[aiIndex];
  aiIndex = (aiIndex + 1) % AI_QUESTIONS.length;
  const threadData = {
    id: 'qa-' + Date.now(),
    user: AI_NAME,
    text: qText,
    country: 'System',
    isAi: true,
    replies: [],
    reactions: { '🎓':[], '💡':[], '🤝':[], '⭐':[], '📜':[] },
    flags: [] 
  };
  qaHistory.push(threadData);
  io.emit('qaIncoming', threadData);
}, 10000);

// Sanitize Input (Prevent HTML Injection)
function escapeHtml(text) {
  if (!text) return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "'");
}

io.on('connection', (socket) => {
  T++;
  userLiveStates[socket.id] = false; 
  
  socket.emit('initialLoad', { 
    chat: chatHistory, 
    qa: qaHistory,
    state: { isLive: userLiveStates[socket.id], isKilled: K }
  });
  
  io.emit('t', T);
  io.emit('r', R);

  socket.on('r', (tz) => {
    A[socket.id] = tz;
    if (!R[tz]) R[tz] = 0;
    R[tz]++;
    io.emit('r', R);
  });

  socket.on('x', () => {
    userLiveStates[socket.id] = !userLiveStates[socket.id];
    socket.emit('z', { isLive: userLiveStates[socket.id], isKilled: K });
  });

  // --- SECURE CHAT HANDLER ---
  socket.on('chatMsg', (payload) => {
    // 1. Rate Limit Check
    const now = Date.now();
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) {
      spamCount[socket.id] = (spamCount[socket.id] || 0) + 1;
      if (spamCount[socket.id] > 5) { socket.disconnect(); return; } // Ban spammer
      return;
    }
    lastMsgTime[socket.id] = now;
    spamCount[socket.id] = Math.max(0, (spamCount[socket.id] || 0) - 1);

    // 2. Length Limit Check
    if (!payload.text || payload.text.length > MAX_MSG_LENGTH) return;

    const msgData = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country),
      type: 'chat',
      flags: [],
      reactions: {} 
    };
    chatHistory.push(msgData);
    if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
    io.emit('chatIncoming', msgData);
  });

  socket.on('chatReact', (payload) => {
     const { id, emoji, user } = payload;
     const msg = chatHistory.find(m => m.id === id);
     if(msg) {
         if(!msg.reactions) msg.reactions = {};
         if(!msg.reactions[emoji]) msg.reactions[emoji] = [];
         
         const list = msg.reactions[emoji];
         const idx = list.indexOf(user);
         if(idx === -1) list.push(user); else list.splice(idx, 1); // Toggle
         
         io.emit('chatReactionUpdate', { id, reactions: msg.reactions });
     }
  });

  socket.on('chatFlag', (payload) => {
    const { id, user } = payload;
    const msg = chatHistory.find(m => m.id === id);
    if (msg) {
      if (msg.user === user) { // Self-delete
         chatHistory = chatHistory.filter(m => m.id !== id);
         io.emit('chatDeleted', id);
         return;
      }
      if (!msg.flags.includes(user)) {
        msg.flags.push(user);
        // MODERATION: 3 Flags = Auto Delete
        if (msg.flags.length >= 3) {
           chatHistory = chatHistory.filter(m => m.id !== id);
           io.emit('chatDeleted', id);
        }
      }
    }
  });

  socket.on('qaAsk', (payload) => {
    if (!payload.text || payload.text.length > MAX_MSG_LENGTH) return;
    const threadData = {
      id: 'qa-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country),
      replies: [],
      reactions: { '🎓':[], '💡':[], '🤝':[], '⭐':[], '📜':[] },
      flags: []
    };
    qaHistory.push(threadData);
    io.emit('qaIncoming', threadData);
  });

  socket.on('qaFlag', (payload) => {
    const { id, user } = payload;
    const thread = qaHistory.find(t => t.id === id);
    if (thread) {
      if (thread.user === user) {
         qaHistory = qaHistory.filter(t => t.id !== id);
         io.emit('qaDeleted', id);
         return;
      }
      if (!thread.flags.includes(user)) {
        thread.flags.push(user);
        if (thread.flags.length >= 3) {
           qaHistory = qaHistory.filter(t => t.id !== id);
           io.emit('qaDeleted', id);
        }
      }
    }
  });

  socket.on('qaReply', (payload) => {
    const replyData = { id: 'rep-' + Date.now(), user: escapeHtml(payload.user), text: escapeHtml(payload.text) };
    const thread = qaHistory.find(t => t.id === payload.threadId);
    if (thread) thread.replies.push(replyData);
    io.emit('qaReplyIncoming', { threadId: payload.threadId, ...replyData });
  });

  socket.on('qaReact', (payload) => {
    const { threadId, emoji, user } = payload;
    const allowed = ['🎓', '💡', '🤝', '⭐', '📜'];
    if (!allowed.includes(emoji)) return;
    const thread = qaHistory.find(t => t.id === threadId);
    if (thread) {
      if (!thread.reactions) thread.reactions = { '🎓':[], '💡':[], '🤝':[], '⭐':[], '📜':[] };
      if (!Array.isArray(thread.reactions[emoji])) thread.reactions[emoji] = [];
      const list = thread.reactions[emoji];
      const userIndex = list.indexOf(user);
      if (userIndex === -1) list.push(user); else list.splice(userIndex, 1);
      io.emit('qaReactionUpdate', { threadId, reactions: thread.reactions });
    }
  });

  // --- ADMIN KILL SWITCH (SECURED) ---
  socket.on('k', (password) => {
    // SECURITY: Only allow if password matches
    if (password !== ADMIN_PASS) {
      console.log("⚠️ Unauthorized Kill Attempt:", socket.id);
      return; 
    }
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
    io.emit('t', T);
    io.emit('r', R);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚀 Secure Server running on port ${PORT}`); });
