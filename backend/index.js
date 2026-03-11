import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
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

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../frontend')));

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.railway.app';

// Initialize database and game engine
const db = new Database();
const gameEngine = new GameEngine(io, db);

// Telegram Bot Commands
bot.setMyCommands([
  { command: '/start', description: 'Start the bot' },
  { command: '/play', description: 'Play Bingo' },
  { command: '/balance', description: 'Check balance' },
  { command: '/buy', description: 'Buy bingo cards' },
  { command: '/active', description: 'Show active games' }
]);

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  // Register user in database
  await db.registerUser(user.id, user.first_name, user.username);
  
  const balance = await db.getBalance(user.id);
  
  bot.sendMessage(chatId, `🎯 Welcome to BIG GTO Bingo, ${user.first_name}!\n\n💰 Your balance: $${balance}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 Play Bingo', web_app: { url: `${WEBAPP_URL}/game.html` } }],
        [{ text: '🃏 Buy Cards', web_app: { url: `${WEBAPP_URL}/select-card.html` } }],
        [{ text: '💰 Add Funds', callback_data: 'add_funds' }]
      ]
    }
  });
});

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const balance = await db.getBalance(msg.from.id);
  bot.sendMessage(chatId, `💰 Your current balance: $${balance}`);
});

bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  
  if (action === 'add_funds') {
    bot.sendMessage(chatId, '💰 Add funds via Telegram Stars or crypto', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⭐ Add $10', callback_data: 'add_10' }],
          [{ text: '⭐ Add $25', callback_data: 'add_25' }],
          [{ text: '⭐ Add $50', callback_data: 'add_50' }]
        ]
      }
    });
  } else if (action.startsWith('add_')) {
    const amount = parseInt(action.split('_')[1]);
    await db.updateBalance(userId, amount);
    bot.sendMessage(chatId, `✅ Added $${amount} to your balance!`);
  }
});

// Web App Data Handler
bot.on('web_app_data', async (msg) => {
  const data = JSON.parse(msg.web_app_data.data);
  const userId = msg.from.id;
  
  switch(data.type) {
    case 'BUY_CARD':
      const balance = await db.getBalance(userId);
      if (balance >= data.price) {
        await db.updateBalance(userId, -data.price);
        const cardId = await db.saveCard(userId, data.gameId, data.cardNumber, data.cardData);
        bot.sendMessage(msg.chat.id, `✅ Card #${data.cardNumber} purchased! Card ID: ${cardId}`);
      } else {
        bot.sendMessage(msg.chat.id, `❌ Insufficient balance! Need $${data.price}, you have $${balance}`);
      }
      break;
      
    case 'BINGO':
      const isValid = await gameEngine.validateBingo(userId, data.cardId, data.markedNumbers);
      if (isValid) {
        const prize = await gameEngine.processWin(userId, data.gameId);
        bot.sendMessage(msg.chat.id, `🎉 BINGO! You won $${prize}!`);
        io.emit('bingo_winner', { userId: msg.from.id, gameId: data.gameId });
      } else {
        bot.sendMessage(msg.chat.id, '❌ Invalid Bingo claim!');
      }
      break;
  }
});

// API Routes
app.get('/api/game-state', (req, res) => {
  res.json(gameEngine.getGameState());
});

app.get('/api/user-balance/:userId', async (req, res) => {
  const balance = await db.getBalance(req.params.userId);
  res.json({ balance });
});

app.get('/api/active-games', (req, res) => {
  res.json(gameEngine.getActiveGames());
});

app.post('/api/join-game', async (req, res) => {
  const { userId, gameId, cardId } = req.body;
  const result = await gameEngine.joinGame(userId, gameId, cardId);
  res.json(result);
});

// Admin Routes
app.post('/api/admin/start-game', (req, res) => {
  const { gameId } = req.body;
  gameEngine.startGame(gameId);
  res.json({ success: true });
});

app.post('/api/admin/call-number', (req, res) => {
  const { gameId, number } = req.body;
  gameEngine.callNumber(gameId, number);
  res.json({ success: true });
});

app.post('/api/admin/auto-call', (req, res) => {
  const { gameId, interval } = req.body;
  gameEngine.startAutoCall(gameId, interval);
  res.json({ success: true });
});

app.post('/api/admin/end-game', (req, res) => {
  const { gameId } = req.body;
  gameEngine.endGame(gameId);
  res.json({ success: true });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('join_game', (gameId) => {
    socket.join(`game_${gameId}`);
    socket.emit('game_joined', gameId);
  });
  
  socket.on('mark_number', (data) => {
    gameEngine.markNumber(socket.id, data);
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebApp URL: ${WEBAPP_URL}`);
});
