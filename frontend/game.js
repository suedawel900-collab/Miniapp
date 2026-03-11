// Game state management
class BingoGame {
  constructor() {
    this.socket = io();
    this.currentGame = null;
    self.card = null;
    self.markedNumbers = [];
    self.calledNumbers = [];
    self.gameState = {};
    
    this.init();
  }
  
  init() {
    // Load saved game data
    const savedGame = localStorage.getItem('currentGame');
    if (savedGame) {
      this.currentGame = savedGame;
    }
    
    const savedCard = localStorage.getItem('currentCard');
    if (savedCard) {
      this.card = JSON.parse(savedCard);
    }
    
    // Setup socket listeners
    this.setupSocketListeners();
    
    // Load game state
    this.loadGameState();
  }
  
  setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log('Connected to game server');
      if (this.currentGame) {
        this.socket.emit('join_game', this.currentGame);
      }
    });
    
    this.socket.on('game_state', (state) => {
      this.updateGameState(state);
    });
    
    this.socket.on('number_called', (data) => {
      this.handleNumberCalled(data.number);
    });
    
    this.socket.on('game_started', (data) => {
      this.showNotification(`Game ${data.gameId} started!`);
      document.getElementById('gameStatus').textContent = 'Game Active';
    });
    
    this.socket.on('game_ended', (data) => {
      this.showNotification(`Game ended! Final numbers: ${data.finalNumbers.join(', ')}`);
      document.getElementById('gameStatus').textContent = 'Game Ended';
    });
    
    this.socket.on('bingo_winner', (data) => {
      if (data.userId !== tg.initDataUnsafe.user?.id) {
        this.showNotification(`Someone got BINGO in game ${data.gameId}!`);
      }
    });
  }
  
  handleNumberCalled(number) {
    this.calledNumbers.push(number);
    
    // Update UI
    const calledDiv = document.getElementById('calledNumbers');
    if (calledDiv) {
      calledDiv.innerHTML += `<span class="number">${number}</span>`;
    }
    
    // Check if number is on player's card
    if (this.card && this.isNumberOnCard(number)) {
      this.markNumberOnCard(number);
    }
    
    // Play sound (if enabled)
    this.playSound('number-called');
  }
  
  isNumberOnCard(number) {
    if (!this.card) return false;
    
    if (this.card.type === 'bingo') {
      return this.card.numbers.flat().includes(number);
    } else if (this.card.type === 'bin50') {
      return this.card.rows.some(row => 
        row.some(n => parseInt(n) === number)
      );
    }
    return false;
  }
  
  markNumberOnCard(number) {
    this.markedNumbers.push(number);
    
    // Update UI
    document.querySelectorAll('.bingo-number').forEach(el => {
      if (parseInt(el.textContent) === number) {
        el.classList.add('marked');
      }
    });
    
    this.socket.emit('mark_number', {
      gameId: this.currentGame,
      number: number
    });
  }
  
  async loadGameState() {
    try {
      const response = await fetch('/api/game-state');
      const state = await response.json();
      this.updateGameState(state);
    } catch (error) {
      console.error('Failed to load game state:', error);
    }
  }
  
  updateGameState(state) {
    this.gameState = state;
    
    // Update UI
    const gameInfo = state[this.currentGame];
    if (gameInfo) {
      document.getElementById('prizePool').textContent = `$${gameInfo.prizePool}`;
      document.getElementById('playerCount').textContent = gameInfo.playerCount;
      document.getElementById('lastNumber').textContent = gameInfo.lastNumber || '-';
    }
  }
  
  async checkBingo() {
    if (!this.card) {
      this.showNotification('No card selected!');
      return;
    }
    
    // Send BINGO claim to server
    this.socket.emit('bingo_claim', {
      gameId: this.currentGame,
      cardId: this.card.id,
      markedNumbers: this.markedNumbers
    });
    
    // Also send via Telegram
    tg.sendData(JSON.stringify({
      type: 'BINGO',
      gameId: this.currentGame,
      cardId: this.card.id,
      markedNumbers: this.markedNumbers
    }));
    
    this.showNotification('BINGO claimed! Waiting for verification...');
  }
  
  playSound(soundName) {
    // Implement sound effects
    const audio = new Audio(`/sounds/${soundName}.mp3`);
    audio.play().catch(() => {});
  }
  
  showNotification(message) {
    // Show in-app notification
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }
}

// Initialize game when page loads
let game;
document.addEventListener('DOMContentLoaded', () => {
  game = new BingoGame();
});

// Global functions for HTML buttons
function checkBingo() {
  if (game) game.checkBingo();
}

function switchGame(gameId) {
  game.currentGame = gameId;
  localStorage.setItem('currentGame', gameId);
  game.socket.emit('join_game', gameId);
  location.reload();
}