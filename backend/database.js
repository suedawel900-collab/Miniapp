import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Database {
  constructor() {
    this.dbPath = join(__dirname, 'bingo.db');
    this.init();
  }
  
  async init() {
    try {
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });
      
      await this.createTables();
      console.log('✅ Database initialized');
    } catch (error) {
      console.error('❌ Database initialization error:', error);
    }
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
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        lastActive DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        gameId TEXT,
        cardNumber INTEGER,
        cardType TEXT,
        cardData TEXT,
        price INTEGER,
        isActive BOOLEAN DEFAULT 1,
        purchasedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(userId)
      );
      
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT,
        status TEXT,
        startedAt DATETIME,
        endedAt DATETIME,
        prizePool INTEGER,
        winnerId TEXT,
        winningAmount INTEGER,
        FOREIGN KEY (winnerId) REFERENCES users(userId)
      );
      
      CREATE TABLE IF NOT EXISTS called_numbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT,
        number INTEGER,
        calledAt DATETIME DEFAULT CURRENT_TIMESTAMP
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
      
      CREATE TABLE IF NOT EXISTS leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT UNIQUE,
        username TEXT,
        firstName TEXT,
        totalWins INTEGER DEFAULT 0,
        totalEarnings INTEGER DEFAULT 0,
        lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(userId)
      );
      
      CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(userId);
      CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(userId);
      CREATE INDEX IF NOT EXISTS idx_cards_active ON cards(isActive);
      CREATE INDEX IF NOT EXISTS idx_called_numbers_game ON called_numbers(gameId);
    `);
    
    // Create trigger for updating lastActive
    await this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_user_lastactive 
      AFTER UPDATE ON users
      BEGIN
        UPDATE users SET lastActive = CURRENT_TIMESTAMP WHERE userId = NEW.userId;
      END;
    `);
  }
  
  async registerUser(userId, firstName, username) {
    try {
      const existing = await this.db.get('SELECT userId FROM users WHERE userId = ?', userId);
      
      if (!existing) {
        await this.db.run(
          'INSERT INTO users (userId, firstName, username, balance) VALUES (?, ?, ?, ?)',
          [userId, firstName, username || '', 1000]
        );
        
        await this.addTransaction(userId, 'welcome', 1000, 1000, 'Welcome bonus');
        
        // Add to leaderboard
        await this.db.run(
          'INSERT OR IGNORE INTO leaderboard (userId, username, firstName) VALUES (?, ?, ?)',
          [userId, username || '', firstName]
        );
        
        console.log(`✅ New user registered: ${firstName} (${userId})`);
      } else {
        // Update last active
        await this.db.run(
          'UPDATE users SET lastActive = CURRENT_TIMESTAMP WHERE userId = ?',
          userId
        );
      }
      
      return true;
    } catch (error) {
      console.error('Error registering user:', error);
      throw error;
    }
  }
  
  async getBalance(userId) {
    try {
      const result = await this.db.get('SELECT balance FROM users WHERE userId = ?', userId);
      return result ? result.balance : 0;
    } catch (error) {
      console.error('Error getting balance:', error);
      return 0;
    }
  }
  
  async updateBalance(userId, amount) {
    try {
      const current = await this.getBalance(userId);
      const newBalance = current + amount;
      
      await this.db.run(
        'UPDATE users SET balance = ?, lastActive = CURRENT_TIMESTAMP WHERE userId = ?',
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
    } catch (error) {
      console.error('Error updating balance:', error);
      throw error;
    }
  }
  
  async saveCard(userId, gameId, cardNumber, cardData, price) {
    try {
      const result = await this.db.run(
        `INSERT INTO cards (userId, gameId, cardNumber, cardType, cardData, price) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, gameId, cardNumber, cardData.type || 'bingo', JSON.stringify(cardData), price]
      );
      
      // Update games played
      await this.db.run(
        'UPDATE users SET gamesPlayed = gamesPlayed + 1 WHERE userId = ?',
        userId
      );
      
      return result.lastID;
    } catch (error) {
      console.error('Error saving card:', error);
      throw error;
    }
  }
  
  async getCard(cardId) {
    try {
      return await this.db.get('SELECT * FROM cards WHERE id = ?', cardId);
    } catch (error) {
      console.error('Error getting card:', error);
      return null;
    }
  }
  
  async getUserCards(userId, limit = 10) {
    try {
      return await this.db.all(
        'SELECT * FROM cards WHERE userId = ? ORDER BY purchasedAt DESC LIMIT ?',
        userId, limit
      );
    } catch (error) {
      console.error('Error getting user cards:', error);
      return [];
    }
  }
  
  async addTransaction(userId, type, amount, balance, description) {
    try {
      await this.db.run(
        `INSERT INTO transactions (userId, type, amount, balance, description) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, type, amount, balance, description]
      );
    } catch (error) {
      console.error('Error adding transaction:', error);
    }
  }
  
  async getTransactionHistory(userId, limit = 20) {
    try {
      return await this.db.all(
        'SELECT * FROM transactions WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
        userId, limit
      );
    } catch (error) {
      console.error('Error getting transactions:', error);
      return [];
    }
  }
  
  async saveGameResult(gameId, winnerId, prize) {
    try {
      await this.db.run(
        `UPDATE games SET status = ?, endedAt = CURRENT_TIMESTAMP, winnerId = ?, winningAmount = ? 
         WHERE gameId = ?`,
        ['ended', winnerId, prize, gameId]
      );
      
      await this.db.run(
        'UPDATE users SET gamesWon = gamesWon + 1, totalWinnings = totalWinnings + ? WHERE userId = ?',
        [prize, winnerId]
      );
      
      // Update leaderboard
      await this.db.run(
        `INSERT INTO leaderboard (userId, totalWins, totalEarnings, lastUpdated)
         VALUES (?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(userId) DO UPDATE SET
         totalWins = totalWins + 1,
         totalEarnings = totalEarnings + ?,
         lastUpdated = CURRENT_TIMESTAMP`,
        [winnerId, prize, prize]
      );
      
      return true;
    } catch (error) {
      console.error('Error saving game result:', error);
      return false;
    }
  }
  
  async getLeaderboard(limit = 10) {
    try {
      return await this.db.all(
        `SELECT u.userId, u.firstName, u.username, u.gamesWon, u.totalWinnings 
         FROM users u 
         WHERE u.totalWinnings > 0 
         ORDER BY u.totalWinnings DESC 
         LIMIT ?`,
        limit
      );
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      return [];
    }
  }
  
  async getGameHistory(gameId) {
    try {
      return await this.db.all(
        'SELECT * FROM called_numbers WHERE gameId = ? ORDER BY calledAt',
        gameId
      );
    } catch (error) {
      console.error('Error getting game history:', error);
      return [];
    }
  }
  
  async getUserStats(userId) {
    try {
      return await this.db.get(
        `SELECT 
          gamesPlayed,
          gamesWon,
          totalWinnings,
          balance,
          (SELECT COUNT(*) FROM cards WHERE userId = ?) as cardsBought
         FROM users WHERE userId = ?`,
        userId, userId
      );
    } catch (error) {
      console.error('Error getting user stats:', error);
      return null;
    }
  }
  
  async cleanupOldGames(daysOld = 7) {
    try {
      await this.db.run(
        'DELETE FROM games WHERE endedAt < datetime("now", ?)',
        `-${daysOld} days`
      );
    } catch (error) {
      console.error('Error cleaning up old games:', error);
    }
  }
}

export default Database;