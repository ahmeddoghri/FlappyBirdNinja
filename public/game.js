class FlappySlice {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.socket = io();
        
        // Game state
        this.gameState = 'menu'; // menu, playing, gameOver
        this.isMultiplayer = false;
        this.roomId = null;
        this.playerId = null;
        
        // Player properties
        this.player = {
            x: 150,
            y: 300,
            width: 40,
            height: 30,
            velocityY: 0,
            gravity: 0.5,
            jumpPower: -8,
            color: '#FFD700'
        };
        
        // Game objects
        this.fruits = [];
        this.particles = [];
        this.opponents = {};
        
        // Game mechanics
        this.score = 0;
        this.combo = 0;
        this.bestCombo = 0;
        this.sliceMode = false;
        this.sliceModeTimer = 0;
        this.lastFruitSpawn = 0;
        this.gameSpeed = 2;
        
        // Input handling
        this.keys = {};
        this.mouse = { x: 0, y: 0, down: false, trail: [] };
        
        this.initializeEventListeners();
        this.initializeSocketEvents();
        this.gameLoop();
    }
    
    initializeEventListeners() {
        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Space' && this.gameState === 'playing') {
                e.preventDefault();
                this.jump();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
        
        // Mouse controls for slicing
        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
            this.mouse.down = true;
            this.mouse.trail = [{x: this.mouse.x, y: this.mouse.y}];
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
            
            if (this.mouse.down) {
                this.mouse.trail.push({x: this.mouse.x, y: this.mouse.y});
                if (this.mouse.trail.length > 10) {
                    this.mouse.trail.shift();
                }
                this.checkSlice();
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            this.mouse.down = false;
            this.mouse.trail = [];
        });
        
        // Touch controls
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            this.mouse.x = touch.clientX - rect.left;
            this.mouse.y = touch.clientY - rect.top;
            this.mouse.down = true;
            this.mouse.trail = [{x: this.mouse.x, y: this.mouse.y}];
        });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            this.mouse.x = touch.clientX - rect.left;
            this.mouse.y = touch.clientY - rect.top;
            
            this.mouse.trail.push({x: this.mouse.x, y: this.mouse.y});
            if (this.mouse.trail.length > 10) {
                this.mouse.trail.shift();
            }
            this.checkSlice();
        });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.mouse.down = false;
            this.mouse.trail = [];
        });
    }
    
    initializeSocketEvents() {
        this.socket.on('connect', () => {
            this.playerId = this.socket.id;
        });
        
        this.socket.on('roomCreated', (data) => {
            this.roomId = data.roomId;
            this.isMultiplayer = true;
            this.showRoomInfo();
        });
        
        this.socket.on('roomJoined', (data) => {
            this.roomId = data.roomId;
            this.isMultiplayer = true;
            this.showRoomInfo();
        });
        
        this.socket.on('playerJoined', (data) => {
            this.updatePlayerCount(data.playerCount);
        });
        
        this.socket.on('playerLeft', (data) => {
            this.updatePlayerCount(data.playerCount);
            delete this.opponents[data.playerId];
        });
        
        this.socket.on('gameState', (data) => {
            this.opponents = data.opponents || {};
        });
        
        this.socket.on('opponentUpdate', (data) => {
            this.opponents[data.playerId] = data.player;
        });
        
        this.socket.on('roomError', (error) => {
            alert(error.message);
        });
    }
    
    jump() {
        if (this.gameState === 'playing') {
            this.player.velocityY = this.player.jumpPower;
            this.createParticles(this.player.x, this.player.y + this.player.height, '#87CEEB', 5);
        }
    }
    
    checkSlice() {
        if (this.mouse.trail.length < 2) return;
        
        this.fruits.forEach((fruit, index) => {
            if (fruit.sliced) return;
            
            // Check if slice trail intersects with fruit
            for (let i = 0; i < this.mouse.trail.length - 1; i++) {
                const p1 = this.mouse.trail[i];
                const p2 = this.mouse.trail[i + 1];
                
                if (this.lineIntersectsCircle(p1, p2, fruit)) {
                    this.sliceFruit(fruit, index);
                    break;
                }
            }
        });
    }
    
    lineIntersectsCircle(p1, p2, circle) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const fx = p1.x - circle.x;
        const fy = p1.y - circle.y;
        
        const a = dx * dx + dy * dy;
        const b = 2 * (fx * dx + fy * dy);
        const c = (fx * fx + fy * fy) - circle.radius * circle.radius;
        
        const discriminant = b * b - 4 * a * c;
        
        if (discriminant < 0) return false;
        
        const discriminantSqrt = Math.sqrt(discriminant);
        const t1 = (-b - discriminantSqrt) / (2 * a);
        const t2 = (-b + discriminantSqrt) / (2 * a);
        
        return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
    }
    
    sliceFruit(fruit, index) {
        fruit.sliced = true;
        
        // Calculate score based on fruit type and combo
        let points = fruit.type === 'bonus' ? 50 : 10;
        if (this.combo > 0) {
            points += this.combo * 2;
        }
        
        this.score += points;
        this.combo++;
        
        if (this.combo > this.bestCombo) {
            this.bestCombo = this.combo;
        }
        
        // Special effects based on fruit type
        if (fruit.type === 'bonus') {
            this.sliceMode = true;
            this.sliceModeTimer = 300; // 5 seconds at 60fps
            this.gameSpeed = Math.min(this.gameSpeed + 0.2, 5);
        }
        
        // Create slice particles
        this.createParticles(fruit.x, fruit.y, fruit.color, 8);
        
        // Show combo if > 1
        if (this.combo > 1) {
            this.showCombo();
        }
        
        // Send update to multiplayer
        if (this.isMultiplayer) {
            this.socket.emit('playerUpdate', {
                roomId: this.roomId,
                score: this.score,
                combo: this.combo,
                player: this.player
            });
        }
        
        // Remove fruit after a delay for visual effect
        setTimeout(() => {
            this.fruits.splice(index, 1);
        }, 100);
    }
    
    createParticles(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: x,
                y: y,
                vx: (Math.random() - 0.5) * 8,
                vy: (Math.random() - 0.5) * 8,
                color: color,
                life: 60,
                maxLife: 60
            });
        }
    }
    
    showCombo() {
        const comboDisplay = document.getElementById('comboDisplay');
        comboDisplay.textContent = `${this.combo}x COMBO!`;
        comboDisplay.style.display = 'block';
        
        setTimeout(() => {
            comboDisplay.style.display = 'none';
        }, 1000);
    }
    
    spawnFruit() {
        const now = Date.now();
        if (now - this.lastFruitSpawn > 1000 / this.gameSpeed) {
            const types = ['apple', 'orange', 'banana', 'bonus'];
            const type = types[Math.floor(Math.random() * types.length)];
            
            this.fruits.push({
                x: this.canvas.width + 50,
                y: Math.random() * (this.canvas.height - 100) + 50,
                radius: type === 'bonus' ? 25 : 20,
                velocityX: -this.gameSpeed,
                velocityY: (Math.random() - 0.5) * 2,
                color: this.getFruitColor(type),
                type: type,
                sliced: false,
                rotation: 0
            });
            
            this.lastFruitSpawn = now;
        }
    }
    
    getFruitColor(type) {
        const colors = {
            apple: '#FF4444',
            orange: '#FF8844',
            banana: '#FFDD44',
            bonus: '#FF44FF'
        };
        return colors[type] || '#44FF44';
    }
    
    update() {
        if (this.gameState !== 'playing') return;
        
        // Update player physics
        this.player.velocityY += this.player.gravity;
        this.player.y += this.player.velocityY;
        
        // Boundary checks
        if (this.player.y < 0) {
            this.player.y = 0;
            this.player.velocityY = 0;
        }
        if (this.player.y + this.player.height > this.canvas.height) {
            this.gameOver();
        }
        
        // Update fruits
        this.fruits.forEach((fruit, index) => {
            fruit.x += fruit.velocityX;
            fruit.y += fruit.velocityY;
            fruit.rotation += 0.1;
            
            // Remove fruits that are off screen
            if (fruit.x < -fruit.radius * 2) {
                this.fruits.splice(index, 1);
                // Lose combo if fruit escapes
                if (!fruit.sliced) {
                    this.combo = 0;
                }
            }
        });
        
        // Update particles
        this.particles.forEach((particle, index) => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += 0.3; // gravity
            particle.life--;
            
            if (particle.life <= 0) {
                this.particles.splice(index, 1);
            }
        });
        
        // Update slice mode
        if (this.sliceMode) {
            this.sliceModeTimer--;
            if (this.sliceModeTimer <= 0) {
                this.sliceMode = false;
            }
        }
        
        // Spawn new fruits
        this.spawnFruit();
        
        // Update UI
        this.updateUI();
    }
    
    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw background
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(1, '#98FB98');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (this.gameState === 'playing') {
            // Draw player
            this.drawPlayer(this.player, this.player.color);
            
            // Draw opponents
            Object.values(this.opponents).forEach(opponent => {
                this.drawPlayer(opponent, '#FF6B6B');
            });
            
            // Draw fruits
            this.fruits.forEach(fruit => {
                this.drawFruit(fruit);
            });
            
            // Draw particles
            this.particles.forEach(particle => {
                this.drawParticle(particle);
            });
            
            // Draw slice trail
            if (this.mouse.trail.length > 1) {
                this.drawSliceTrail();
            }
            
            // Draw slice mode indicator
            if (this.sliceMode) {
                this.ctx.fillStyle = 'rgba(255, 0, 255, 0.3)';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }
        
        // Draw menu
        if (this.gameState === 'menu') {
            this.drawMenu();
        }
    }
    
    drawPlayer(player, color) {
        this.ctx.save();
        this.ctx.translate(player.x + player.width/2, player.y + player.height/2);
        this.ctx.rotate(player.velocityY * 0.1);
        
        // Draw bird body
        this.ctx.fillStyle = color;
        this.ctx.fillRect(-player.width/2, -player.height/2, player.width, player.height);
        
        // Draw wing
        this.ctx.fillStyle = '#FFB347';
        this.ctx.fillRect(-player.width/4, -player.height/4, player.width/2, player.height/4);
        
        // Draw eye
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(player.width/4 - player.width/2, -player.height/8, 4, 4);
        
        this.ctx.restore();
    }
    
    drawFruit(fruit) {
        this.ctx.save();
        this.ctx.translate(fruit.x, fruit.y);
        this.ctx.rotate(fruit.rotation);
        
        if (fruit.sliced) {
            this.ctx.globalAlpha = 0.3;
        }
        
        // Draw fruit
        this.ctx.fillStyle = fruit.color;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, fruit.radius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Draw fruit shine
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.beginPath();
        this.ctx.arc(-fruit.radius/3, -fruit.radius/3, fruit.radius/3, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.restore();
    }
    
    drawParticle(particle) {
        this.ctx.save();
        this.ctx.globalAlpha = particle.life / particle.maxLife;
        this.ctx.fillStyle = particle.color;
        this.ctx.fillRect(particle.x, particle.y, 3, 3);
        this.ctx.restore();
    }
    
    drawSliceTrail() {
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = '#FFD700';
        
        this.ctx.beginPath();
        this.ctx.moveTo(this.mouse.trail[0].x, this.mouse.trail[0].y);
        
        for (let i = 1; i < this.mouse.trail.length; i++) {
            this.ctx.lineTo(this.mouse.trail[i].x, this.mouse.trail[i].y);
        }
        
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }
    
    drawMenu() {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.fillStyle = '#FFD700';
        this.ctx.font = '48px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Flappy Slice', this.canvas.width/2, this.canvas.height/2 - 50);
        
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = '24px Arial';
        this.ctx.fillText('Press SPACE to flap, slice fruits with mouse!', this.canvas.width/2, this.canvas.height/2 + 50);
    }
    
    updateUI() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('combo').textContent = this.combo;
        document.getElementById('sliceMode').style.display = this.sliceMode ? 'block' : 'none';
    }
    
    gameLoop() {
        this.update();
        this.render();
        requestAnimationFrame(() => this.gameLoop());
    }
    
    startSinglePlayer() {
        this.isMultiplayer = false;
        this.gameState = 'playing';
        this.resetGame();
        this.hideModeSelection();
    }
    
    resetGame() {
        this.player.y = 300;
        this.player.velocityY = 0;
        this.score = 0;
        this.combo = 0;
        this.sliceMode = false;
        this.sliceModeTimer = 0;
        this.gameSpeed = 2;
        this.fruits = [];
        this.particles = [];
        this.lastFruitSpawn = 0;
        document.getElementById('gameOver').style.display = 'none';
    }
    
    gameOver() {
        this.gameState = 'gameOver';
        document.getElementById('finalScore').textContent = this.score;
        document.getElementById('bestCombo').textContent = this.bestCombo;
        document.getElementById('gameOver').style.display = 'block';
    }
    
    hideModeSelection() {
        document.getElementById('singlePlayerMode').style.display = 'none';
        document.getElementById('multiplayerOptions').style.display = 'none';
    }
    
    showRoomInfo() {
        document.getElementById('multiplayerOptions').style.display = 'none';
        document.getElementById('roomInfo').style.display = 'block';
        document.getElementById('currentRoom').textContent = this.roomId;
        this.gameState = 'playing';
        this.resetGame();
    }
    
    updatePlayerCount(count) {
        document.getElementById('playerCount').textContent = count;
    }
}

