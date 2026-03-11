const sqlite3 = require('sqlite3');
const path = require('path');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, 'bingo.db');
    this.db = null;
    this.init();
  }
  
  init() {
    try {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('❌ Database connection error:', err);
        } else {
          console.log('✅ Database connected');
          this.createTables();
        }
      });
    } catch (error) {
      console.error('❌ Database initialization error:', error);
    }
  }
  
  createTables() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        username TEXT,
        firstName TEXT,
        balance INTEGER DEFAULT 1000,
        gamesPlayed INTEGER DEFAULT 0,
        gamesWon INTEGER DEFAULT 0,
        totalWinnings INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        lastActive DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS cards (
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
      )`,
      
      `CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT,
        status TEXT,
        startedAt DATETIME,
        endedAt DATETIME,
        prizePool INTEGER,
        winnerId TEXT,
        winningAmount INTEGER,
        FOREIGN KEY (winnerId) REFERENCES users(userId)
      )`,
      
      `CREATE TABLE IF NOT EXISTS called_numbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT,
        number INTEGER,
        calledAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        type TEXT,
        amount INTEGER,
        balance INTEGER,
        description TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(userId)
      )`,
      
      `CREATE TABLE IF NOT EXISTS leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT UNIQUE,
        username TEXT,
        firstName TEXT,
        totalWins INTEGER DEFAULT 0,
        totalEarnings INTEGER DEFAULT 0,
        lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(userId)
      )`
    ];
    
    // Run each query sequentially
    const runQuery = (index) => {
      if (index >= queries.length) {
        console.log('✅ Tables created/verified');
        return;
      }
      
      this.db.run(queries[index], (err) => {
        if (err) {
          console.error('Error creating table:', err);
        }
        runQuery(index + 1);
      });
    };
    
    runQuery(0);
  }
  
  registerUser(userId, firstName, username) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT userId FROM users WHERE userId = ?', [userId], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!row) {
          this.db.run(
            'INSERT INTO users (userId, firstName, username, balance) VALUES (?, ?, ?, ?)',
            [userId, firstName, username || '', 1000],
            (err) => {
              if (err) {
                reject(err);
              } else {
                this.addTransaction(userId, 'welcome', 1000, 1000, 'Welcome bonus');
                resolve(true);
              }
            }
          );
        } else {
          this.db.run(
            'UPDATE users SET lastActive = CURRENT_TIMESTAMP WHERE userId = ?',
            [userId]
          );
          resolve(true);
        }
      });
    });
  }
  
  getBalance(userId) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT balance FROM users WHERE userId = ?', [userId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.balance : 0);
        }
      });
    });
  }
  
  updateBalance(userId, amount) {
    return new Promise(async (resolve, reject) => {
      try {
        const current = await this.getBalance(userId);
        const newBalance = current + amount;
        
        this.db.run(
          'UPDATE users SET balance = ?, lastActive = CURRENT_TIMESTAMP WHERE userId = ?',
          [newBalance, userId],
          (err) => {
            if (err) {
              reject(err);
            } else {
              this.addTransaction(
                userId, 
                amount > 0 ? 'credit' : 'debit', 
                Math.abs(amount), 
                newBalance,
                amount > 0 ? 'Funds added' : 'Card purchase'
              );
              resolve(newBalance);
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }
  
  saveCard(userId, gameId, cardNumber, cardData, price) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO cards (userId, gameId, cardNumber, cardType, cardData, price) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, gameId, cardNumber, cardData.type || 'bingo', JSON.stringify(cardData), price],
        function(err) {
          if (err) {
            reject(err);
          } else {
            this.db.run(
              'UPDATE users SET gamesPlayed = gamesPlayed + 1 WHERE userId = ?',
              [userId],
              (updateErr) => {
                if (updateErr) console.error('Error updating gamesPlayed:', updateErr);
              }
            );
            resolve(this.lastID);
          }
        }.bind(this)
      );
    });
  }
  
  getCard(cardId) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM cards WHERE id = ?', [cardId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
  
  getUserCards(userId, limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM cards WHERE userId = ? ORDER BY purchasedAt DESC LIMIT ?',
        [userId, limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }
  
  addTransaction(userId, type, amount, balance, description) {
    this.db.run(
      `INSERT INTO transactions (userId, type, amount, balance, description) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, type, amount, balance, description],
      (err) => {
        if (err) console.error('Error adding transaction:', err);
      }
    );
  }
  
  getTransactionHistory(userId, limit = 20) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM transactions WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
        [userId, limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }
  
  saveGameResult(gameId, winnerId, prize) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE games SET status = ?, endedAt = CURRENT_TIMESTAMP, winnerId = ?, winningAmount = ? 
         WHERE gameId = ?`,
        ['ended', winnerId, prize, gameId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            this.db.run(
              'UPDATE users SET gamesWon = gamesWon + 1, totalWinnings = totalWinnings + ? WHERE userId = ?',
              [prize, winnerId],
              (err) => {
                if (err) {
                  reject(err);
                } else {
                  this.db.run(
                    `INSERT INTO leaderboard (userId, totalWins, totalEarnings, lastUpdated)
                     VALUES (?, 1, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(userId) DO UPDATE SET
                     totalWins = totalWins + 1,
                     totalEarnings = totalEarnings + ?,
                     lastUpdated = CURRENT_TIMESTAMP`,
                    [winnerId, prize, prize]
                  );
                  resolve(true);
                }
              }
            );
          }
        }
      );
    });
  }
  
  getLeaderboard(limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT u.userId, u.firstName, u.username, u.gamesWon, u.totalWinnings 
         FROM users u 
         WHERE u.totalWinnings > 0 
         ORDER BY u.totalWinnings DESC 
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }
  
  getGameHistory(gameId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM called_numbers WHERE gameId = ? ORDER BY calledAt',
        [gameId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }
  
  getUserStats(userId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT 
          gamesPlayed,
          gamesWon,
          totalWinnings,
          balance,
          (SELECT COUNT(*) FROM cards WHERE userId = ?) as cardsBought
         FROM users WHERE userId = ?`,
        [userId, userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });
  }
}

module.exports = Database;