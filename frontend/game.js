// Game state management – with multiple card support
class BingoGame {
    constructor() {
        this.socket = io();
        this.currentGame = localStorage.getItem('currentGame') || '10';
        this.cards = [];               // Array of user's cards for this game
        this.activeCardId = null;       // Currently selected card (if needed)
        this.markedNumbers = [];        // Global called numbers (same for all cards)
        this.calledNumbers = [];         // All called numbers from server
        this.gameState = {};
        this.userId = null;
        
        this.init();
    }
    
    async init() {
        const tg = window.Telegram.WebApp;
        this.userId = tg.initDataUnsafe.user?.id;
        
        if (!this.userId) {
            console.warn('⚠️ No Telegram user ID – balance will not be fetched');
            document.getElementById('balance').textContent = '⚠️ Not in Telegram';
        } else {
            console.log('✅ User ID:', this.userId);
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
        
        // Join game room
        this.socket.emit('join_game', this.currentGame);
        
        // Load game state (called numbers, etc.)
        await this.loadGameState();
        
        // Load user's cards for this game
        await this.loadUserCards();
        
        // Render all cards
        this.renderCards();
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
            const res = await fetch(`/api/user-balance/${this.userId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            balanceEl.textContent = `$${data.balance}`;
        } catch (err) {
            console.error('❌ Error loading balance:', err);
            balanceEl.textContent = '⚠️ Error';
        }
    }
    
    async loadGameState() {
        try {
            const res = await fetch('/api/game-state');
            const state = await res.json();
            this.updateGameState(state);
        } catch (err) {
            console.error('Error loading game state:', err);
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
            document.getElementById('gameStatus').className = `value ${game.status}`;
            if (game.lastNumber) {
                document.getElementById('lastNumber').textContent = game.lastNumber;
            }
            if (game.calledNumbers) {
                this.updateCalledNumbers(game.calledNumbers);
            }
        }
    }
    
    async loadUserCards() {
        if (!this.userId) return;
        try {
            const res = await fetch(`/api/user-cards/${this.userId}`);
            if (!res.ok) throw new Error('Failed to fetch cards');
            const allCards = await res.json();
            // Filter cards for the current game
            this.cards = allCards.filter(c => c.gameId === this.currentGame);
            
            // For each card, parse the stored cardData and compute initially marked numbers
            this.cards = this.cards.map(c => {
                const cardData = JSON.parse(c.cardData);
                const numbers = cardData.numbers || cardData.rows || [];
                // Mark numbers that have already been called
                const marked = this.calledNumbers.filter(num => 
                    this.isNumberOnCard(num, cardData)
                );
                return {
                    ...c,
                    cardData,
                    markedNumbers: marked
                };
            });
            
            if (this.cards.length > 0) {
                this.activeCardId = this.cards[0].id; // default to first card
            }
        } catch (err) {
            console.error('Error loading user cards:', err);
        }
    }
    
    isNumberOnCard(number, cardData) {
        // Helper to check if a number exists on a given card
        if (cardData.type === 'bingo') {
            return cardData.numbers.flat().includes(number);
        } else if (cardData.type === 'bin50') {
            return cardData.rows.some(row => 
                row.some(n => parseInt(n) === number)
            );
        } else if (cardData.type === 'special') {
            return cardData.numbers?.includes(number);
        }
        return false;
    }
    
    handleNumberCalled(number) {
        this.calledNumbers.push(number);
        document.getElementById('lastNumber').textContent = number;
        
        // Mark this number on all cards that contain it
        this.cards.forEach(card => {
            if (this.isNumberOnCard(number, card.cardData)) {
                if (!card.markedNumbers.includes(number)) {
                    card.markedNumbers.push(number);
                }
            }
        });
        
        // Re-render all cards to show updated marks
        this.renderCards();
    }
    
    updateCalledNumbers(numbers) {
        this.calledNumbers = numbers;
        const container = document.getElementById('calledNumbers');
        const maxDisplay = 20;
        const recentNumbers = numbers.slice(-maxDisplay);
        container.innerHTML = recentNumbers.map(num => 
            `<span class="number called">${num}</span>`
        ).join('');
        document.getElementById('calledCount').textContent = 
            `${numbers.length}/${this.currentGame === '1000' ? 90 : 75}`;
    }
    
    renderCards() {
        const container = document.getElementById('cardsContainer');
        if (!container) return;
        
        if (this.cards.length === 0) {
            container.innerHTML = '<div class="no-cards">No cards for this game. <a href="select-card.html">Buy one</a>.</div>';
            return;
        }
        
        let html = '<div class="cards-grid">';
        this.cards.forEach(card => {
            html += `<div class="card-wrapper" data-card-id="${card.id}">`;
            html += `<div class="card-header-mini">Card #${card.cardNumber}</div>`;
            // Render card based on type
            if (card.cardData.type === 'bingo') {
                html += this.renderBingoCardHTML(card);
            } else if (card.cardData.type === 'bin50') {
                html += this.renderBinCardHTML(card);
            } else if (card.cardData.type === 'special') {
                html += this.renderSpecialCardHTML(card);
            }
            html += '</div>';
        });
        html += '</div>';
        container.innerHTML = html;
    }
    
