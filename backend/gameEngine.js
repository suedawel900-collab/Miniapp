class GameEngine {
  constructor(io, db) {
    this.io = io;
    this.db = db;
    this.games = new Map();
    this.autoCallIntervals = new Map();
    
    // Initialize default games
    this.initGames();
  }
  
  initGames() {
    // Game #16 - Bin50 Format
    this.games.set('16', {
      id: '16',
      name: 'BIG GTO',
      type: 'bin50',
      status: 'waiting',
      players: new Map(),
      calledNumbers: [],
      availableNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      prizePool: 0,
      cardPrice: 50,
      startTime: null,
      lastNumber: null
    });
    
    // Game #10 - Traditional Bingo
    this.games.set('10', {
      id: '10',
      name: 'BIG GTO',
      type: 'bingo',
      status: 'waiting',
      players: new Map(),
      calledNumbers: [],
      availableNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      prizePool: 0,
      cardPrice: 50,
      startTime: null,
      lastNumber: null
    });
    
    // Game #1000 - Special Edition
    this.games.set('1000', {
      id: '1000',
      name: 'BIG GTO SPECIAL',
      type: 'special',
      status: 'waiting',
      players: new Map(),
      calledNumbers: [],
      availableNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
      prizePool: 0,
      cardPrice: 100,
      startTime: null,
      lastNumber: null
    });
  }
  
  getGameState() {
    const state = {};
    for (const [id, game] of this.games) {
      state[id] = {
        id: game.id,
        name: game.name,
        type: game.type,
        status: game.status,
        playerCount: game.players.size,
        calledNumbers: game.calledNumbers.slice(-20),
        prizePool: game.prizePool,
        cardPrice: game.cardPrice,
        lastNumber: game.lastNumber
      };
    }
    return state;
  }
  
  getActiveGames() {
    const active = [];
    for (const [id, game] of this.games) {
      if (game.status === 'active' || game.status === 'waiting') {
        active.push({
          id: game.id,
          name: game.name,
          type: game.type,
          status: game.status,
          players: game.players.size,
          prizePool: game.prizePool
        });
      }
    }
    return active;
  }
  
  async joinGame(userId, gameId, cardId) {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };
    
    if (game.status !== 'waiting' && game.status !== 'active') {
      return { success: false, error: 'Game not available' };
    }
    
    // Get card from database
    const card = await this.db.getCard(cardId);
    if (!card) return { success: false, error: 'Card not found' };
    
    // Add player to game
    game.players.set(userId, {
      userId,
      cardId,
      card: JSON.parse(card.cardData),
      markedNumbers: [],
      joinedAt: Date.now()
    });
    
    // Add to prize pool
    game.prizePool += game.cardPrice * 0.8; // 80% goes to prize pool, 20% house fee
    
    // Notify all players in game
    this.io.to(`game_${gameId}`).emit('player_joined', {
      playerCount: game.players.size
    });
    
    return { 
      success: true, 
      game: {
        id: game.id,
        type: game.type,
        calledNumbers: game.calledNumbers,
        prizePool: game.prizePool
      }
    };
  }
  
  startGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return false;
    
    game.status = 'active';
    game.startTime = Date.now();
    game.calledNumbers = [];
    game.availableNumbers = this.shuffle(game.availableNumbers);
    
    this.io.to(`game_${gameId}`).emit('game_started', {
      gameId,
      startTime: game.startTime
    });
    
    return true;
  }
  
  callNumber(gameId, number) {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'active') return false;
    
    // Validate number
    number = parseInt(number);
    if (isNaN(number) || number < 1 || number > 75) return false;
    
    // Check if already called
    if (game.calledNumbers.includes(number)) return false;
    
    // Add to called numbers
    game.calledNumbers.push(number);
    game.lastNumber = number;
    
    // Notify all players
    this.io.to(`game_${gameId}`).emit('number_called', {
      number,
      calledNumbers: game.calledNumbers
    });
    
    // Check for automatic winners
    this.checkForWinners(gameId);
    
    return true;
  }
  
  startAutoCall(gameId, intervalSeconds = 5) {
    const game = this.games.get(gameId);
    if (!game) return false;
    
    // Clear existing interval
    if (this.autoCallIntervals.has(gameId)) {
      clearInterval(this.autoCallIntervals.get(gameId));
    }
    
    // Start new interval
    const interval = setInterval(() => {
      const game = this.games.get(gameId);
      if (!game || game.status !== 'active') {
        clearInterval(interval);
        this.autoCallIntervals.delete(gameId);
        return;
      }
      
      // Get next random number
      const available = game.availableNumbers.filter(n => !game.calledNumbers.includes(n));
      if (available.length === 0) {
        this.endGame(gameId);
        return;
      }
      
      const randomIndex = Math.floor(Math.random() * available.length);
      const number = available[randomIndex];
      
      this.callNumber(gameId, number);
    }, intervalSeconds * 1000);
    
    this.autoCallIntervals.set(gameId, interval);
    return true;
  }
  
  async validateBingo(userId, cardId, markedNumbers) {
    const game = this.findGameByPlayer(userId);
    if (!game) return false;
    
    const player = game.players.get(userId);
    if (!player || player.cardId !== cardId) return false;
    
    // Check if all numbers in card are marked
    const card = player.card;
    
    if (game.type === 'bingo') {
      return this.checkTraditionalBingo(card, game.calledNumbers, markedNumbers);
    } else if (game.type === 'bin50') {
      return this.checkBinBingo(card, game.calledNumbers, markedNumbers);
    } else {
      return this.checkSpecialBingo(card, game.calledNumbers, markedNumbers);
    }
  }
  
  checkTraditionalBingo(card, calledNumbers, markedNumbers) {
    // Check for 5 in a row (horizontal, vertical, diagonal)
    const rows = card.rows || card;
    
    // Check horizontal
    for (let i = 0; i < 5; i++) {
      let count = 0;
      for (let j = 0; j < 5; j++) {
        const num = rows[i][j];
        if (num === 'FREE' || calledNumbers.includes(parseInt(num))) {
          count++;
        }
      }
      if (count === 5) return true;
    }
    
    // Check vertical
    for (let j = 0; j < 5; j++) {
      let count = 0;
      for (let i = 0; i < 5; i++) {
        const num = rows[i][j];
        if (num === 'FREE' || calledNumbers.includes(parseInt(num))) {
          count++;
        }
      }
      if (count === 5) return true;
    }
    
    // Check diagonal
    let diag1 = 0, diag2 = 0;
    for (let i = 0; i < 5; i++) {
      const num1 = rows[i][i];
      const num2 = rows[i][4 - i];
      if (num1 === 'FREE' || calledNumbers.includes(parseInt(num1))) diag1++;
      if (num2 === 'FREE' || calledNumbers.includes(parseInt(num2))) diag2++;
    }
    
    return diag1 === 5 || diag2 === 5;
  }
  
  checkBinBingo(card, calledNumbers, markedNumbers) {
    // Bin bingo - any row completely matched
    const rows = card.rows || card;
    
    for (const row of rows) {
      const rowNumbers = row.filter(n => !isNaN(parseInt(n))).map(n => parseInt(n));
      const allMatched = rowNumbers.every(num => calledNumbers.includes(num));
      if (allMatched) return true;
    }
    
    return false;
  }
  
  checkSpecialBingo(card, calledNumbers, markedNumbers) {
    // Special pattern - can customize
    const pattern = card.pattern || 'full';
    
    if (pattern === 'full') {
      // All numbers on card
      const allNumbers = card.numbers || [];
      return allNumbers.every(num => calledNumbers.includes(num));
    }
    
    return false;
  }
  
  async processWin(userId, gameId) {
    const game = this.games.get(gameId);
    if (!game) return 0;
    
    // Calculate prize (80% of prize pool)
    const prize = Math.floor(game.prizePool * 0.8);
    
    // Update player balance
    await this.db.updateBalance(userId, prize);
    
    // Reset prize pool
    game.prizePool = 0;
    
    // End game
    this.endGame(gameId);
    
    return prize;
  }
  
  checkForWinners(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    // Auto-check for winners (can be implemented)
    // For now, players claim BINGO manually
  }
  
  markNumber(socketId, data) {
    // Track marked numbers for player
    this.io.to(socketId).emit('number_marked', data);
  }
  
  endGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    game.status = 'ended';
    
    // Clear auto-call interval
    if (this.autoCallIntervals.has(gameId)) {
      clearInterval(this.autoCallIntervals.get(gameId));
      this.autoCallIntervals.delete(gameId);
    }
    
    // Notify players
    this.io.to(`game_${gameId}`).emit('game_ended', {
      gameId,
      finalNumbers: game.calledNumbers
    });
    
    // Reset game after 10 seconds
    setTimeout(() => {
      if (this.games.has(gameId)) {
        this.games.delete(gameId);
        this.initGames(); // Reinitialize
      }
    }, 10000);
  }
  
  findGameByPlayer(userId) {
    for (const [gameId, game] of this.games) {
      if (game.players.has(userId)) {
        return game;
      }
    }
    return null;
  }
  
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

export default GameEngine;