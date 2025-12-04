const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- GLOBAL STATE ---
let K = false;
let T = 0;
let R = {};
let A = {};
let userLiveStates = {}; 

// --- HISTORY STORAGE ---
const MAX_HISTORY = 60;
const chatHistory = []; 
const qaHistory = [];

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

setInterval(() => {
  if (K) return;
  const qText = AI_QUESTIONS[aiIndex];
  aiIndex = (aiIndex + 1) % AI_QUESTIONS.length;
  
  const threadData = {
    id: Date.now(),
    user: AI_NAME,
    text: qText,
    country: 'System',
    isAi: true,
    replies: [],
    // Store Arrays of Names now, not just numbers!
    reactions: { '🎓':[], '💡':[], '🤝':[], '⭐':[], '📜':[] }
  };
  
  qaHistory.push(threadData);
  io.emit('qaIncoming', threadData);
}, 180000); 

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

  socket.on('chatMsg', (payload) => {
    const now = Date.now();
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) {
      spamCount[socket.id] = (spamCount[socket.id] || 0) + 1;
      if (spamCount[socket.id] > 5) { socket.disconnect(); return; }
      return;
    }
    lastMsgTime[socket.id] = now;
    spamCount[socket.id] = Math.max(0, (spamCount[socket.id] || 0) - 1);

    if (payload.text.length > MAX_MSG_LENGTH) return;

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

  socket.on('qaAsk', (payload) => {
    if (payload.text.length > MAX_MSG_LENGTH) return;
    const threadData = {
      id: Date.now() + Math.random(),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country),
      replies: [],
      reactions: { '🎓':[], '💡':[], '🤝':[], '⭐':[], '📜':[] }
    };
    qaHistory.push(threadData);
    io.emit('qaIncoming', threadData);
  });

  socket.on('qaReply', (payload) => {
    const replyData = { user: escapeHtml(payload.user), text: escapeHtml(payload.text) };
    const thread = qaHistory.find(t => t.id == payload.threadId);
    if (thread) thread.replies.push(replyData);
    io.emit('qaReplyIncoming', { threadId: payload.threadId, ...replyData });
  });

  // --- SMART REACTION HANDLER (TOGGLE/UNDO) ---
  socket.on('qaReact', (payload) => {
    const { threadId, emoji, user } = payload;
    const allowed = ['🎓', '💡', '🤝', '⭐', '📜'];
    if (!allowed.includes(emoji)) return;

    const thread = qaHistory.find(t => t.id == threadId);
    if (thread) {
      // Ensure structure exists
      if (!thread.reactions) thread.reactions = { '🎓':[], '💡':[], '🤝':[], '⭐':[], '📜':[] };
      if (!Array.isArray(thread.reactions[emoji])) thread.reactions[emoji] = [];

      const list = thread.reactions[emoji];
      const userIndex = list.indexOf(user);

      if (userIndex === -1) {
        // ADD Vote
        list.push(user);
      } else {
        // UNDO Vote (Remove user)
        list.splice(userIndex, 1);
      }
      
      // Broadcast updated lists so clients can highlight their own selection
      io.emit('qaReactionUpdate', { 
        threadId, 
        reactions: thread.reactions 
      });
    }
  });

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
    io.emit('t', T);
    io.emit('r', R);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚀 Secure Server running on port ${PORT}`); });
