const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

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

// GLOBAL STATE
let K = false;
let T = 0;
let R = {};
let A = {};
let userLiveStates = {};
const ADMIN_PASS = "TWU2025";

const MAX_HISTORY = 60;
let chatHistory = [];
let qaHistory = [];

const lastMsgTime = {};
const RATE_LIMIT_MS = 800;
const MAX_MSG_LENGTH = 500;

// AI facilitator
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

// NEW: facilitator drip control
let lastAiPostAt = 0;
const AI_COOLDOWN_MS = 30000; // 30 seconds

function emptyReactions() {
  return { '🎓': [], '💡': [], '🤝': [], '⭐': [], '📜': [], '🧠': [] };
}

// Facilitator loop (checks often, posts at most every 30s)
setInterval(() => {
  if (K) return; // killed

  const now = Date.now();
  if (now - lastAiPostAt < AI_COOLDOWN_MS) return; // enforce 30s gap
  lastAiPostAt = now;

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
}, 5000); // check every 5s; real posts obey 30s cooldown

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "'");
}

io.on('connection', (socket) => {
  T++;
  userLiveStates[socket.id] = false;

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

  // per-viewer GO LIVE
  socket.on('x', () => {
    userLiveStates[socket.id] = !userLiveStates[socket.id];
    socket.emit('z', { isLive: userLiveStates[socket.id], isKilled: K });
  });

  // CHAT
  socket.on('chatMsg', (payload) => {
    const now = Date.now();
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) return;
    lastMsgTime[socket.id] = now;

    if (!payload.text || payload.text.length > MAX_MSG_LENGTH) return;

    const msgData = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country || ''),
      type: 'chat',
      flags: [],
      reactions: {}
    };
    chatHistory.push(msgData);
    if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
    io.emit('chatIncoming', msgData);
  });

  socket.on('chatReact', ({ id, emoji, user }) => {
    const msg = chatHistory.find(m => m.id === id);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const list = msg.reactions[emoji];
    const idx = list.indexOf(user);
    if (idx === -1) list.push(user); else list.splice(idx, 1);
    io.emit('chatReactionUpdate', { id, reactions: msg.reactions });
  });

  socket.on('chatFlag', ({ id, user }) => {
    const msg = chatHistory.find(m => m.id === id);
    if (!msg) return;

    if (!msg.flags) msg.flags = [];
    if (!msg.flags.includes(user)) msg.flags.push(user);

    const shouldDelete = msg.flags.length >= 3 || msg.user === user;
    if (shouldDelete) {
      chatHistory = chatHistory.filter(m => m.id !== id);
      io.emit('chatDeleted', id);

      const notice = {
        id: 'sys-' + Date.now(),
        user: '🛡 Community Notice',
        text: "A message was removed after being red-flagged by our community. Disagreement is welcome, but posts must remain respectful. Please flag harmful or inappropriate content so we can keep this space safe.",
        country: 'System',
        type: 'chat',
        flags: [],
        reactions: {}
      };
      chatHistory.push(notice);
      if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
      io.emit('chatIncoming', notice);
    } else {
      io.emit('chatFlagUpdate', { id, flags: msg.flags });
    }
  });

  // QA threads
  socket.on('qaAsk', (payload) => {
    if (!payload.text || payload.text.length > MAX_MSG_LENGTH) return;
    const threadData = {
      id: 'qa-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country || ''),
      replies: [],
      reactions: emptyReactions(),
      flags: []
    };
    qaHistory.push(threadData);
    io.emit('qaIncoming', threadData);
  });

  socket.on('qaFlag', ({ id, user }) => {
    const thread = qaHistory.find(t => t.id === id);
    if (!thread) return;

    if (!thread.flags) thread.flags = [];
    if (!thread.flags.includes(user)) thread.flags.push(user);

    const shouldDelete = thread.flags.length >= 3 || thread.user === user;
    if (shouldDelete) {
      qaHistory = qaHistory.filter(t => t.id !== id);
      io.emit('qaDeleted', id);
    } else {
      io.emit('qaFlagUpdate', { id, flags: thread.flags });
    }
  });

  socket.on('qaReply', (payload) => {
    if (!payload.text || payload.text.length > MAX_MSG_LENGTH) return;
    const replyData = {
      id: 'rep-' + Date.now(),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      reactions: emptyReactions(),
      flags: []
    };
    const thread = qaHistory.find(t => t.id === payload.threadId);
    if (thread) {
      if (!thread.replies) thread.replies = [];
      thread.replies.push(replyData);
    }
    io.emit('qaReplyIncoming', { threadId: payload.threadId, ...replyData });
  });

  socket.on('qaReact', ({ threadId, emoji, user }) => {
    const allowed = ['🎓', '💡', '🤝', '⭐', '📜', '🧠'];
    if (!allowed.includes(emoji)) return;
    const thread = qaHistory.find(t => t.id === threadId);
    if (!thread) return;
    if (!thread.reactions) thread.reactions = emptyReactions();
    if (!Array.isArray(thread.reactions[emoji])) thread.reactions[emoji] = [];
    const list = thread.reactions[emoji];
    const idx = list.indexOf(user);
    if (idx === -1) list.push(user); else list.splice(idx, 1);
    io.emit('qaReactionUpdate', { threadId, reactions: thread.reactions });
  });

  socket.on('qaReplyReact', ({ threadId, replyId, emoji, user }) => {
    const allowed = ['🎓', '💡', '🤝', '⭐', '📜', '🧠'];
    if (!allowed.includes(emoji)) return;
    const thread = qaHistory.find(t => t.id === threadId);
    if (!thread || !thread.replies) return;
    const reply = thread.replies.find(r => r.id === replyId);
    if (!reply) return;
    if (!reply.reactions) reply.reactions = emptyReactions();
    if (!reply.reactions[emoji]) reply.reactions[emoji] = [];
    const list = reply.reactions[emoji];
    const idx = list.indexOf(user);
    if (idx === -1) list.push(user); else list.splice(idx, 1);
    io.emit('qaReplyReactionUpdate', { threadId, replyId, reactions: reply.reactions });
  });

  socket.on('qaReplyFlag', ({ threadId, replyId, user }) => {
    const thread = qaHistory.find(t => t.id === threadId);
    if (!thread || !thread.replies) return;
    const reply = thread.replies.find(r => r.id === replyId);
    if (!reply) return;

    if (!reply.flags) reply.flags = [];
    if (!reply.flags.includes(user)) reply.flags.push(user);

    const shouldDelete = reply.flags.length >= 3 || reply.user === user;
    if (shouldDelete) {
      thread.replies = thread.replies.filter(r => r.id !== replyId);
      io.emit('qaReplyDeleted', { threadId, replyId });
    } else {
      io.emit('qaReplyFlagUpdate', { threadId, replyId, flags: reply.flags });
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
