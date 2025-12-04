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
const MAX_HISTORY = 60; // Increased slightly
const chatHistory = []; 
const qaHistory = [];   // Now stores reactions too!

// --- SECURITY & SPAM SHIELD ---
const lastMsgTime = {};
const spamCount = {};
const RATE_LIMIT_MS = 800; // Slower, more thoughtful pace
const MAX_MSG_LENGTH = 500; // Prevent massive text bombs

// --- AI FACILITATOR AGENT ---
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

// Start the AI Loop (Posts every 3 minutes)
setInterval(() => {
  if (K) return; // Don't speak if stream is killed
  
  const qText = AI_QUESTIONS[aiIndex];
  aiIndex = (aiIndex + 1) % AI_QUESTIONS.length;
  
  const threadData = {
    id: Date.now(),
    user: AI_NAME,
    text: qText,
    country: 'System',
    isAi: true,
    replies: [],
    reactions: { '🎓':0, '💡':0, '🤝':0, '⭐':0, '📜':0 }
  };
  
  qaHistory.push(threadData);
  io.emit('qaIncoming', threadData);
}, 180000); // 180,000ms = 3 minutes


// --- SECURITY HELPER ---
function escapeHtml(text) {
  if (!text) return "";
  // Basic sanitization against XSS
  return text.replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "'");
}

io.on('connection', (socket) => {
  T++;
  userLiveStates[socket.id] = false; 
  
  // Send Initial State
  socket.emit('initialLoad', { 
    chat: chatHistory, 
    qa: qaHistory,
    state: { isLive: userLiveStates[socket.id], isKilled: K }
  });
  
  io.emit('t', T);
  io.emit('r', R);

  // Timezone
  socket.on('r', (tz) => {
    A[socket.id] = tz;
    if (!R[tz]) R[tz] = 0;
    R[tz]++;
    io.emit('r', R);
  });

  // Toggle Live
  socket.on('x', () => {
    userLiveStates[socket.id] = !userLiveStates[socket.id];
    socket.emit('z', { isLive: userLiveStates[socket.id], isKilled: K });
  });

  // --- SECURE CHAT HANDLER ---
  socket.on('chatMsg', (payload) => {
    const now = Date.now();
    
    // 1. SPAM CHECK
    if (lastMsgTime[socket.id] && now - lastMsgTime[socket.id] < RATE_LIMIT_MS) {
      spamCount[socket.id] = (spamCount[socket.id] || 0) + 1;
      if (spamCount[socket.id] > 5) {
        socket.disconnect(); // Kick spammer
        return;
      }
      return; // Ignore fast message
    }
    lastMsgTime[socket.id] = now;
    spamCount[socket.id] = Math.max(0, (spamCount[socket.id] || 0) - 1); // Cool down

    // 2. LENGTH CHECK
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

  // --- Q&A HANDLER ---
  socket.on('qaAsk', (payload) => {
    if (payload.text.length > MAX_MSG_LENGTH) return;

    const threadData = {
      id: Date.now() + Math.random(),
      user: escapeHtml(payload.user),
      text: escapeHtml(payload.text),
      country: escapeHtml(payload.country),
      replies: [],
      reactions: { '🎓':0, '💡':0, '🤝':0, '⭐':0, '📜':0 } // Initialize Reactions
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

  // --- NEW: SCHOLARLY REACTION HANDLER ---
  socket.on('qaReact', (payload) => {
    const { threadId, emoji } = payload;
    const allowed = ['🎓', '💡', '🤝', '⭐', '📜'];
    if (!allowed.includes(emoji)) return;

    const thread = qaHistory.find(t => t.id == threadId);
    if (thread) {
      if (!thread.reactions) thread.reactions = { '🎓':0, '💡':0, '🤝':0, '⭐':0, '📜':0 };
      thread.reactions[emoji]++;
      
      // Broadcast update
      io.emit('qaReactionUpdate', { 
        threadId, 
        reactions: thread.reactions 
      });
    }
  });

  // Kill Switch
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
