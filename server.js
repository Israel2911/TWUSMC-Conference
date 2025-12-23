const express = require('express'); 
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const helmet = require('helmet'); 
const cors = require('cors');     
const rateLimit = require('express-rate-limit'); 

const app = express();
const server = http.createServer(app);

// --- SECURITY CONFIGURATION ---
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
  })
);

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

app.use(express.static(path.join(__dirname, 'public'), { acceptRanges: false }));

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- GLOBAL STATE ---
let K = false;          // killed flag
let T = 0;              // total connections
let R = {};             // timezone counts
let A = {};             // socketId -> tz
let userLiveStates = {}; 
const ADMIN_PASS = "TWU2025"; 

const MAX_HISTORY = 60;
let chatHistory = []; 
let qaHistory = [];

const lastMsgTime = {};
const spamCount = {};
const RATE_LIMIT_MS = 800;
const MAX_MSG_LENGTH = 500;

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

// Helper: empty scholarly reaction map
function emptyReactions() {
  return { '🎓': [], '💡': [], '🤝': [], '⭐': [], '📜': [], '🧠': [] };
}

// *** AI TIMER: every 15 seconds ***
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
    reactions: emptyReactions(),
    flags: []
  };
  qaHistory.push(threadData);
  io.emit('qaIncoming', threadData);
}, 15000); // 15s [web:249]

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
  userLiveStates[socket.id] = false; 
  
  // send initial state (you are using 'history' on client now, keep both if needed)
  socket.emit('history', { chat: chatHistory, qa: qaHistory });
  socket.emit('z', { isLive: userLiveStates[socket.id], isKilled: K });

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

  // CHAT LOGIC
  socket.on('chatMsg', (payload) => {
    const now = Date.now();
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) return;
    lastMsgTime[socket.id] = now;

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
    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const list = msg.reactions[emoji];
      const idx = list.indexOf(user);
      if (idx === -1) list.push(user); else list.splice(idx, 1);
      io.emit('chatReactionUpdate', { id, reactions: msg.reactions });
    }
  });

  socket.on('chatFlag', (payload) => {
    const { id, user } = payload;
    const msg = chatHistory.find(m => m.id === id);
    if (msg) {
      if (!msg.flags.includes(user)) msg.flags.push(user);
      if (msg.flags.length >= 3 || msg.user === user) {
        chatHistory = chatHistory.filter(m => m.id !== id);
        io.emit('chatDeleted', id);
      }
    }
  });

  // QA LOGIC
  socket.on('qaAsk', (payload) => {
    if (!payload.text || payload.text.length > MAX_MSG_LENGTH) return;
    const threadData = {
      id: 'qa-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country),
      replies: [],
      reactions: emptyReactions(),
      flags: []
    };
    qaHistory.push(threadData);
    io.emit('qaIncoming', threadData);
  });

  socket.on('qaFlag', (payload) => {
    const { id, user } = payload;
    const thread = qaHistory.find(t => t.id === id);
    if (thread) {
      if (!thread.flags.includes(user)) thread.flags.push(user);
      if (thread.flags.length >= 3 || thread.user === user) {
        qaHistory = qaHistory.filter(t => t.id !== id);
        io.emit('qaDeleted', id);
      }
    }
  });

  socket.on('qaReply', (payload) => {
    if (!payload.text || payload.text.length > MAX_MSG_LENGTH) return;
    const replyData = { 
      id: 'rep-' + Date.now(),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      reactions: emptyReactions()
    };
    const thread = qaHistory.find(t => t.id === payload.threadId);
    if (thread) thread.replies.push(replyData);
    io.emit('qaReplyIncoming', { threadId: payload.threadId, ...replyData });
  });

  socket.on('qaReact', (payload) => {
    const { threadId, emoji, user } = payload;
    const allowed = ['🎓', '💡', '🤝', '⭐', '📜', '🧠'];  // allow 🧠
    if (!allowed.includes(emoji)) return;

    const thread = qaHistory.find(t => t.id === threadId);
    if (thread) {
      if (!thread.reactions) thread.reactions = emptyReactions();
      if (!Array.isArray(thread.reactions[emoji])) thread.reactions[emoji] = [];
      const list = thread.reactions[emoji];
      const idx = list.indexOf(user);
      if (idx === -1) list.push(user); else list.splice(idx, 1);
      io.emit('qaReactionUpdate', { threadId, reactions: thread.reactions });
    }
  });

  socket.on('qaReplyReact', (payload) => {
    const { threadId, replyId, emoji, user } = payload;
    const allowed = ['🎓', '💡', '🤝', '⭐', '📜', '🧠']; 
    if (!allowed.includes(emoji)) return;

    const thread = qaHistory.find(t => t.id === threadId);
    if (thread && thread.replies) {
      const reply = thread.replies.find(r => r.id === replyId);
      if (reply) {
        if (!reply.reactions) reply.reactions = emptyReactions();
        if (!reply.reactions[emoji]) reply.reactions[emoji] = [];
        const list = reply.reactions[emoji];
        const idx = list.indexOf(user);
        if (idx === -1) list.push(user); else list.splice(idx, 1);
        io.emit('qaReplyReactionUpdate', { threadId, replyId, reactions: reply.reactions });
      }
    }
  });

  // Admin kill
  socket.on('k', (password) => {
    if (password !== ADMIN_PASS) return;
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
server.listen(PORT, () => {
  console.log(`🚀 Secure Server running on port ${PORT}`);
});
