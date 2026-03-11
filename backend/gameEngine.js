class GameEngine {
  constructor(io, db) {
    this.io = io;
    this.db = db;
    this.games = new Map();
    this.autoCallIntervals = new Map();
    this.playerGames = new Map(); // Track which game each player is in
    
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
      lastNumber: null,
      createdAt: Date.now()
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
      lastNumber: null,
      createdAt: Date.now()
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
      lastNumber: null,
      createdAt: Date.now()
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
        lastNumber: game.lastNumber,
        createdAt: game.createdAt
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
          prizePool: game.prizePool,
          cardPrice: game.cardPrice
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
    
    try {
      // Get card from database
      const card = await this.db.getCard(cardId);
      if (!card) return { success: false, error: 'Card not found' };
      
      // Check if player already in game
      if (game.players.has(userId)) {
        return { success: false, error: 'Already in this game' };
      }
      
      // Add player to game
      game.players.set(userId, {
        userId,
        cardId,
        card: JSON.parse(card.cardData),
        markedNumbers: [],
        joinedAt: Date.now()
      });
      
      // Track player's game
      this.playerGames.set(userId, gameId);
      
      // Add to prize pool (80% goes to prize pool, 20% house fee)
      const contribution = Math.floor(game.cardPrice * 0.8);
      game.prizePool += contribution;
      
      // Notify all players in game
      this.io.to(`game_${gameId}`).emit('player_joined', {
        playerCount: game.players.size,
        prizePool: game.prizePool
      });
      
      console.log(`👤 Player ${userId} joined game ${gameId}`);
      
      return { 
        success: true, 
        game: {
          id: game.id,
          type: game.type,
          calledNumbers: game.calledNumbers,
          prizePool: game.prizePool,
          playerCount: game.players.size
        }
      };
    } catch (error) {
      console.error('Error joining game:', error);
      return { success: false, error: 'Internal error' };
    }
  }
  
  leaveGame(userId, gameId) {
    const game = this.games.get(gameId);
    if (!game) return false;
    
    if (game.players.delete(userId)) {
      this.playerGames.delete(userId);
      this.io.to(`game_${gameId}`).emit('player_left', {
        playerCount: game.players.size
      });
      return true;
    }
    
    return false;
  }
  
  startGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return false;
    
    if (game.players.size === 0) {
      return false;
    }
    
    game.status = 'active';
    game.startTime = Date.now();
    game.calledNumbers = [];
    game.availableNumbers = this.shuffle([...game.availableNumbers]);
    
    this.io.to(`game_${gameId}`).emit('game_started', {
      gameId,
      startTime: game.startTime,
      playerCount: game.players.size,
      prizePool: game.prizePool
    });
    
    console.log(`🎮 Game ${gameId} started with ${game.players.size} players`);
    
    return true;
  }
  
  callNumber(gameId, number) {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'active') return false;
    
    // Validate number
    number = parseInt(number);
    const maxNumber = game.type === 'special' ? 90 : 75;
    if (isNaN(number) || number < 1 || number > maxNumber) return false;
    
    // Check if already called
    if (game.calledNumbers.includes(number)) return false;
    
    // Add to called numbers
    game.calledNumbers.push(number);
    game.lastNumber = number;
    
    // Remove from available
    game.availableNumbers = game.availableNumbers.filter(n => n !== number);
    
    // Notify all players
    this.io.to(`game_${gameId}`).emit('number_called', {
      number,
      calledNumbers: game.calledNumbers,
      remaining: game.availableNumbers.length
    });
    
    console.log(`🔢 Game ${gameId} called number: ${number}`);
    
    // Auto-check for winners (optional)
    const winners = this.checkForWinners(gameId);
    if (winners.length > 0) {
      this.handleAutoWinners(gameId, winners);
    }
    
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
        this.stopAutoCall(gameId);
        return;
      }
      
      // Check if all numbers called
      if (game.calledNumbers.length >= (game.type === 'special' ? 90 : 75)) {
        this.endGame(gameId);
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
    
    console.log(`⏱️ Auto-call started for game ${gameId} (${intervalSeconds}s interval)`);
    
    return true;
  }
  
  stopAutoCall(gameId) {
    if (this.autoCallIntervals.has(gameId)) {
      clearInterval(this.autoCallIntervals.get(gameId));
      this.autoCallIntervals.delete(gameId);
      console.log(`⏱️ Auto-call stopped for game ${gameId}`);
    }
  }
  
  async validateBingo(userId, cardId, markedNumbers) {
    const gameId = this.playerGames.get(userId);
    if (!gameId) return false;
    
    const game = this.games.get(gameId);
    if (!game) return false;
    
    const player = game.players.get(userId);
    if (!player || player.cardId !== cardId) return false;
    
    try {
      // Check if all numbers in card are marked
      const card = player.card;
      
      if (game.type === 'bingo') {
        return this.checkTraditionalBingo(card, game.calledNumbers);
      } else if (game.type === 'bin50') {
        return this.checkBinBingo(card, game.calledNumbers);
      } else if (game.type === 'special') {
        return this.checkSpecialBingo(card, game.calledNumbers);
      }
      
      return false;
    } catch (error) {
      console.error('Error validating bingo:', error);
      return false;
    }
  }
  
  checkTraditionalBingo(card, calledNumbers) {
    const rows = card.numbers || card.rows || card;
    
    // Check horizontal lines
    for (let i = 0; i < 5; i++) {
      let count = 0;
      for (let j = 0; j < 5; j++) {
        const num = rows[i]?.[j];
        if (i === 2 && j === 2) { // Free space
          count++;
        } else if (num && calledNumbers.includes(parseInt(num))) {
          count++;
        }
      }
      if (count === 5) return true;
    }
    
    // Check vertical lines
    for (let j = 0; j < 5; j++) {
      let count = 0;
      for (let i = 0; i < 5; i++) {
        const num = rows[i]?.[j];
        if (i === 2 && j === 2) { // Free space
          count++;
        } else if (num && calledNumbers.includes(parseInt(num))) {
          count++;
        }
      }
      if (count === 5) return true;
    }
    
    // Check diagonals
    let diag1 = 0, diag2 = 0;
    for (let i = 0; i < 5; i++) {
      const num1 = rows[i]?.[i];
      const num2 = rows[i]?.[4 - i];
      
      if (i === 2 && i === 2) { // Center is free space
        diag1++;
        diag2++;
      } else {
        if (num1 && calledNumbers.includes(parseInt(num1))) diag1++;
        if (num2 && calledNumbers.includes(parseInt(num2))) diag2++;
      }
    }
    
    return diag1 === 5 || diag2 === 5;
  }
  
  checkBinBingo(card, calledNumbers) {
    const rows = card.rows || card;
    
    for (const row of rows) {
      const rowNumbers = row.filter(n => !isNaN(parseInt(n))).map(n => parseInt(n));
      const allMatched = rowNumbers.every(num => calledNumbers.includes(num));
      if (allMatched) return true;
    }
    
    return false;
  }
  
  checkSpecialBingo(card, calledNumbers) {
    const numbers = card.numbers || [];
    const markedCount = numbers.filter(num => calledNumbers.includes(num)).length;
    
    // Special pattern - 80% of numbers
    return markedCount >= Math.floor(numbers.length * 0.8);
  }
  
  checkForWinners(gameId) {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'active') return [];
    
    const winners = [];
    
    for (const [userId, player] of game.players) {
      try {
        let hasBingo = false;
        
        if (game.type === 'bingo') {
          hasBingo = this.checkTraditionalBingo(player.card, game.calledNumbers);
        } else if (game.type === 'bin50') {
          hasBingo = this.checkBinBingo(player.card, game.calledNumbers);
        } else if (game.type === 'special') {
          hasBingo = this.checkSpecialBingo(player.card, game.calledNumbers);
        }
        
        if (hasBingo) {
          winners.push(userId);
        }
      } catch (error) {
        console.error('Error checking winner:', error);
      }
    }
    
    return winners;
  }
  
  async handleAutoWinners(gameId, winners) {
    if (winners.length === 0) return;
    
    const game = this.games.get(gameId);
    if (!game) return;
    
    // Take first winner (in case of multiple simultaneous wins)
    const winnerId = winners[0];
    const prize = Math.floor(game.prizePool * 0.8);
    
    try {
      await this.db.saveGameResult(gameId, winnerId, prize);
      await this.db.updateBalance(winnerId, prize);
      
      this.io.to(`game_${gameId}`).emit('bingo_winner', {
        userId: winnerId,
        prize: prize
      });
      
      console.log(`🏆 Winner in game ${gameId}: ${winnerId} won $${prize}`);
      
      this.endGame(gameId);
    } catch (error) {
      console.error('Error handling auto winner:', error);
    }
  }
  
  async processWin(userId, gameId) {
    const game = this.games.get(gameId);
    if (!game) return 0;
    
    const player = game.players.get(userId);
    if (!player) return 0;
    
    // Calculate prize (80% of prize pool)
    const prize = Math.floor(game.prizePool * 0.8);
    
    try {
      // Update database
      await this.db.saveGameResult(gameId, userId, prize);
      
      // End game
      this.endGame(gameId);
      
      return prize;
    } catch (error) {
      console.error('Error processing win:', error);
      return 0;
    }
  }
  
  markNumber(socketId, data) {
    const game = this.games.get(data.gameId);
    if (!game) return;
    
    const player = game.players.get(data.userId);
    if (player && !player.markedNumbers.includes(data.number)) {
      player.markedNumbers.push(data.number);
    }
  }
  
  endGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    game.status = 'ended';
    
    // Clear auto-call interval
    this.stopAutoCall(gameId);
    
    // Clear player references
    for (const userId of game.players.keys()) {
      this.playerGames.delete(userId);
    }
    
    // Notify players
    this.io.to(`game_${gameId}`).emit('game_ended', {
      gameId,
      finalNumbers: game.calledNumbers,
      playerCount: game.players.size
    });
    
    console.log(`🎮 Game ${gameId} ended`);
    
    // Reset game after 30 seconds
    setTimeout(() => {
      if (this.games.has(gameId)) {
        this.games.delete(gameId);
        this.initGames(); // Reinitialize
        console.log(`🔄 Game ${gameId} reset`);
      }
    }, 30000);
  }
  
  getPlayerGame(userId) {
    return this.playerGames.get(userId);
  }
  
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
  cleanupOldGames() {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    
    for (const [gameId, game] of this.games) {
      if (game.status === 'ended' && now - game.createdAt > maxAge) {
        this.games.delete(gameId);
        console.log(`🧹 Cleaned up old game ${gameId}`);
      }
    }
  }
}

export default GameEngine;