// Global functions for HTML buttons
function startSinglePlayer() {
    window.game.startSinglePlayer();
}

function showMultiplayerOptions() {
    document.getElementById('singlePlayerMode').style.display = 'none';
    document.getElementById('multiplayerOptions').style.display = 'block';
}

function showSinglePlayerMode() {
    document.getElementById('multiplayerOptions').style.display = 'none';
    document.getElementById('singlePlayerMode').style.display = 'block';
}

function createRoom() {
    const roomName = document.getElementById('roomName').value.trim();
    const password = document.getElementById('roomPassword').value.trim();
    
    if (!roomName) {
        alert('Please enter a room name');
        return;
    }
    
    window.game.socket.emit('createRoom', { roomName, password });
}

function joinRoom() {
    const roomName = document.getElementById('roomName').value.trim();
    const password = document.getElementById('roomPassword').value.trim();
    
    if (!roomName) {
        alert('Please enter a room name');
        return;
    }
    
    window.game.socket.emit('joinRoom', { roomName, password });
}

function leaveRoom() {
    window.game.socket.emit('leaveRoom', { roomId: window.game.roomId });
    window.game.isMultiplayer = false;
    window.game.roomId = null;
    window.game.opponents = {};
    document.getElementById('roomInfo').style.display = 'none';
    document.getElementById('singlePlayerMode').style.display = 'block';
    window.game.gameState = 'menu';
}

function restartGame() {
    window.game.gameState = 'playing';
    window.game.resetGame();
}

// Initialize game when page loads
window.addEventListener('load', () => {
    window.game = new FlappySlice();
});