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

// Static files - serve HTML files directly
app.use(express.static(path.join(__dirname, '../frontend')));

// Handle HTML files without extensions
app.use((req, res, next) => {
  // If the request is for a path without extension and doesn't start with /api
  if (!req.path.startsWith('/api') && !req.path.includes('.')) {
    const possiblePath = path.join(__dirname, '../frontend', req.path + '.html');
    // Check if the HTML file exists
    if (require('fs').existsSync(possiblePath)) {
      return res.sendFile(possiblePath);
    }
  }
  next();
});

// Clean WEBAPP_URL - remove any trailing slashes
const rawWebAppUrl = process.env.WEBAPP_URL || 'https://your-app.railway.app';
const WEBAPP_URL = rawWebAppUrl.replace(/\/+$/, ''); // Remove trailing slashes

console.log(`🌐 WebApp URL configured as: ${WEBAPP_URL}`);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    webappUrl: WEBAPP_URL
  });
});

// Root endpoint - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

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

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const balance = await db.getBalance(msg.from.id);
    await bot.sendMessage(chatId, `💰 *Your Balance:* $${balance}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add Funds', callback_data: 'add_funds' }],
          [{ text: '📊 Transaction History', callback_data: 'history' }]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching balance');
  }
});

bot.onText(/\/active/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const games = gameEngine.getActiveGames();
    let message = '📊 *Active Games*\n\n';
    
    if (games.length === 0) {
      message += 'No active games at the moment.';
    } else {
      games.forEach(game => {
        message += `🎮 Game #${game.id} - ${game.name}\n`;
        message += `   👥 Players: ${game.players}\n`;
        message += `   💰 Prize Pool: $${game.prizePool}\n`;
        message += `   Status: ${game.status}\n\n`;
      });
    }
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching active games');
  }
});

bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const leaders = await db.getLeaderboard(10);
    let message = '🏆 *Leaderboard*\n\n';
    
    if (leaders.length === 0) {
      message += 'No winners yet. Be the first!';
    } else {
      leaders.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📌';
        message += `${medal} ${index + 1}. ${user.firstName || 'Player'} - $${user.totalWinnings} (${user.gamesWon} wins)\n`;
      });
    }
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching leaderboard');
  }
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = 
    `❓ *BIG GTO Bingo Help*\n\n` +
    `*Commands:*\n` +
    `/start - Start the bot\n` +
    `/play - Open bingo game\n` +
    `/balance - Check your balance\n` +
    `/buy - Buy bingo cards\n` +
    `/active - Show active games\n` +
    `/leaderboard - View top winners\n` +
    `/help - Show this help\n\n` +
    `*How to Play:*\n` +
    `1. Buy a card from the shop\n` +
    `2. Join an active game\n` +
    `3. Mark numbers as they're called\n` +
    `4. Call BINGO when you win!\n\n` +
    `Good luck! 🎯`;
  
  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const messageId = callbackQuery.message.message_id;
  
  try {
    if (action === 'add_funds') {
      await bot.editMessageText('💰 *Add Funds*\n\nSelect amount:', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⭐ $10', callback_data: 'add_10' }],
            [{ text: '⭐ $25', callback_data: 'add_25' }],
            [{ text: '⭐ $50', callback_data: 'add_50' }],
            [{ text: '⭐ $100', callback_data: 'add_100' }],
            [{ text: '« Back', callback_data: 'back_to_main' }]
          ]
        }
      });
    } else if (action === 'leaderboard') {
      const leaders = await db.getLeaderboard(10);
      let message = '🏆 *Leaderboard*\n\n';
      
      if (leaders.length === 0) {
        message += 'No winners yet. Be the first!';
      } else {
        leaders.forEach((user, index) => {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📌';
          message += `${medal} ${index + 1}. ${user.firstName || 'Player'} - $${user.totalWinnings} (${user.gamesWon} wins)\n`;
        });
      }
      
      await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back', callback_data: 'back_to_main' }]
          ]
        }
      });
    } else if (action === 'history') {
      const transactions = await db.getTransactionHistory(userId, 5);
      let message = '📊 *Recent Transactions*\n\n';
      
      if (transactions.length === 0) {
        message += 'No transactions yet.';
      } else {
        transactions.forEach(t => {
          const sign = t.type === 'credit' ? '+' : '-';
          message += `${t.description}: ${sign}$${t.amount} ($${t.balance})\n`;
          message += `📅 ${new Date(t.createdAt).toLocaleDateString()}\n\n`;
        });
      }
      
      await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Back', callback_data: 'back_to_main' }]
          ]
        }
      });
    } else if (action === 'back_to_main') {
      const balance = await db.getBalance(userId);
      const gameUrl = `${WEBAPP_URL}/game.html`;
      const selectCardUrl = `${WEBAPP_URL}/select-card.html`;
      
      await bot.editMessageText(
        `🎯 *Welcome back!*\n\n` +
        `💰 Your balance: *$${balance}*\n\n` +
        `🎮 Choose an option below:`,
        {
          chat_id: chatId,
          message_id: messageId,
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
    } else if (action.startsWith('add_')) {
      const amount = parseInt(action.split('_')[1]);
      await db.updateBalance(userId, amount);
      const newBalance = await db.getBalance(userId);
      
      await bot.editMessageText(
        `✅ *Added $${amount} to your balance!*\n\n💰 New balance: $${newBalance}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '« Back', callback_data: 'back_to_main' }]
            ]
          }
        }
      );
    }
  } catch (error) {
    console.error('Callback error:', error);
    await bot.sendMessage(chatId, '❌ An error occurred');
  }
  
  await bot.answerCallbackQuery(callbackQuery.id);
});

// Web App Data Handler
bot.on('web_app_data', async (msg) => {
  try {
    const data = JSON.parse(msg.web_app_data.data);
    const userId = msg.from.id;
    
    console.log('📱 WebApp data received:', data);
    
    switch(data.type) {
      case 'BUY_CARD':
        const balance = await db.getBalance(userId);
        if (balance >= data.price) {
          await db.updateBalance(userId, -data.price);
          const cardId = await db.saveCard(
            userId, 
            data.gameId, 
            data.cardNumber, 
            data.cardData,
            data.price
          );
          
          await bot.sendMessage(msg.chat.id, 
            `✅ *Card Purchased!*\n\n` +
            `🎫 Card #${data.cardNumber}\n` +
            `🎮 Game #${data.gameId}\n` +
            `💰 Price: $${data.price}\n` +
            `💳 Card ID: ${cardId}\n\n` +
            `Join Game #${data.gameId} to start playing!`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await bot.sendMessage(msg.chat.id, 
            `❌ *Insufficient Balance!*\n\n` +
            `Need: $${data.price}\n` +
            `You have: $${balance}\n\n` +
            `Add funds to purchase this card.`,
            { parse_mode: 'Markdown' }
          );
        }
        break;
        
      case 'BINGO':
        const isValid = await gameEngine.validateBingo(
          userId, 
          data.cardId, 
          data.markedNumbers || []
        );
        
        if (isValid) {
          const prize = await gameEngine.processWin(userId, data.gameId);
          await bot.sendMessage(msg.chat.id, 
            `🎉 *BINGO! You Won!*\n\n` +
            `💰 Prize: $${prize}\n\n` +
            `Congratulations! 🎊`,
            { parse_mode: 'Markdown' }
          );
          io.emit('bingo_winner', { 
            userId: msg.from.id, 
            gameId: data.gameId,
            prize: prize 
          });
        } else {
          await bot.sendMessage(msg.chat.id, 
            '❌ *Invalid Bingo Claim!*\n\n' +
            'Please check your numbers and try again.\n' +
            'Make sure you have a complete line (horizontal, vertical, or diagonal).',
            { parse_mode: 'Markdown' }
          );
        }
        break;
        
      case 'JOIN_GAME':
        const result = await gameEngine.joinGame(userId, data.gameId, data.cardId);
        if (result.success) {
          await bot.sendMessage(msg.chat.id, 
            `✅ *Joined Game #${data.gameId}!*\n\n` +
            `👥 Players: ${result.game.playerCount}\n` +
            `💰 Prize Pool: $${result.game.prizePool}\n\n` +
            `Good luck! 🍀`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await bot.sendMessage(msg.chat.id, 
            `❌ *Failed to join game:* ${result.error}`,
            { parse_mode: 'Markdown' }
          );
        }
        break;
        
      default:
        console.log('Unknown webapp data type:', data.type);
    }
  } catch (error) {
    console.error('WebApp data error:', error);
    await bot.sendMessage(msg.chat.id, '❌ Error processing request');
  }
});

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

// Debug route to list all registered endpoints
app.get('/api/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((r) => {
    if (r.route && r.route.path) {
      routes.push({
        path: r.route.path,
        methods: Object.keys(r.route.methods)
      });
    }
  });
  res.json(routes);
});

// Debug route to check configuration
app.get('/api/debug/config', (req, res) => {
  res.json({
    webappUrl: WEBAPP_URL,
    rawWebappUrl: process.env.WEBAPP_URL,
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    hasTrailingSlash: WEBAPP_URL.endsWith('/')
  });
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
    note: 'If you were trying to access an HTML page, make sure the URL is correct and the file exists in the frontend folder.'
  });
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ WebApp URL: ${WEBAPP_URL}`);
  console.log(`✅ Bot initializing...`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Log all registered routes
  console.log('📋 Registered API Routes:');
  app._router.stack.forEach((r) => {
    if (r.route && r.route.path) {
      console.log(`   ${Object.keys(r.route.methods).join(', ').toUpperCase()} ${r.route.path}`);
    }
  });
  
  // Check frontend files
  const fs = require('fs');
  const frontendPath = path.join(__dirname, '../frontend');
  console.log(`📁 Frontend directory: ${frontendPath}`);
  
  if (fs.existsSync(frontendPath)) {
    const files = fs.readdirSync(frontendPath);
    console.log('📄 Frontend files:');
    files.forEach(file => {
      if (file.endsWith('.html')) {
        console.log(`   - ${file} -> ${WEBAPP_URL}/${file}`);
      }
    });
  } else {
    console.error('❌ Frontend directory not found!');
  }
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