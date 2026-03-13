// Game state management
class BingoGame {
    constructor() {
        this.socket = io();
        this.currentGame = localStorage.getItem('currentGame') || '10';
        this.card = null;
        this.markedNumbers = [];
        this.calledNumbers = [];
        this.gameState = {};
        this.userId = null;
        
        this.init();
    }
    
    async init() {
        // Get Telegram user
        const tg = window.Telegram.WebApp;
        this.userId = tg.initDataUnsafe.user?.id;
        
        if (!this.userId) {
            console.warn('⚠️ No Telegram user ID – balance will not be fetched');
            document.getElementById('balance').textContent = '⚠️ Not in Telegram';
        } else {
            console.log('✅ User ID:', this.userId);
        }
        
        // Load saved card
        const savedCard = localStorage.getItem('currentCard');
        if (savedCard) {
            this.card = JSON.parse(savedCard);
            document.getElementById('cardId').textContent = `#${this.card.number}`;
        }
        
        // Set active tab
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.game === this.currentGame) {
                btn.classList.add('active');
            }
        });
        
        // Load balance
        await this.loadBalance();
        
        // Setup socket listeners
        this.setupSocketListeners();
        
        // Join game
        this.socket.emit('join_game', this.currentGame);
        
        // Load game state
        await this.loadGameState();
        
        // Render appropriate card
        this.renderCard();
    }
    
    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to game server');
        });
        
        this.socket.on('game_state', (state) => {
            this.updateGameState(state);
        });
        
        this.socket.on('number_called', (data) => {
            this.handleNumberCalled(data.number);
            this.updateCalledNumbers(data.calledNumbers);
        });
        
        this.socket.on('game_started', (data) => {
            this.showNotification(`Game started! 🎮`, 'success');
            document.getElementById('gameStatus').textContent = 'Active';
            document.getElementById('gameStatus').className = 'value active';
        });
        
        this.socket.on('game_ended', (data) => {
            this.showNotification(`Game ended`, 'info');
            document.getElementById('gameStatus').textContent = 'Ended';
            document.getElementById('gameStatus').className = 'value ended';
        });
        
        this.socket.on('player_joined', (data) => {
            document.getElementById('playerCount').textContent = data.playerCount;
            document.getElementById('prizePool').textContent = `$${data.prizePool}`;
        });
        
        this.socket.on('bingo_winner', (data) => {
            if (data.userId !== this.userId) {
                this.showNotification(`Someone won $${data.prize}! 🎉`, 'success');
            }
        });
        
        this.socket.on('game_joined', (data) => {
            if (data.success) {
                console.log(`Joined game ${this.currentGame}`);
            }
        });
    }
    
    async loadBalance() {
        const balanceEl = document.getElementById('balance');
        if (!balanceEl) return;

        if (!this.userId) {
            balanceEl.textContent = '⚠️ No user ID';
            return;
        }
        
        try {
            const response = await fetch(`/api/user-balance/${this.userId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            console.log('💰 Balance data:', data);
            balanceEl.textContent = `$${data.balance}`;
        } catch (error) {
            console.error('❌ Error loading balance:', error);
            balanceEl.textContent = '⚠️ Error';
        }
    }
    
    async loadGameState() {
        try {
            const response = await fetch('/api/game-state');
            const state = await response.json();
            this.updateGameState(state);
        } catch (error) {
            console.error('Error loading game state:', error);
        }
    }
    
    updateGameState(state) {
        this.gameState = state;
        
        const game = state[this.currentGame];
        if (game) {
            document.getElementById('playerCount').textContent = game.playerCount;
            document.getElementById('prizePool').textContent = `$${game.prizePool}`;
            document.getElementById('gameStatus').textContent = 
                game.status === 'active' ? 'Active' : 'Waiting';
            document.getElementById('gameStatus').className = 
                `value ${game.status}`;
            
            if (game.lastNumber) {
                document.getElementById('lastNumber').textContent = game.lastNumber;
            }
            
            if (game.calledNumbers) {
                this.updateCalledNumbers(game.calledNumbers);
            }
        }
    }
    
    handleNumberCalled(number) {
        this.calledNumbers.push(number);
        document.getElementById('lastNumber').textContent = number;
        
        // Play sound (if available)
        this.playSound('ding');
        
        // Check if number is on card
        if (this.card && this.isNumberOnCard(number)) {
            this.markNumberOnCard(number);
        }
    }
    
    updateCalledNumbers(numbers) {
        const container = document.getElementById('calledNumbers');
        const maxDisplay = 20;
        const recentNumbers = numbers.slice(-maxDisplay);
        
        container.innerHTML = recentNumbers.map(num => 
            `<span class="number called">${num}</span>`
        ).join('');
        
        document.getElementById('calledCount').textContent = 
            `${numbers.length}/${this.currentGame === '1000' ? 90 : 75}`;
    }
    
    isNumberOnCard(number) {
        if (!this.card) return false;
        
        if (this.card.type === 'bingo') {
            return this.card.numbers.flat().includes(number);
        } else if (this.card.type === 'bin50') {
            return this.card.rows.some(row => 
                row.some(n => parseInt(n) === number)
            );
        } else if (this.card.type === 'special') {
            return this.card.numbers?.includes(number);
        }
        return false;
    }
    
    markNumberOnCard(number) {
        if (this.markedNumbers.includes(number)) return;
        
        this.markedNumbers.push(number);
        
        // Update UI
        document.querySelectorAll('.bingo-number, .bin-row, .special-number').forEach(el => {
            if (el.textContent.includes(number.toString())) {
                el.classList.add('marked');
            }
        });
        
        // Send to server
        this.socket.emit('mark_number', {
            gameId: this.currentGame,
            userId: this.userId,
            number: number
        });
    }
    
    renderCard() {
        if (!this.card) return;
        
        // Hide all cards
        document.getElementById('traditionalCard').style.display = 'none';
        document.getElementById('binCard').style.display = 'none';
        document.getElementById('specialCard').style.display = 'none';
        
        if (this.card.type === 'bingo') {
            document.getElementById('traditionalCard').style.display = 'block';
            this.renderBingoCard();
        } else if (this.card.type === 'bin50') {
            document.getElementById('binCard').style.display = 'block';
            this.renderBinCard();
        } else if (this.card.type === 'special') {
            document.getElementById('specialCard').style.display = 'block';
            this.renderSpecialCard();
        }
    }
    
    renderBingoCard() {
        const body = document.getElementById('bingoCardBody');
        const numbers = this.card.numbers || this.generateBingoNumbers();
        
        let html = '';
        for (let i = 0; i < 5; i++) {
            html += '<div class="bingo-row">';
            for (let j = 0; j < 5; j++) {
                const num = numbers[i][j];
                if (i === 2 && j === 2) {
                    html += '<span class="number free">★</span>';
                } else {
                    const isMarked = this.calledNumbers.includes(num) ? 'marked' : '';
                    html += `<span class="number bingo-number ${isMarked}" data-number="${num}">${num}</span>`;
                }
            }
            html += '</div>';
        }
        body.innerHTML = html;
    }
    
    renderBinCard() {
        const body = document.getElementById('binCardBody');
        const rows = this.card.rows || this.generateBinNumbers();
        
        let html = '';
        rows.forEach(row => {
            const isMarked = row.every(num => 
                isNaN(parseInt(num)) || this.calledNumbers.includes(parseInt(num))
            ) ? 'marked' : '';
            html += `<div class="bin-row ${isMarked}">${row.join(' ')}</div>`;
        });
        body.innerHTML = html;
    }
    
    renderSpecialCard() {
        const body = document.getElementById('specialCardBody');
        const numbers = this.card.numbers || this.generateSpecialNumbers();
        
        let html = '<div class="numbers-grid">';
        numbers.forEach(num => {
            const isMarked = this.calledNumbers.includes(num) ? 'marked' : '';
            html += `<span class="special-number ${isMarked}">${num}</span>`;
        });
        html += '</div>';
        body.innerHTML = html;
    }
    
    generateBingoNumbers() {
        const card = [];
        for (let col = 0; col < 5; col++) {
            const min = col * 15 + 1;
            const max = min + 14;
            const colNumbers = [];
            while (colNumbers.length < 5) {
                const num = Math.floor(Math.random() * (max - min + 1)) + min;
                if (!colNumbers.includes(num)) {
                    colNumbers.push(num);
                }
            }
            colNumbers.sort((a, b) => a - b);
            for (let row = 0; row < 5; row++) {
                if (!card[row]) card[row] = [];
                card[row][col] = colNumbers[row];
            }
        }
        return card;
    }
    
    generateBinNumbers() {
        return [
            [1, Math.floor(Math.random() * 10000000) + 10000000],
            [2, Math.floor(Math.random() * 10000000) + 10000000],
            [3, Math.floor(Math.random() * 100000) + 100000],
            [4, Math.floor(Math.random() * 100000) + 100000],
            [5, Math.floor(Math.random() * 10000000) + 10000000]
        ];
    }
    
    generateSpecialNumbers() {
        const numbers = [];
        while (numbers.length < 15) {
            const num = Math.floor(Math.random() * 90) + 1;
            if (!numbers.includes(num)) {
                numbers.push(num);
            }
        }
        return numbers.sort((a, b) => a - b);
    }
    
    async checkBingo() {
        if (!this.card) {
            this.showNotification('Buy a card first!', 'error');
            return;
        }
        
        const tg = window.Telegram.WebApp;
        
        // Send BINGO claim
        tg.sendData(JSON.stringify({
            type: 'BINGO',
            gameId: this.currentGame,
            cardId: this.card.id,
            markedNumbers: this.markedNumbers
        }));
        
        this.showNotification('BINGO claimed! Verifying...', 'info');
        
        // Visual feedback
        document.getElementById('bingoBtn').classList.add('claimed');
        setTimeout(() => {
            document.getElementById('bingoBtn').classList.remove('claimed');
        }, 2000);
    }
    
    playSound(sound) {
        // Optional: Implement sound effects
        // const audio = new Audio(`/sounds/${sound}.mp3`);
        // audio.play().catch(() => {});
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Global functions
let game;

window.onload = () => {
    game = new BingoGame();
};

window.switchGame = (gameId) => {
    if (game) {
        game.socket.emit('leave_game', game.currentGame);
        game.currentGame = gameId;
        localStorage.setItem('currentGame', gameId);
        game.socket.emit('join_game', gameId);
        game.loadGameState();
        
        // Update active tab
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.game === gameId) {
                btn.classList.add('active');
            }
        });
    }
};

window.checkBingo = () => {
    if (game) game.checkBingo();
};