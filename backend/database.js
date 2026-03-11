import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

class Database {
  constructor() {
    this.init();
  }
  
  async init() {
    this.db = await open({
      filename: './bingo.db',
      driver: sqlite3.Database
    });
    
    await this.createTables();
  }
  
  async createTables() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        username TEXT,
        firstName TEXT,
        balance INTEGER DEFAULT 1000,
        gamesPlayed INTEGER DEFAULT 0,
        gamesWon INTEGER DEFAULT 0,
        totalWinnings INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        gameId TEXT,
        cardNumber INTEGER,
        cardType TEXT,
        cardData TEXT,
        price INTEGER,
        purchasedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(userId)
      );
      
      CREATE TABLE IF NOT EXISTS called_numbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT,
        number INTEGER,
        calledAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS games (
        gameId TEXT PRIMARY KEY,
        status TEXT,
        startedAt DATETIME,
        endedAt DATETIME,
        prizePool INTEGER,
        winnerId TEXT,
        winningAmount INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        type TEXT,
        amount INTEGER,
        balance INTEGER,
        description TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(userId)
      );
    `);
  }
  
  async registerUser(userId, firstName, username) {
    const existing = await this.db.get('SELECT userId FROM users WHERE userId = ?', userId);
    
    if (!existing) {
      await this.db.run(
        'INSERT INTO users (userId, firstName, username, balance) VALUES (?, ?, ?, ?)',
        [userId, firstName, username || '', 1000]
      );
      
      await this.addTransaction(userId, 'welcome', 1000, 1000, 'Welcome bonus');
    }
  }
  
  async getBalance(userId) {
    const result = await this.db.get('SELECT balance FROM users WHERE userId = ?', userId);
    return result ? result.balance : 0;
  }
  
  async updateBalance(userId, amount) {
    const current = await this.getBalance(userId);
    const newBalance = current + amount;
    
    await this.db.run(
      'UPDATE users SET balance = ? WHERE userId = ?',
      [newBalance, userId]
    );
    
    await this.addTransaction(
      userId, 
      amount > 0 ? 'credit' : 'debit', 
      Math.abs(amount), 
      newBalance,
      amount > 0 ? 'Funds added' : 'Card purchase'
    );
    
    return newBalance;
  }
  
  async saveCard(userId, gameId, cardNumber, cardData) {
    const result = await this.db.run(
      `INSERT INTO cards (userId, gameId, cardNumber, cardType, cardData, price) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, gameId, cardNumber, cardData.type, JSON.stringify(cardData), cardData.price || 50]
    );
    
    return result.lastID;
  }
  
  async getCard(cardId) {
    return await this.db.get('SELECT * FROM cards WHERE id = ?', cardId);
  }
  
  async getUserCards(userId) {
    return await this.db.all(
      'SELECT * FROM cards WHERE userId = ? ORDER BY purchasedAt DESC LIMIT 10',
      userId
    );
  }
  
  async addTransaction(userId, type, amount, balance, description) {
    await this.db.run(
      `INSERT INTO transactions (userId, type, amount, balance, description) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, type, amount, balance, description]
    );
  }
  
  async getTransactionHistory(userId, limit = 20) {
    return await this.db.all(
      'SELECT * FROM transactions WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
      [userId, limit]
    );
  }
  
  async saveGameResult(gameId, winnerId, prize) {
    await this.db.run(
      `UPDATE games SET status = ?, endedAt = ?, winnerId = ?, winningAmount = ? 
       WHERE gameId = ?`,
      ['ended', new Date().toISOString(), winnerId, prize, gameId]
    );
    
    await this.db.run(
      'UPDATE users SET gamesWon = gamesWon + 1, totalWinnings = totalWinnings + ? WHERE userId = ?',
      [prize, winnerId]
    );
  }
  
  async getLeaderboard(limit = 10) {
    return await this.db.all(
      `SELECT userId, firstName, username, gamesWon, totalWinnings 
       FROM users 
       WHERE totalWinnings > 0 
       ORDER BY totalWinnings DESC 
       LIMIT ?`,
      limit
    );
  }
}

export default Database;