    renderBingoCardHTML(card) {
        const numbers = card.cardData.numbers;
        let html = '<div class="bingo-card mini">';
        html += '<div class="bingo-header"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span></div>';
        for (let i = 0; i < 5; i++) {
            html += '<div class="bingo-row">';
            for (let j = 0; j < 5; j++) {
                const num = numbers[i][j];
                if (i === 2 && j === 2) {
                    html += '<span class="number free">★</span>';
                } else {
                    const isMarked = card.markedNumbers.includes(num) ? 'marked' : '';
                    html += `<span class="number bingo-number ${isMarked}">${num}</span>`;
                }
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    }
    
    renderBinCardHTML(card) {
        const rows = card.cardData.rows;
        let html = '<div class="bin-card mini">';
        rows.forEach(row => {
            const isMarked = row.every(num => 
                isNaN(parseInt(num)) || card.markedNumbers.includes(parseInt(num))
            ) ? 'marked' : '';
            html += `<div class="bin-row ${isMarked}">${row.join(' ')}</div>`;
        });
        html += '</div>';
        return html;
    }
    
    renderSpecialCardHTML(card) {
        const numbers = card.cardData.numbers;
        let html = '<div class="special-card mini"><div class="numbers-grid">';
        numbers.forEach(num => {
            const isMarked = card.markedNumbers.includes(num) ? 'marked' : '';
            html += `<span class="special-number ${isMarked}">${num}</span>`;
        });
        html += '</div></div>';
        return html;
    }
    
    async checkBingo() {
        if (this.cards.length === 0) {
            this.showNotification('Buy a card first!', 'error');
            return;
        }
        
        // Check all cards for a win
        let winningCard = null;
        for (const card of this.cards) {
            if (this.validateCardBingo(card)) {
                winningCard = card;
                break;
            }
        }
        
        if (!winningCard) {
            this.showNotification('No bingo yet! Keep playing.', 'info');
            return;
        }
        
        const tg = window.Telegram.WebApp;
        tg.sendData(JSON.stringify({
            type: 'BINGO',
            gameId: this.currentGame,
            cardId: winningCard.id,
            markedNumbers: winningCard.markedNumbers
        }));
        
        this.showNotification('BINGO claimed! Verifying...', 'info');
        document.getElementById('bingoBtn').classList.add('claimed');
        setTimeout(() => {
            document.getElementById('bingoBtn').classList.remove('claimed');
        }, 2000);
    }
    
    validateCardBingo(card) {
        // Use the same logic as gameEngine but with calledNumbers
        if (card.cardData.type === 'bingo') {
            return this.checkTraditionalBingo(card.cardData.numbers, this.calledNumbers);
        } else if (card.cardData.type === 'bin50') {
            return this.checkBinBingo(card.cardData.rows, this.calledNumbers);
        } else if (card.cardData.type === 'special') {
            return this.checkSpecialBingo(card.cardData.numbers, this.calledNumbers);
        }
        return false;
    }
    
    checkTraditionalBingo(cardNumbers, called) {
        // (same as in gameEngine)
        for (let i = 0; i < 5; i++) {
            let count = 0;
            for (let j = 0; j < 5; j++) {
                const num = cardNumbers[i][j];
                if (i === 2 && j === 2) count++;
                else if (num && called.includes(parseInt(num))) count++;
            }
            if (count === 5) return true;
        }
        for (let j = 0; j < 5; j++) {
            let count = 0;
            for (let i = 0; i < 5; i++) {
                const num = cardNumbers[i][j];
                if (i === 2 && j === 2) count++;
                else if (num && called.includes(parseInt(num))) count++;
            }
            if (count === 5) return true;
        }
        let diag1 = 0, diag2 = 0;
        for (let i = 0; i < 5; i++) {
            const num1 = cardNumbers[i][i];
            const num2 = cardNumbers[i][4 - i];
            if (i === 2 && i === 2) { diag1++; diag2++; }
            else {
                if (num1 && called.includes(parseInt(num1))) diag1++;
                if (num2 && called.includes(parseInt(num2))) diag2++;
            }
        }
        return diag1 === 5 || diag2 === 5;
    }
    
    checkBinBingo(rows, called) {
        for (const row of rows) {
            const rowNumbers = row.filter(n => !isNaN(parseInt(n))).map(n => parseInt(n));
            const allMatched = rowNumbers.every(num => called.includes(num));
            if (allMatched) return true;
        }
        return false;
    }
    
    checkSpecialBingo(numbers, called) {
        const markedCount = numbers.filter(num => called.includes(num)).length;
        return markedCount >= Math.floor(numbers.length * 0.8);
    }
    
    showNotification(message, type) {
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        notif.textContent = message;
        document.body.appendChild(notif);
        setTimeout(() => notif.remove(), 3000);
    }
}

// Global
let game;
window.onload = () => { game = new BingoGame(); };
window.switchGame = (gameId) => {
    if (game) {
        game.socket.emit('leave_game', game.currentGame);
        game.currentGame = gameId;
        localStorage.setItem('currentGame', gameId);
        game.socket.emit('join_game', gameId);
        game.loadGameState();
        game.loadUserCards().then(() => game.renderCards());
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.game === gameId) btn.classList.add('active');
        });
    }
};
window.checkBingo = () => game?.checkBingo();