const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Server } = require('socket.io');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Import database and game engine
const Database = require('./database.js');
const GameEngine = require('./gameEngine.js');

const app = express();

// Trust proxy - important for rate limiting behind Railway
app.set('trust proxy', 1);

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// Fix for double slashes in URLs
app.use((req, res, next) => {
  // Replace double slashes with single slash (except for protocol)
  if (req.url.includes('//')) {
    const originalUrl = req.url;
    req.url = req.url.replace(/\/+/g, '/');
    console.log(`🔧 Fixed URL: ${originalUrl} -> ${req.url}`);
  }
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting - updated for proxy support
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  keyGenerator: (req) => {
    // Use X-Forwarded-For header if behind proxy, otherwise use IP
    return req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
  }
});
app.use('/api/', limiter);

// Clean WEBAPP_URL - remove any trailing slashes
const rawWebAppUrl = process.env.WEBAPP_URL || 'https://your-app.railway.app';
const WEBAPP_URL = rawWebAppUrl.replace(/\/+$/, ''); // Remove trailing slashes

console.log(`🌐 WebApp URL configured as: ${WEBAPP_URL}`);

// ============================================
// STATIC FILE SERVING - SIMPLIFIED VERSION
// ============================================

// Try multiple possible paths for frontend files
let staticPath = null;
const possiblePaths = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, 'frontend'),
  path.join(process.cwd(), 'frontend'),
  path.join(process.cwd(), '..', 'frontend'),
  '/app/frontend',
  '/app/backend/../frontend'
];

console.log('🔍 Searching for frontend directory...');
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    staticPath = p;
    console.log(`✅ Found frontend at: ${p}`);
    break;
  }
}

// If no frontend found, create a basic one
if (!staticPath) {
  console.error('❌ Could not find frontend directory in any location!');
  // Create a basic frontend directory as fallback
  staticPath = path.join(process.cwd(), 'frontend');
  fs.mkdirSync(staticPath, { recursive: true });
  
  // Create basic HTML files
  const basicHtml = `<!DOCTYPE html>
<html>
<head>
    <title>Bingo Game</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #4a90e2; }
        .links { margin-top: 30px; }
        a { display: inline-block; margin: 10px; padding: 10px 20px; background: #4a90e2; color: white; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>🎯 BIG GTO BINGO</h1>
    <p>Server is running! Frontend files are being served.</p>
    <div class="links">
        <a href="/game.html">Play Game</a>
        <a href="/select-card.html">Buy Cards</a>
        <a href="/admin.html">Admin</a>
    </div>
</body>
</html>`;

  const gameHtml = `<!DOCTYPE html>
<html>
<head>
    <title>Bingo Game</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
        h1 { color: #4a90e2; }
        .numbers { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 20px 0; }
        .number { width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; background: #4a90e2; color: white; border-radius: 50%; font-size: 18px; }
    </style>
</head>
<body>
    <h1>🎮 BINGO GAME</h1>
    <div class="numbers">
        <span class="number">1</span>
        <span class="number">2</span>
        <span class="number">3</span>
        <span class="number">4</span>
        <span class="number">5</span>
    </div>
    <p>Game is loading... (Debug Mode)</p>
    <a href="/">Back to Home</a>
</body>
</html>`;

  fs.writeFileSync(path.join(staticPath, 'index.html'), basicHtml);
  fs.writeFileSync(path.join(staticPath, 'game.html'), gameHtml);
  fs.writeFileSync(path.join(staticPath, 'select-card.html'), gameHtml);
  fs.writeFileSync(path.join(staticPath, 'admin.html'), gameHtml);
  
  console.log('📄 Created fallback HTML files in:', staticPath);
}

// List all files in the static directory
console.log('📄 Files in static directory:');
try {
  const files = fs.readdirSync(staticPath);
  files.forEach(file => {
    const filePath = path.join(staticPath, file);
    const stats = fs.statSync(filePath);
    console.log(`   - ${file} (${stats.size} bytes)`);
  });
} catch (err) {
  console.error('❌ Error reading directory:', err.message);
}

// Serve static files with explicit MIME types
app.use(express.static(staticPath, {
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html');
    }
    console.log(`📤 Serving: ${path.basename(filepath)}`);
  }
}));

