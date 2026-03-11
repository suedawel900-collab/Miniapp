import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from './database.js';
import GameEngine from './gameEngine.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// Static files
app.use(express.static(join(__dirname, '../frontend')));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.railway.app';

// Initialize database and game engine
const db = new Database();
const gameEngine = new GameEngine(io, db);

// Make db and gameEngine available globally
global.db = db;
global.gameEngine = gameEngine;

// Telegram Bot Commands
bot.setMyCommands([
  { command: '/start', description: '🎯 Start the bot' },
  { command: '/play', description: '🎮 Play Bingo' },
  { command: '/balance', description: '💰 Check balance' },
  { command: '/buy', description: '🃏 Buy bingo cards' },
  { command: '/active', description: '📊 Show active games' },
  { command: '/leaderboard', description: '🏆 View leaderboard' },
  { command: '/help', description: '❓ Help' }
]);

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  try {
    await db.registerUser(user.id, user.first_name, user.username);
    const balance = await db.getBalance(user.id);
    
    await bot.sendMessage(chatId, 
      `🎯 *Welcome to BIG GTO Bingo, ${user.first_name}!*\n\n` +
      `💰 Your balance: *$${balance}*\n\n` +
      `🎮 Choose an option below:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎮 Play Bingo', web_app: { url: `${WEBAPP_URL}/game.html` } }],
            [{ text: '🃏 Buy Cards', web_app: { url: `${WEBAPP_URL}/select-card.html` } }],
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
  await bot.sendMessage(chatId, '🎮 *Launching Bingo Game...*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 Open Bingo Game', web_app: { url: `${WEBAPP_URL}/game.html` } }]
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
          [{ text: '➕ Add Funds', callback_data: 'add_funds' }]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching balance');
  }
});

bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const leaders = await db.getLeaderboard(10);
    let message = '🏆 *Leaderboard*\n\n';
    leaders.forEach((user, index) => {
      message += `${index + 1}. ${user.firstName} - $${user.totalWinnings} (${user.gamesWon} wins)\n`;
    });
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching leaderboard');
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  
  try {
    if (action === 'add_funds') {
      await bot.sendMessage(chatId, '💰 *Add Funds*\n\nSelect amount:', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⭐ $10', callback_data: 'add_10' }],
            [{ text: '⭐ $25', callback_data: 'add_25' }],
            [{ text: '⭐ $50', callback_data: 'add_50' }],
            [{ text: '⭐ $100', callback_data: 'add_100' }]
          ]
        }
      });
    } else if (action === 'leaderboard') {
      const leaders = await db.getLeaderboard(10);
      let message = '🏆 *Leaderboard*\n\n';
      leaders.forEach((user, index) => {
        message += `${index + 1}. ${user.firstName} - $${user.totalWinnings} (${user.gamesWon} wins)\n`;
      });
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } else if (action.startsWith('add_')) {
      const amount = parseInt(action.split('_')[1]);
      await db.updateBalance(userId, amount);
      const newBalance = await db.getBalance(userId);
      await bot.sendMessage(chatId, 
        `✅ *Added $${amount} to your balance!*\n\n💰 New balance: $${newBalance}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Callback error:', error);
    bot.sendMessage(chatId, '❌ An error occurred');
  }
  
  await bot.answerCallbackQuery(callbackQuery.id);
});

// Web App Data Handler
bot.on('web_app_data', async (msg) => {
  try {
    const data = JSON.parse(msg.web_app_data.data);
    const userId = msg.from.id;
    
    console.log('WebApp data received:', data);
    
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
            `💳 Card ID: ${cardId}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await bot.sendMessage(msg.chat.id, 
            `❌ *Insufficient Balance!*\n\n` +
            `Need: $${data.price}\n` +
            `You have: $${balance}`,
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
            `💰 Prize: $${prize}`,
            { parse_mode: 'Markdown' }
          );
          io.emit('bingo_winner', { 
            userId: msg.from.id, 
            gameId: data.gameId,
            prize: prize 
          });
        } else {
          await bot.sendMessage(msg.chat.id, 
            '❌ *Invalid Bingo Claim!*\n\nPlease check your numbers and try again.',
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
            `💰 Prize Pool: $${result.game.prizePool}`,
            { parse_mode: 'Markdown' }
          );
        }
        break;
    }
  } catch (error) {
    console.error('WebApp data error:', error);
    bot.sendMessage(msg.chat.id, '❌ Error processing request');
  }
});

// API Routes
app.get('/api/game-state', (req, res) => {
  try {
    const state = gameEngine.getGameState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user-balance/:userId', async (req, res) => {
  try {
    const balance = await db.getBalance(req.params.userId);
    res.json({ balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/active-games', (req, res) => {
  try {
    const games = gameEngine.getActiveGames();
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/join-game', async (req, res) => {
  try {
    const { userId, gameId, cardId } = req.body;
    const result = await gameEngine.joinGame(userId, gameId, cardId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user-cards/:userId', async (req, res) => {
  try {
    const cards = await db.getUserCards(req.params.userId);
    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaders = await db.getLeaderboard(10);
    res.json(leaders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin Routes
app.post('/api/admin/start-game', (req, res) => {
  try {
    const { gameId } = req.body;
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
    
    // Check admin authorization
    const userId = req.headers['x-user-id'];
    if (!adminIds.includes(userId)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const result = gameEngine.startGame(gameId);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/call-number', (req, res) => {
  try {
    const { gameId, number } = req.body;
    const result = gameEngine.callNumber(gameId, number);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/auto-call', (req, res) => {
  try {
    const { gameId, interval } = req.body;
    const result = gameEngine.startAutoCall(gameId, interval || 5);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/end-game', (req, res) => {
  try {
    const { gameId } = req.body;
    gameEngine.endGame(gameId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('join_game', (gameId) => {
    socket.join(`game_${gameId}`);
    socket.emit('game_joined', { gameId, success: true });
  });
  
  socket.on('leave_game', (gameId) => {
    socket.leave(`game_${gameId}`);
  });
  
  socket.on('mark_number', (data) => {
    gameEngine.markNumber(socket.id, data);
    socket.to(`game_${data.gameId}`).emit('number_marked', data);
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ WebApp URL: ${WEBAPP_URL}`);
  console.log(`✅ Bot is running`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});