// Explicit routes for HTML files
app.get(['/index.html', '/game.html', '/select-card.html', '/admin.html'], (req, res) => {
  const fileName = req.path.substring(1); // Remove leading slash
  const filePath = path.join(staticPath, fileName);
  
  if (fs.existsSync(filePath)) {
    console.log(`✅ Serving ${fileName} from: ${filePath}`);
    res.sendFile(filePath);
  } else {
    console.error(`❌ File not found: ${filePath}`);
    res.status(404).send(`File ${fileName} not found. Please check your deployment.`);
  }
});

// Redirect root to index.html
app.get('/', (req, res) => {
  const indexPath = path.join(staticPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>🎯 BIG GTO BINGO</h1>
          <p>Server is running! Frontend files not found, but API is working.</p>
          <p><a href="/test">Test Page</a> | <a href="/debug-files">Debug Files</a></p>
        </body>
      </html>
    `);
  }
});

// Test page to verify server is working
app.get('/test', (req, res) => {
  res.send(`
    <html>
      <head><title>Server Test</title></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1>✅ Server is Working!</h1>
        <p>Current time: ${new Date().toISOString()}</p>
        <p>Static path: ${staticPath}</p>
        <p>WebApp URL: ${WEBAPP_URL}</p>
        <h2>Navigation:</h2>
        <p><a href="/debug-files">Check Files</a></p>
        <p><a href="/index.html">Index.html</a></p>
        <p><a href="/game.html">Game.html</a></p>
        <p><a href="/select-card.html">Select Card</a></p>
        <p><a href="/admin.html">Admin</a></p>
        <p><a href="/health">Health Check</a></p>
      </body>
    </html>
  `);
});

// Debug endpoint to check file system
app.get('/debug-files', (req, res) => {
  const result = {
    cwd: process.cwd(),
    __dirname: __dirname,
    staticPath: staticPath,
    staticPathExists: fs.existsSync(staticPath),
    frontendFiles: [],
    allFiles: {},
    environment: {
      WEBAPP_URL: WEBAPP_URL,
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT
    }
  };
  
  // Get files in static path
  if (fs.existsSync(staticPath)) {
    try {
      result.frontendFiles = fs.readdirSync(staticPath);
      
      // Get details of each file
      result.frontendFiles.forEach(file => {
        const filePath = path.join(staticPath, file);
        const stats = fs.statSync(filePath);
        result.allFiles[file] = {
          size: stats.size,
          isFile: stats.isFile(),
          path: filePath
        };
      });
    } catch (e) {
      result.error = e.message;
    }
  }
  
  // Check other possible locations
  result.possiblePaths = {};
  possiblePaths.forEach(p => {
    result.possiblePaths[p] = fs.existsSync(p);
  });
  
  res.json(result);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    webappUrl: WEBAPP_URL,
    staticPath: staticPath,
    staticPathExists: fs.existsSync(staticPath)
  });
});

// ============================================
// TELEGRAM BOT SETUP
// ============================================

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set in environment variables');
  process.exit(1);
}

// Initialize bot with error handling
let bot;
try {
  bot = new TelegramBot(token, { 
    polling: false // Start with polling false
  });

  // Clear any existing webhooks
  bot.deleteWebHook()
    .then(() => {
      console.log('✅ Webhook cleared');
      // Start polling after webhook is cleared
      return bot.startPolling();
    })
    .then(() => {
      console.log('✅ Bot polling started successfully');
    })
    .catch((err) => {
      console.error('❌ Failed to start polling:', err.message);
      // Retry after 5 seconds
      setTimeout(() => {
        console.log('🔄 Retrying to start polling...');
        bot.startPolling().catch(e => console.error('Retry failed:', e.message));
      }, 5000);
    });

} catch (error) {
  console.error('❌ Failed to initialize bot:', error);
  process.exit(1);
}

// Initialize database and game engine
const db = new Database();
const gameEngine = new GameEngine(io, db);

// Make db and gameEngine available globally
global.db = db;
global.gameEngine = gameEngine;

// Error handler for bot
bot.on('polling_error', (error) => {
  console.error('❌ Telegram polling error:', error.message);
  if (error.message.includes('409')) {
    console.log('🔄 Conflict detected, restarting polling in 10 seconds...');
    setTimeout(() => {
      bot.stopPolling()
        .then(() => bot.startPolling())
        .catch(e => console.error('Restart failed:', e.message));
    }, 10000);
  }
});

bot.on('webhook_error', (error) => {
  console.error('❌ Telegram webhook error:', error);
});

// Telegram Bot Commands
const commands = [
  { command: '/start', description: '🎯 Start the bot' },
  { command: '/play', description: '🎮 Play Bingo' },
  { command: '/balance', description: '💰 Check balance' },
  { command: '/buy', description: '🃏 Buy bingo cards' },
  { command: '/active', description: '📊 Show active games' },
  { command: '/leaderboard', description: '🏆 View leaderboard' },
  { command: '/help', description: '❓ Help' }
];

bot.setMyCommands(commands).catch(err => {
  console.error('Failed to set commands:', err);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  try {
    await db.registerUser(user.id, user.first_name, user.username);
    const balance = await db.getBalance(user.id);
    
    // Ensure no double slashes in URLs
    const gameUrl = `${WEBAPP_URL}/game.html`;
    const selectCardUrl = `${WEBAPP_URL}/select-card.html`;
    
    console.log(`🔗 Game URL: ${gameUrl}`);
    console.log(`🔗 Select Card URL: ${selectCardUrl}`);
    
    await bot.sendMessage(chatId, 
      `🎯 *Welcome to BIG GTO Bingo, ${user.first_name}!*\n\n` +
      `💰 Your balance: *$${balance}*\n\n` +
      `🎮 Choose an option below:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎮 Play Bingo', web_app: { url: gameUrl } }],
            [{ text: '🃏 Buy Cards', web_app: { url: selectCardUrl } }],
            [{ text: '💰 Add Funds', callback_data: 'add_funds' }],
            [{ text: '🏆 Leaderboard', callback_data: 'leaderboard' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Error in /start:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
  }
});

bot.onText(/\/play/, async (msg) => {
  const chatId = msg.chat.id;
  const gameUrl = `${WEBAPP_URL}/game.html`;
  
  await bot.sendMessage(chatId, '🎮 *Launching Bingo Game...*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 Open Bingo Game', web_app: { url: gameUrl } }]
      ]
    }
  });
});

bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;
  const selectCardUrl = `${WEBAPP_URL}/select-card.html`;
  
  await bot.sendMessage(chatId, '🃏 *Buy Bingo Cards*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🃏 Select Cards', web_app: { url: selectCardUrl } }]
      ]
    }
  });
});

// ... (rest of your bot commands - keep all your existing bot command handlers)

// API Routes
app.get('/api/game-state', (req, res) => {
  try {
    const state = gameEngine.getGameState();
    res.json(state);
  } catch (error) {
    console.error('Error getting game state:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user-balance/:userId', async (req, res) => {
  try {
    const balance = await db.getBalance(req.params.userId);
    res.json({ balance });
  } catch (error) {
    console.error('Error getting balance:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/active-games', (req, res) => {
  try {
    const games = gameEngine.getActiveGames();
    res.json(games);
  } catch (error) {
    console.error('Error getting active games:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/join-game', async (req, res) => {
  try {
    const { userId, gameId, cardId } = req.body;
    
    if (!userId || !gameId || !cardId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const result = await gameEngine.joinGame(userId, gameId, cardId);
    res.json(result);
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user-cards/:userId', async (req, res) => {
  try {
    const cards = await db.getUserCards(req.params.userId, 20);
    res.json(cards);
  } catch (error) {
    console.error('Error getting user cards:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaders = await db.getLeaderboard(10);
    res.json(leaders);
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user-stats/:userId', async (req, res) => {
  try {
    const stats = await db.getUserStats(req.params.userId);
    res.json(stats || { gamesPlayed: 0, gamesWon: 0, totalWinnings: 0, balance: 0, cardsBought: 0 });
  } catch (error) {
    console.error('Error getting user stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const transactions = await db.getTransactionHistory(req.params.userId, 20);
    res.json(transactions);
  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin Routes (protected)
const adminAuth = (req, res, next) => {
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
  const userId = req.headers['x-user-id'];
  
  if (!adminIds.includes(userId)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
};

app.post('/api/admin/start-game', adminAuth, (req, res) => {
  try {
    const { gameId } = req.body;
    
    if (!gameId) {
      return res.status(400).json({ error: 'Game ID required' });
    }
    
    const result = gameEngine.startGame(gameId);
    res.json({ success: result, gameId });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/call-number', adminAuth, (req, res) => {
  try {
    const { gameId, number } = req.body;
    
    if (!gameId || !number) {
      return res.status(400).json({ error: 'Game ID and number required' });
    }
    
    const result = gameEngine.callNumber(gameId, number);
    res.json({ success: result, gameId, number });
  } catch (error) {
    console.error('Error calling number:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/auto-call', adminAuth, (req, res) => {
  try {
    const { gameId, interval } = req.body;
    
    if (!gameId) {
      return res.status(400).json({ error: 'Game ID required' });
    }
    
    const result = gameEngine.startAutoCall(gameId, interval || 5);
    res.json({ success: result, gameId, interval: interval || 5 });
  } catch (error) {
    console.error('Error starting auto-call:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/stop-auto-call', adminAuth, (req, res) => {
  try {
    const { gameId } = req.body;
    
    if (!gameId) {
      return res.status(400).json({ error: 'Game ID required' });
    }
    
    gameEngine.stopAutoCall(gameId);
    res.json({ success: true, gameId });
  } catch (error) {
    console.error('Error stopping auto-call:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/end-game', adminAuth, (req, res) => {
  try {
    const { gameId } = req.body;
    
    if (!gameId) {
      return res.status(400).json({ error: 'Game ID required' });
    }
    
    gameEngine.endGame(gameId);
    res.json({ success: true, gameId });
  } catch (error) {
    console.error('Error ending game:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/game-details/:gameId', adminAuth, (req, res) => {
  try {
    const gameId = req.params.gameId;
    const game = gameEngine.games.get(gameId);
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const players = Array.from(game.players.entries()).map(([id, player]) => ({
      userId: id,
      cardId: player.cardId,
      markedCount: player.markedNumbers.length,
      joinedAt: player.joinedAt
    }));
    
    res.json({
      id: game.id,
      name: game.name,
      type: game.type,
      status: game.status,
      players: players,
      playerCount: game.players.size,
      calledNumbers: game.calledNumbers,
      prizePool: game.prizePool,
      startTime: game.startTime,
      lastNumber: game.lastNumber
    });
  } catch (error) {
    console.error('Error getting game details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Player connected:', socket.id);
  
  socket.on('join_game', (gameId) => {
    socket.join(`game_${gameId}`);
    socket.emit('game_joined', { gameId, success: true });
    console.log(`👤 Socket ${socket.id} joined game ${gameId}`);
  });
  
  socket.on('leave_game', (gameId) => {
    socket.leave(`game_${gameId}`);
    console.log(`👤 Socket ${socket.id} left game ${gameId}`);
  });
  
  socket.on('mark_number', (data) => {
    gameEngine.markNumber(socket.id, data);
    socket.to(`game_${data.gameId}`).emit('number_marked', data);
  });
  
  socket.on('get_game_state', (gameId) => {
    const game = gameEngine.games.get(gameId);
    if (game) {
      socket.emit('game_state_update', {
        gameId,
        calledNumbers: game.calledNumbers,
        playerCount: game.players.size,
        prizePool: game.prizePool,
        status: game.status
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Player disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err.stack);
  res.status(500).json({ error: 'Something broke! Please try again later.' });
});

// 404 handler - log and return JSON
app.use((req, res) => {
  console.log(`❓ 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: 'Endpoint not found', 
    path: req.url, 
    method: req.method,
    note: 'If you were trying to access an HTML page, check /debug-files to see what files are available.'
  });
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ WebApp URL: ${WEBAPP_URL}`);
  console.log(`✅ Static path: ${staticPath}`);
  console.log(`✅ Bot initializing...`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
  
  console.log('\n📌 Available endpoints:');
  console.log(`   - /test - Test page`);
  console.log(`   - /debug-files - Debug file system`);
  console.log(`   - /health - Health check`);
  console.log(`   - /index.html - Home page`);
  console.log(`   - /game.html - Game page`);
  console.log(`   - /select-card.html - Buy cards page`);
  console.log(`   - /admin.html - Admin page`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully');
  
  // Stop bot polling
  if (bot) {
    bot.stopPolling()
      .then(() => console.log('✅ Bot polling stopped'))
      .catch(err => console.error('Error stopping bot:', err));
  }
  
  // Stop all auto-call intervals
  gameEngine.cleanupOldGames();
  
  // Close server
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully');
  
  // Stop bot polling
  if (bot) {
    bot.stopPolling()
      .then(() => console.log('✅ Bot polling stopped'))
      .catch(err => console.error('Error stopping bot:', err));
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Don't exit, just log
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, just log
});

module.exports = app;