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
            gravity: 0.3, // Reduced from 0.5 to 0.3 for easier control
            jumpPower: -10, // Increased from -8 to -10 for stronger jumps
            color: '#FFD700'
        };
        
        // Game objects
        this.fruits = [];
        this.walls = [];
        this.particles = [];
        this.players = {};
        this.sliceEffects = [];
        this.deathEffects = [];
        this.powerUps = [];
        
        // Power-up system
        this.activePowerUps = new Map();
        this.powerUpCooldowns = new Map();
        
        // Audio system
        this.audioEnabled = localStorage.getItem('audioEnabled') !== 'false';
        this.initializeAudio();
        
        // Visual effects
        this.screenShake = { x: 0, y: 0, intensity: 0, duration: 0 };
        this.backgroundEffects = [];
        this.cameraZoom = 1.0;
        this.targetZoom = 1.0;
        
        // Dynamic difficulty
        this.difficultyLevel = 1;
        this.performanceMetrics = {
            deaths: 0,
            avgScore: 0,
            avgSurvival: 0,
            recentScores: [],
            recentSurvivalTimes: []
        };
        this.adaptiveDifficulty = true;
        
        // Game mechanics
        this.score = 0;
        this.combo = 0;
        this.bestCombo = 0;
        this.sliceMode = false;
        this.sliceModeTimer = 0;
        this.lastFruitSpawn = 0;
        this.lastWallSpawn = 0;
        this.baseGameSpeed = 2;
        this.gameSpeed = this.baseGameSpeed;
        this.isReady = false;
        this.lastPlayerUpdate = 0;
        
        // Daily Challenges & Progression
        this.dailyChallenges = this.loadDailyChallenges();
        this.playerStats = this.loadPlayerStats();
        this.currentStreak = this.playerStats.currentStreak || 0;
        this.longestStreak = this.playerStats.longestStreak || 0;
        this.experience = this.playerStats.experience || 0;
        this.level = Math.floor(this.experience / 100) + 1;
        
        // Character system
        this.unlockedCharacters = this.playerStats.unlockedCharacters || ['default'];
        this.currentCharacter = this.playerStats.currentCharacter || 'default';
        this.unlockedColors = this.playerStats.unlockedColors || ['#FFD700'];
        this.currentColor = this.playerStats.currentColor || '#FFD700';
        this.player.color = this.currentColor;
        
        // Achievement system
        this.achievements = this.loadAchievements();
        this.unlockedAchievements = this.playerStats.unlockedAchievements || [];
        
        // Input handling
        this.keys = {};
        this.mouse = { x: 0, y: 0, down: false, trail: [] };
        
        this.initializeEventListeners();
        this.initializeSocketEvents();
        this.initializeDailyChallenges();
        this.createAudioToggle();
        this.applyCharacterStats();
        this.gameLoop();
    }
    
    initializeEventListeners() {
        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Space') {
                e.preventDefault();
                if (this.gameState === 'playing') {
                    this.jump();
                } else if (this.gameState === 'gameOver') {
                    this.quickRestart();
                } else if (this.gameState === 'menu') {
                    this.startSinglePlayer();
                }
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
            // Show share URL
            this.showShareURL(data.gameUrl || `${window.location.origin}/room/${data.roomId}`);
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
            delete this.players[data.playerId];
        });
        
        this.socket.on('gameState', (data) => {
            this.players = data.players || {};
            if (data.fruits) {
                this.fruits = data.fruits;
            }
            if (data.walls) {
                this.walls = data.walls;
            }
        });
        
        this.socket.on('gameStarted', (data) => {
            this.gameState = 'playing';
            this.players = data.players || {};
            this.fruits = data.fruits || [];
            this.walls = data.walls || [];
            this.gameSpeed = data.gameSpeed || 2;
            this.resetGame();
        });
        
        this.socket.on('gameUpdate', (data) => {
            if (this.gameState === 'playing') {
                this.fruits = data.fruits || [];
                this.walls = data.walls || [];
            }
        });
        
        this.socket.on('playerMoved', (data) => {
            if (data.playerId !== this.playerId) {
                this.players[data.playerId] = {
                    player: data.player,
                    isAlive: data.isAlive,
                    score: data.score,
                    combo: data.combo
                };
            }
        });
        
        this.socket.on('playerJumped', (data) => {
            if (data.playerId !== this.playerId) {
                // Create jump particles for other players
                this.createParticles(
                    data.player.x, 
                    data.player.y + data.player.height, 
                    '#87CEEB', 
                    3
                );
            }
        });
        
        this.socket.on('fruitSliced', (data) => {
            // Find and mark fruit as sliced
            const fruitIndex = this.fruits.findIndex(f => f.id === data.fruitId);
            if (fruitIndex !== -1) {
                const fruit = this.fruits[fruitIndex];
                fruit.sliced = true;
                fruit.slicedBy = data.playerId;
                
                // Create slice effect
                this.createSliceEffect(fruit, data.sliceData);
                
                // Create particles for visual feedback
                this.createParticles(fruit.x, fruit.y, fruit.color, 8);
                
                // Update player score if it's not us
                if (data.playerId !== this.playerId && this.players[data.playerId]) {
                    this.players[data.playerId].score = data.newScore;
                    this.players[data.playerId].combo = data.newCombo;
                } else if (data.playerId === this.playerId) {
                    this.score = data.newScore;
                    this.combo = data.newCombo;
                    if (this.combo > this.bestCombo) {
                        this.bestCombo = this.combo;
                    }
                    if (this.combo > 1) {
                        this.showCombo();
                    }
                }
                
                // Remove the fruit after a short delay for visual effect
                setTimeout(() => {
                    const currentIndex = this.fruits.findIndex(f => f.id === data.fruitId);
                    if (currentIndex !== -1) {
                        this.fruits.splice(currentIndex, 1);
                    }
                }, 200);
            }
        });
        
        this.socket.on('playerDied', (data) => {
            // Handle player death
            if (data.playerId === this.playerId) {
                // Our player died
                this.player.isAlive = false;
                this.combo = 0;
            } else if (this.players[data.playerId]) {
                // Another player died
                this.players[data.playerId].isAlive = false;
                this.players[data.playerId].combo = 0;
            }
            
            // Create death effect
            this.createDeathEffect(data.x, data.y, data.cause);
        });
        
        this.socket.on('fruitBounce', (data) => {
            // Create bounce particles when fruit hits wall
            const color = this.getWallParticleColor(data.wallType);
            this.createParticles(data.x, data.y, color, 8);
        });
        
        this.socket.on('fruitPlayerBounce', (data) => {
            // Create particles when fruit bounces off player
            this.createParticles(data.x, data.y, '#FFD700', 6);
        });
        
        this.socket.on('playerReadyUpdate', (data) => {
            // Update ready state display
            this.updateReadyState(data);
        });
        
        this.socket.on('roomError', (error) => {
            alert(error.message);
        });
    }
    
    jump() {
        if (this.gameState === 'playing') {
            this.player.velocityY = this.player.jumpPower;
            this.createParticles(this.player.x, this.player.y + this.player.height, '#87CEEB', 5);
            
            // Audio and haptic feedback
            this.playJumpSound();
            this.vibrate([30]);
            
            // Send jump to server for multiplayer
            if (this.isMultiplayer) {
                this.socket.emit('playerJump', { roomId: this.roomId });
            }
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
        if (fruit.sliced) return;
        
        fruit.sliced = true;
        
        // Create slice particles
        this.createParticles(fruit.x, fruit.y, fruit.color, 8);
        
        // Send slice to server for multiplayer
        if (this.isMultiplayer) {
            this.socket.emit('sliceFruit', {
                roomId: this.roomId,
                fruitId: fruit.id,
                sliceData: {
                    x: fruit.x,
                    y: fruit.y,
                    trail: [...this.mouse.trail]
                }
            });
        } else {
            // Single player scoring
            let points = fruit.type === 'bonus' ? 50 : 10;
            if (this.combo > 0) {
                points += this.combo * 2;
            }
            
            // Apply power-up effects
            if (this.hasDoublePoints) {
                points *= 2;
            }
            
            if (this.hasSuperSlice) {
                points *= 1.5;
                // Super slice can slice multiple fruits
                this.createSuperSliceEffect(fruit.x, fruit.y);
            }
            
            this.score += points;
            this.combo++;
            this.fruitsSliced = (this.fruitsSliced || 0) + 1;
            
            if (this.combo > this.bestCombo) {
                this.bestCombo = this.combo;
            }
            
            // Audio feedback
            this.playSliceSound();
            if (this.combo > 1) {
                this.playComboSound(this.combo);
            }
            
            // Haptic feedback based on combo
            if (this.combo > 5) {
                this.vibrate([50, 30, 50]);
            } else {
                this.vibrate([40]);
            }
            
            // Visual effects based on combo
            if (this.combo > 5) {
                this.addScreenShake(3, 10);
                this.addZoomEffect(1.05, 15);
                this.createBackgroundEffect('burst', fruit.x, fruit.y, fruit.color);
            }
            
            // Create trail effect
            this.createTrailEffect(fruit.x, fruit.y, fruit.color);
            
            // Special effects based on fruit type
            if (fruit.type === 'bonus') {
                this.sliceMode = true;
                this.sliceModeTimer = 300;
                this.gameSpeed = Math.min(this.gameSpeed + 0.2, 5);
            }
            
            if (this.combo > 1) {
                this.showCombo();
            }
        }
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
                id: `fruit_${Date.now()}_${Math.random()}`,
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
    
    spawnWall() {
        const now = Date.now();
        if (now - this.lastWallSpawn > 4000) { // Every 4 seconds
            const gapSize = 220; // Much larger gap for easier gameplay
            const wallWidth = 40; // Thinner walls
            const canvasHeight = this.canvas.height;
            const gapY = Math.random() * (canvasHeight - gapSize - 120) + 60;
            
            // Choose random wall type for variety
            const wallTypes = ['crystal', 'tech', 'nature', 'neon'];
            const wallType = wallTypes[Math.floor(Math.random() * wallTypes.length)];
            
            this.walls.push({
                id: `wall_${Date.now()}_${Math.random()}`,
                x: this.canvas.width + 50,
                width: wallWidth,
                topHeight: gapY,
                bottomY: gapY + gapSize,
                bottomHeight: canvasHeight - (gapY + gapSize),
                velocityX: -this.gameSpeed,
                spawnTime: now,
                type: wallType
            });
            
            this.lastWallSpawn = now;
        }
    }
    
    checkWallCollision(bird, wall) {
        const birdLeft = bird.x;
        const birdRight = bird.x + bird.width;
        const birdTop = bird.y;
        const birdBottom = bird.y + bird.height;
        
        const wallLeft = wall.x;
        const wallRight = wall.x + wall.width;
        
        // Check if bird is within wall's x range
        if (birdRight > wallLeft && birdLeft < wallRight) {
            // Check collision with top wall
            if (birdTop < wall.topHeight) {
                return true;
            }
            // Check collision with bottom wall
            if (birdBottom > wall.bottomY) {
                return true;
            }
        }
        
        return false;
    }
    
    checkFruitWallCollision(fruit, wall) {
        const fruitLeft = fruit.x - fruit.radius;
        const fruitRight = fruit.x + fruit.radius;
        const fruitTop = fruit.y - fruit.radius;
        const fruitBottom = fruit.y + fruit.radius;
        
        const wallLeft = wall.x;
        const wallRight = wall.x + wall.width;
        
        // Check if fruit is within wall's x range
        if (fruitRight > wallLeft && fruitLeft < wallRight) {
            // Check collision with top wall part
            if (fruitTop < wall.topHeight) {
                return true;
            }
            // Check collision with bottom wall part
            if (fruitBottom > wall.bottomY) {
                return true;
            }
        }
        
        return false;
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
        this.player.velocityY *= 0.98; // Add slight air resistance for smoother control
        this.player.y += this.player.velocityY;
        
        // Boundary checks
        if (this.player.y < 0) {
            this.player.y = 0;
            this.player.velocityY = 0;
        }
        if (this.player.y + this.player.height > this.canvas.height) {
            if (this.isMultiplayer) {
                // In multiplayer, just mark as dead but don't end game
                this.player.isAlive = false;
            } else {
                this.gameOver();
            }
        }
        
        // Send player update to server (throttled)
        if (this.isMultiplayer && Date.now() - this.lastPlayerUpdate > 16) { // ~60fps
            this.socket.emit('playerUpdate', {
                roomId: this.roomId,
                player: {
                    x: this.player.x,
                    y: this.player.y,
                    velocityY: this.player.velocityY,
                    width: this.player.width,
                    height: this.player.height
                }
            });
            this.lastPlayerUpdate = Date.now();
        }
        
        // Update power-ups
        this.updatePowerUps();
        this.checkPowerUpCollection();
        
        // Update visual effects
        this.updateScreenShake();
        this.updateZoomEffect();
        this.updateBackgroundEffects();
        
        // Update fruits and walls (only in single player, multiplayer gets from server)
        if (!this.isMultiplayer) {
            // Update fruits
            this.fruits.forEach((fruit, index) => {
                const oldX = fruit.x;
                const oldY = fruit.y;
                
                fruit.x += fruit.velocityX;
                fruit.y += fruit.velocityY;
                fruit.rotation += fruit.rotationSpeed || 0.1;
                
                // Apply gravity to fruits
                fruit.velocityY += 0.2;
                
                // Check collision with walls - enhanced physics
                this.walls.forEach(wall => {
                    if (this.checkFruitWallCollision(fruit, wall)) {
                        const collisionAngle = this.calculateCollisionAngle(fruit, wall, oldX, oldY);
                        
                        if (Math.abs(collisionAngle) < Math.PI/4 || Math.abs(collisionAngle) > 3*Math.PI/4) {
                            // Horizontal collision with angle variation
                            fruit.velocityX = -fruit.velocityX * 0.8;
                            fruit.velocityY += (Math.random() - 0.5) * 2;
                            fruit.x = oldX;
                        } else {
                            // Vertical collision with angle variation
                            fruit.velocityY = -fruit.velocityY * 0.8;
                            fruit.velocityX += (Math.random() - 0.5) * 1;
                            fruit.y = oldY;
                        }
                        
                        // Add rotational spin
                        fruit.rotationSpeed = (Math.random() - 0.5) * 0.4;
                        
                        // Create particles based on wall type
                        const particleColor = this.getWallParticleColor(wall.type);
                        this.createParticles(fruit.x, fruit.y, particleColor, 8);
                        this.playWallBounceSound();
                    }
                });
                
                // Check fruit collision with player for deflection
                if (this.checkCircleRectCollision(fruit, this.player)) {
                    const dx = fruit.x - (this.player.x + this.player.width/2);
                    const dy = fruit.y - (this.player.y + this.player.height/2);
                    const distance = Math.sqrt(dx*dx + dy*dy);
                    
                    if (distance > 0) {
                        const normalX = dx / distance;
                        const normalY = dy / distance;
                        
                        // Deflect fruit away from player
                        fruit.velocityX = normalX * 4 + fruit.velocityX * 0.3;
                        fruit.velocityY = normalY * 4 + fruit.velocityY * 0.3;
                        
                        // Slightly deflect player trajectory
                        this.player.velocityY += normalY * 0.5;
                        
                        // Create deflection particles
                        this.createParticles(fruit.x, fruit.y, '#FFD700', 6);
                    }
                }
                
                // Bounce off screen boundaries
                if (fruit.y - fruit.radius < 0) {
                    fruit.y = fruit.radius;
                    fruit.velocityY = Math.abs(fruit.velocityY) * 0.8;
                }
                if (fruit.y + fruit.radius > this.canvas.height) {
                    fruit.y = this.canvas.height - fruit.radius;
                    fruit.velocityY = -Math.abs(fruit.velocityY) * 0.8;
                }
                
                // Remove fruits that are off screen
                if (fruit.x < -fruit.radius * 2) {
                    this.fruits.splice(index, 1);
                    // Lose combo if fruit escapes
                    if (!fruit.sliced) {
                        this.combo = 0;
                        this.missedFruits = (this.missedFruits || 0) + 1;
                    }
                }
            });
            
            // Update walls
            this.walls = this.walls.filter(wall => {
                const oldX = wall.x;
                wall.x += wall.velocityX;
                
                // Check if player passed through wall
                if (oldX > this.player.x + this.player.width && wall.x <= this.player.x + this.player.width) {
                    this.wallsPassed = (this.wallsPassed || 0) + 1;
                }
                
                return wall.x > -wall.width;
            });
            
            // Check wall collisions for player
            this.walls.forEach(wall => {
                if (this.checkWallCollision(this.player, wall)) {
                    if (this.player.hasShield) {
                        // Shield protects player
                        this.player.hasShield = false;
                        this.activePowerUps.delete('shield');
                        this.createShieldBreakEffect(this.player.x, this.player.y);
                        // Push player away from wall
                        this.player.velocityY = -5;
                    } else {
                        this.createDeathEffect(this.player.x, this.player.y, 'wall');
                        this.playDeathSound();
                        this.vibrate([200, 100, 200]);
                        this.addScreenShake(15, 30);
                        this.createBackgroundEffect('explosion', this.player.x, this.player.y, '#FF4444');
                        this.gameOver();
                    }
                }
            });
            
            // Spawn new fruits, walls, and power-ups
            this.spawnFruit();
            this.spawnWall();
            this.spawnPowerUp();
        }
        
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
        
        // Update slice effects
        this.sliceEffects = this.sliceEffects.filter(effect => {
            effect.life--;
            return effect.life > 0;
        });
        
        // Update death effects
        this.deathEffects = this.deathEffects.filter(effect => {
            effect.life--;
            return effect.life > 0;
        });
        
        // Update slice mode
        if (this.sliceMode) {
            this.sliceModeTimer--;
            if (this.sliceModeTimer <= 0) {
                this.sliceMode = false;
            }
        }
        
        // Update UI
        this.updateUI();
    }
    
    render() {
        // Apply screen shake and zoom effects
        this.ctx.save();
        this.ctx.translate(
            this.canvas.width/2 + this.screenShake.x,
            this.canvas.height/2 + this.screenShake.y
        );
        this.ctx.scale(this.cameraZoom, this.cameraZoom);
        this.ctx.translate(-this.canvas.width/2, -this.canvas.height/2);
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw background
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(1, '#98FB98');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (this.gameState === 'playing') {
            // Draw player (with death state)
            const playerColor = (this.player.isAlive !== false) ? this.player.color : '#666666';
            this.drawPlayer(this.player, playerColor);
            
            // Draw other players
            Object.entries(this.players).forEach(([playerId, playerData]) => {
                if (playerId !== this.playerId && playerData.player) {
                    const color = (playerData.isAlive !== false) ? (playerData.player.color || '#FF6B6B') : '#666666';
                    this.drawPlayer(playerData.player, color);
                    
                    // Draw player info
                    this.drawPlayerInfo(playerData, playerId);
                }
            });
            
            // Draw slice effects
            this.sliceEffects.forEach(effect => {
                this.drawSliceEffect(effect);
            });
            
            // Draw walls
            this.walls.forEach(wall => {
                this.drawWall(wall);
            });
            
            // Draw fruits
            this.fruits.forEach(fruit => {
                this.drawFruit(fruit);
            });
            
            // Draw power-ups
            this.powerUps.forEach(powerUp => {
                this.drawPowerUp(powerUp);
            });
            
            // Draw particles
            this.particles.forEach(particle => {
                this.drawParticle(particle);
            });
            
            // Draw death effects
            this.deathEffects.forEach(effect => {
                this.drawDeathEffect(effect);
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
            
            // Draw power-up effects
            this.drawPowerUpEffects();
            
            // Draw background effects
            this.backgroundEffects.forEach(effect => {
                this.drawBackgroundEffect(effect);
            });
        }
        
        // Draw menu
        if (this.gameState === 'menu') {
            this.drawMenu();
        }
        
        // Restore context
        this.ctx.restore();
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
        const alpha = particle.alpha || (particle.life / particle.maxLife);
        this.ctx.globalAlpha = alpha;
        
        // Enhanced particle rendering
        if (particle.size && particle.size > 1) {
            // Draw with glow effect
            this.ctx.shadowBlur = particle.size * 2;
            this.ctx.shadowColor = particle.color;
            this.ctx.fillStyle = particle.color;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.ctx.fill();
        } else {
            // Standard particle
            this.ctx.fillStyle = particle.color;
            this.ctx.fillRect(particle.x - 1, particle.y - 1, 3, 3);
        }
        
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
        document.getElementById('level').textContent = this.level;
        document.getElementById('streak').textContent = this.currentStreak;
        document.getElementById('difficulty').textContent = this.getDifficultyDescription();
        document.getElementById('sliceMode').style.display = this.sliceMode ? 'block' : 'none';
        
        // Update active power-ups display
        const powerUpsDiv = document.getElementById('activePowerUps');
        if (powerUpsDiv) {
            powerUpsDiv.innerHTML = '';
            
            for (const [type, endTime] of this.activePowerUps.entries()) {
                const timeLeft = Math.max(0, endTime - Date.now());
                const seconds = Math.ceil(timeLeft / 1000);
                
                if (seconds > 0) {
                    const powerUpElement = document.createElement('div');
                    powerUpElement.style.cssText = `
                        font-size: 10px;
                        background: rgba(255,255,255,0.2);
                        padding: 2px 6px;
                        border-radius: 10px;
                        margin: 2px 0;
                        display: inline-block;
                        margin-right: 5px;
                    `;
                    
                    let icon = '?';
                    let name = type;
                    switch(type) {
                        case 'slowMotion': icon = '⏱'; name = 'Slow'; break;
                        case 'magnet': icon = '🧲'; name = 'Magnet'; break;
                        case 'shield': icon = '🛡'; name = 'Shield'; break;
                        case 'doublePoints': icon = '2x'; name = '2x Pts'; break;
                        case 'superSlice': icon = '⚡'; name = 'Super'; break;
                    }
                    
                    powerUpElement.textContent = `${icon} ${name} ${seconds}s`;
                    powerUpsDiv.appendChild(powerUpElement);
                }
            }
        }
    }
    
    updateChallengesUI() {
        const challengesList = document.getElementById('challengesList');
        if (!challengesList) return;
        
        challengesList.innerHTML = '';
        
        this.dailyChallenges.forEach(challenge => {
            const div = document.createElement('div');
            div.className = `challenge-item ${challenge.completed ? 'challenge-completed' : ''}`;
            
            const progress = Math.min(challenge.progress / challenge.target * 100, 100);
            
            div.innerHTML = `
                <div>${challenge.completed ? '✓' : '🏆'} ${challenge.description}</div>
                <div style="font-size: 11px; color: #ccc; margin-top: 3px;">
                    ${challenge.progress}/${challenge.target} - ${challenge.reward} XP
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
            `;
            
            challengesList.appendChild(div);
        });
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
        this.baseGameSpeed = 2;
        this.gameSpeed = this.baseGameSpeed;
        this.fruits = [];
        this.walls = [];
        this.particles = [];
        this.sliceEffects = [];
        this.deathEffects = [];
        this.lastFruitSpawn = 0;
        this.lastWallSpawn = 0;
        this.player.isAlive = true;
        this.fruitsSliced = 0;
        this.gameStartTime = Date.now();
        this.powerUps = [];
        this.activePowerUps.clear();
        this.powerUpCooldowns.clear();
        this.resetVisualEffects();
        
        // Reset achievement tracking
        this.powerUpsCollected = 0;
        this.wallsPassed = 0;
        this.missedFruits = 0;
        
        document.getElementById('gameOver').style.display = 'none';
    }
    
    gameOver() {
        this.gameState = 'gameOver';
        
        // Calculate XP gained
        const baseXP = Math.floor(this.score / 10);
        const comboBonus = this.bestCombo * 2;
        const survivalTime = Math.floor((Date.now() - this.gameStartTime) / 1000);
        const survivalBonus = Math.floor(survivalTime / 10);
        const totalXP = baseXP + comboBonus + survivalBonus;
        
        // Update player stats
        this.playerStats.totalGamesPlayed++;
        this.playerStats.totalScore += this.score;
        const oldLevel = this.level;
        this.experience += totalXP;
        this.playerStats.experience = this.experience;
        this.level = Math.floor(this.experience / 100) + 1;
        
        // Check for new unlocks if level increased
        if (this.level > oldLevel) {
            this.checkUnlocks();
        }
        
        // Update challenge progress
        this.updateChallengeProgress('score', this.score);
        this.updateChallengeProgress('combo', this.bestCombo);
        this.updateChallengeProgress('fruits', this.fruitsSliced || 0);
        this.updateChallengeProgress('survival', survivalTime);
        
        // Record performance for adaptive difficulty
        this.recordGamePerformance(this.score, survivalTime);
        
        // Check achievements
        this.checkAchievements();
        
        this.savePlayerStats();
        
        // Update game over screen with smooth animation
        this.showGameOverScreen(totalXP, survivalTime);
    }
    
    showGameOverScreen(xpGained, survivalTime) {
        document.getElementById('finalScore').textContent = this.score;
        document.getElementById('bestCombo').textContent = this.bestCombo;
        document.getElementById('xpGained').textContent = xpGained;
        
        // Show detailed stats
        const statsDiv = document.getElementById('gameOverStats');
        statsDiv.innerHTML = `
            <div>Survival Time: ${survivalTime}s</div>
            <div>Fruits Sliced: ${this.fruitsSliced || 0}</div>
            <div>Level: ${this.level} (${this.experience} XP)</div>
        `;
        
        // Smooth fade-in animation
        const gameOverDiv = document.getElementById('gameOver');
        gameOverDiv.style.opacity = '0';
        gameOverDiv.style.display = 'block';
        
        // Animate opacity
        let opacity = 0;
        const fadeIn = setInterval(() => {
            opacity += 0.05;
            gameOverDiv.style.opacity = opacity;
            if (opacity >= 1) {
                clearInterval(fadeIn);
            }
        }, 20);
    }
    
    quickRestart() {
        // Smooth transition to new game
        const gameOverDiv = document.getElementById('gameOver');
        let opacity = 1;
        
        const fadeOut = setInterval(() => {
            opacity -= 0.1;
            gameOverDiv.style.opacity = opacity;
            if (opacity <= 0) {
                clearInterval(fadeOut);
                gameOverDiv.style.display = 'none';
                this.gameState = 'playing';
                this.resetGame();
            }
        }, 30);
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
    
    showRoomInfo() {
        document.getElementById('multiplayerOptions').style.display = 'none';
        document.getElementById('roomInfo').style.display = 'block';
        document.getElementById('currentRoom').textContent = this.roomId;
        
        // Show ready button
        this.showReadyButton();
    }
    
    showReadyButton() {
        const roomInfo = document.getElementById('roomInfo');
        let readyButton = document.getElementById('readyButton');
        
        if (!readyButton) {
            readyButton = document.createElement('button');
            readyButton.id = 'readyButton';
            readyButton.onclick = () => this.toggleReady();
            roomInfo.appendChild(readyButton);
        }
        
        readyButton.textContent = this.isReady ? 'Not Ready' : 'Ready';
        readyButton.className = this.isReady ? 'ready' : '';
    }
    
    toggleReady() {
        this.isReady = !this.isReady;
        this.socket.emit('playerReady', {
            roomId: this.roomId,
            isReady: this.isReady
        });
        this.showReadyButton();
    }
    
    updateReadyState(data) {
        // Update UI to show ready states
        if (data.allReady) {
            // Auto-start game when all players are ready
            this.socket.emit('startGame', { roomId: this.roomId });
        }
    }
    
    showShareURL(url) {
        const roomInfo = document.getElementById('roomInfo');
        let shareDiv = document.getElementById('shareURL');
        
        if (!shareDiv) {
            shareDiv = document.createElement('div');
            shareDiv.id = 'shareURL';
            shareDiv.innerHTML = `
                <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 5px;">
                    <div>Share this URL with friends:</div>
                    <input type="text" id="shareURLInput" readonly style="width: 100%; margin-top: 5px;" value="${url}">
                    <button onclick="copyShareURL()" style="margin-top: 5px;">Copy Link</button>
                </div>
            `;
            roomInfo.appendChild(shareDiv);
        }
        
        document.getElementById('shareURLInput').value = url;
    }
    
    createSliceEffect(fruit, sliceData) {
        this.sliceEffects.push({
            x: fruit.x,
            y: fruit.y,
            color: fruit.color,
            life: 30,
            maxLife: 30,
            trail: sliceData.trail || []
        });
    }
    
    drawSliceEffect(effect) {
        this.ctx.save();
        this.ctx.globalAlpha = effect.life / effect.maxLife;
        
        if (effect.trail && effect.trail.length > 1) {
            this.ctx.strokeStyle = effect.color;
            this.ctx.lineWidth = 2;
            this.ctx.lineCap = 'round';
            
            this.ctx.beginPath();
            this.ctx.moveTo(effect.trail[0].x, effect.trail[0].y);
            
            for (let i = 1; i < effect.trail.length; i++) {
                this.ctx.lineTo(effect.trail[i].x, effect.trail[i].y);
            }
            
            this.ctx.stroke();
        }
        
        this.ctx.restore();
    }
    
    drawPlayerInfo(playerData, playerId) {
        if (!playerData.player) return;
        
        const x = playerData.player.x;
        const y = playerData.player.y - 20;
        
        this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
        this.ctx.fillRect(x - 20, y - 15, 80, 12);
        
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = '10px Arial';
        this.ctx.fillText(`${playerData.score} (${playerData.combo}x)`, x - 15, y - 5);
    }
    
    drawWall(wall) {
        const wallType = wall.type || 'crystal';
        
        switch(wallType) {
            case 'crystal':
                this.drawCrystalWall(wall);
                break;
            case 'tech':
                this.drawTechWall(wall);
                break;
            case 'nature':
                this.drawNatureWall(wall);
                break;
            case 'neon':
                this.drawNeonWall(wall);
                break;
            default:
                this.drawCrystalWall(wall);
        }
    }
    
    drawCrystalWall(wall) {
        // Crystal/ice-like walls with geometric patterns
        const gradient = this.ctx.createLinearGradient(wall.x, 0, wall.x + wall.width, 0);
        gradient.addColorStop(0, '#B0E0E6');
        gradient.addColorStop(0.5, '#87CEEB');
        gradient.addColorStop(1, '#4682B4');
        
        this.ctx.fillStyle = gradient;
        
        // Draw top and bottom sections
        this.ctx.fillRect(wall.x, 0, wall.width, wall.topHeight);
        this.ctx.fillRect(wall.x, wall.bottomY, wall.width, wall.bottomHeight);
        
        // Add crystal facets
        this.ctx.strokeStyle = '#FFF';
        this.ctx.lineWidth = 2;
        
        // Top section facets
        for (let i = 0; i < wall.topHeight; i += 30) {
            this.ctx.beginPath();
            this.ctx.moveTo(wall.x, i);
            this.ctx.lineTo(wall.x + wall.width, i + 15);
            this.ctx.stroke();
        }
        
        // Bottom section facets
        for (let i = wall.bottomY; i < wall.bottomY + wall.bottomHeight; i += 30) {
            this.ctx.beginPath();
            this.ctx.moveTo(wall.x + wall.width, i);
            this.ctx.lineTo(wall.x, i + 15);
            this.ctx.stroke();
        }
        
        this.drawGapIndicator(wall, '#87CEEB');
    }
    
    drawTechWall(wall) {
        // Futuristic tech walls with circuit patterns
        const gradient = this.ctx.createLinearGradient(wall.x, 0, wall.x + wall.width, 0);
        gradient.addColorStop(0, '#2F4F4F');
        gradient.addColorStop(0.5, '#696969');
        gradient.addColorStop(1, '#1C1C1C');
        
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(wall.x, 0, wall.width, wall.topHeight);
        this.ctx.fillRect(wall.x, wall.bottomY, wall.width, wall.bottomHeight);
        
        // Add tech circuit lines
        this.ctx.strokeStyle = '#00FFFF';
        this.ctx.lineWidth = 1;
        
        // Circuit pattern
        for (let i = 0; i < wall.topHeight; i += 20) {
            this.ctx.beginPath();
            this.ctx.moveTo(wall.x + 5, i);
            this.ctx.lineTo(wall.x + wall.width - 5, i);
            this.ctx.stroke();
            
            // Add small rectangles (circuit components)
            this.ctx.fillStyle = '#00FFFF';
            this.ctx.fillRect(wall.x + wall.width/2 - 2, i - 2, 4, 4);
        }
        
        for (let i = wall.bottomY; i < wall.bottomY + wall.bottomHeight; i += 20) {
            this.ctx.beginPath();
            this.ctx.moveTo(wall.x + 5, i);
            this.ctx.lineTo(wall.x + wall.width - 5, i);
            this.ctx.stroke();
            
            this.ctx.fillStyle = '#00FFFF';
            this.ctx.fillRect(wall.x + wall.width/2 - 2, i - 2, 4, 4);
        }
        
        this.drawGapIndicator(wall, '#00FFFF');
    }
    
    drawNatureWall(wall) {
        // Natural stone/wood walls with organic texture
        const gradient = this.ctx.createLinearGradient(wall.x, 0, wall.x + wall.width, 0);
        gradient.addColorStop(0, '#8B4513');
        gradient.addColorStop(0.5, '#A0522D');
        gradient.addColorStop(1, '#654321');
        
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(wall.x, 0, wall.width, wall.topHeight);
        this.ctx.fillRect(wall.x, wall.bottomY, wall.width, wall.bottomHeight);
        
        // Add wood grain texture
        this.ctx.strokeStyle = '#5D4037';
        this.ctx.lineWidth = 1;
        
        // Grain lines
        for (let i = 0; i < wall.topHeight; i += 8) {
            this.ctx.beginPath();
            this.ctx.moveTo(wall.x, i);
            this.ctx.lineTo(wall.x + wall.width, i + (Math.random() - 0.5) * 4);
            this.ctx.stroke();
        }
        
        for (let i = wall.bottomY; i < wall.bottomY + wall.bottomHeight; i += 8) {
            this.ctx.beginPath();
            this.ctx.moveTo(wall.x, i);
            this.ctx.lineTo(wall.x + wall.width, i + (Math.random() - 0.5) * 4);
            this.ctx.stroke();
        }
        
        this.drawGapIndicator(wall, '#90EE90');
    }
    
    drawNeonWall(wall) {
        // Bright neon walls with glowing effects
        this.ctx.save();
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = '#FF1493';
        
        const gradient = this.ctx.createLinearGradient(wall.x, 0, wall.x + wall.width, 0);
        gradient.addColorStop(0, '#FF1493');
        gradient.addColorStop(0.5, '#FF69B4');
        gradient.addColorStop(1, '#FF1493');
        
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(wall.x, 0, wall.width, wall.topHeight);
        this.ctx.fillRect(wall.x, wall.bottomY, wall.width, wall.bottomHeight);
        
        // Add neon stripes
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = '#00FFFF';
        this.ctx.strokeStyle = '#00FFFF';
        this.ctx.lineWidth = 3;
        
        // Neon stripes
        for (let i = 5; i < wall.topHeight; i += 25) {
            this.ctx.beginPath();
            this.ctx.moveTo(wall.x, i);
            this.ctx.lineTo(wall.x + wall.width, i);
            this.ctx.stroke();
        }
        
        for (let i = wall.bottomY + 5; i < wall.bottomY + wall.bottomHeight; i += 25) {
            this.ctx.beginPath();
            this.ctx.moveTo(wall.x, i);
            this.ctx.lineTo(wall.x + wall.width, i);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
        this.drawGapIndicator(wall, '#00FFFF');
    }
    
    drawGapIndicator(wall, color) {
        // Draw gap indicator with subtle glow
        this.ctx.save();
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 12;
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(color)}, 0.6)`;
        this.ctx.lineWidth = 2;
        
        // Draw gap outline
        this.ctx.beginPath();
        this.ctx.moveTo(wall.x - 5, wall.topHeight);
        this.ctx.lineTo(wall.x + wall.width + 5, wall.topHeight);
        this.ctx.moveTo(wall.x - 5, wall.bottomY);
        this.ctx.lineTo(wall.x + wall.width + 5, wall.bottomY);
        this.ctx.stroke();
        
        this.ctx.restore();
    }
    
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? 
            `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` :
            '255, 255, 255';
    }
    
    createDeathEffect(x, y, cause) {
        const color = cause === 'fruit' ? '#FF4444' : '#666666';
        
        this.deathEffects.push({
            x: x,
            y: y,
            color: color,
            life: 60,
            maxLife: 60,
            cause: cause
        });
        
        // Create explosion particles
        this.createParticles(x, y, color, 15);
    }
    
    checkCircleRectCollision(circle, rect) {
        // Check collision between circle (fruit) and rectangle (player) - for bouncing
        const distX = Math.abs(circle.x - rect.x - rect.width/2);
        const distY = Math.abs(circle.y - rect.y - rect.height/2);
        
        // Slightly larger collision radius for bouncing effect
        const bounceRadius = circle.radius + 10;
        
        if (distX > (rect.width/2 + bounceRadius)) return false;
        if (distY > (rect.height/2 + bounceRadius)) return false;
        
        if (distX <= (rect.width/2)) return true;
        if (distY <= (rect.height/2)) return true;
        
        const dx = distX - rect.width/2;
        const dy = distY - rect.height/2;
        return (dx*dx + dy*dy <= (bounceRadius*bounceRadius));
    }
    
    calculateCollisionAngle(fruit, wall, oldX, oldY) {
        // Calculate the angle of collision for realistic bouncing
        const fruitCenterX = fruit.x;
        const fruitCenterY = fruit.y;
        const wallCenterX = wall.x + wall.width/2;
        
        // Determine which part of the wall was hit
        if (fruitCenterY < wall.topHeight) {
            // Hit top wall
            return Math.atan2(fruitCenterY - wall.topHeight, fruitCenterX - wallCenterX);
        } else if (fruitCenterY > wall.bottomY) {
            // Hit bottom wall
            return Math.atan2(fruitCenterY - wall.bottomY, fruitCenterX - wallCenterX);
        } else {
            // Hit side of wall
            return Math.atan2(fruitCenterY - (wall.topHeight + wall.bottomY)/2, fruitCenterX - wallCenterX);
        }
    }
    
    getWallParticleColor(wallType) {
        const colors = {
            crystal: '#87CEEB',
            tech: '#00FFFF',
            nature: '#90EE90',
            neon: '#FF1493'
        };
        return colors[wallType] || '#87CEEB';
    }
    
    drawDeathEffect(effect) {
        this.ctx.save();
        this.ctx.globalAlpha = effect.life / effect.maxLife;
        
        // Draw X mark for death
        this.ctx.strokeStyle = effect.color;
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        
        const size = 20;
        this.ctx.beginPath();
        this.ctx.moveTo(effect.x - size, effect.y - size);
        this.ctx.lineTo(effect.x + size, effect.y + size);
        this.ctx.moveTo(effect.x + size, effect.y - size);
        this.ctx.lineTo(effect.x - size, effect.y + size);
        this.ctx.stroke();
        
        this.ctx.restore();
    }
    
    // Daily Challenges System
    loadDailyChallenges() {
        const today = new Date().toDateString();
        const stored = localStorage.getItem('dailyChallenges');
        
        if (stored) {
            const data = JSON.parse(stored);
            if (data.date === today) {
                return data.challenges;
            }
        }
        
        // Generate new daily challenges
        const challenges = this.generateDailyChallenges();
        localStorage.setItem('dailyChallenges', JSON.stringify({
            date: today,
            challenges: challenges
        }));
        
        return challenges;
    }
    
    generateDailyChallenges() {
        const challengeTypes = [
            { type: 'score', target: 500, reward: 50, description: 'Score 500 points in a single game' },
            { type: 'combo', target: 10, reward: 30, description: 'Achieve a 10x combo' },
            { type: 'fruits', target: 25, reward: 40, description: 'Slice 25 fruits in one game' },
            { type: 'survival', target: 60, reward: 60, description: 'Survive for 60 seconds' },
            { type: 'perfect', target: 1, reward: 100, description: 'Complete a perfect run (no missed fruits)' }
        ];
        
        // Select 3 random challenges for today
        const dailyChallenges = [];
        const shuffled = [...challengeTypes].sort(() => 0.5 - Math.random());
        
        for (let i = 0; i < 3; i++) {
            dailyChallenges.push({
                ...shuffled[i],
                id: `daily_${i}`,
                progress: 0,
                completed: false
            });
        }
        
        return dailyChallenges;
    }
    
    loadPlayerStats() {
        const stored = localStorage.getItem('playerStats');
        if (stored) {
            return JSON.parse(stored);
        }
        
        return {
            currentStreak: 0,
            longestStreak: 0,
            experience: 0,
            lastPlayDate: null,
            totalGamesPlayed: 0,
            totalScore: 0
        };
    }
    
    savePlayerStats() {
        // Update character progression in stats
        this.playerStats.unlockedCharacters = this.unlockedCharacters;
        this.playerStats.currentCharacter = this.currentCharacter;
        this.playerStats.unlockedColors = this.unlockedColors;
        this.playerStats.currentColor = this.currentColor;
        this.playerStats.unlockedAchievements = this.unlockedAchievements;
        
        localStorage.setItem('playerStats', JSON.stringify(this.playerStats));
    }
    
    saveDailyChallenges() {
        const today = new Date().toDateString();
        localStorage.setItem('dailyChallenges', JSON.stringify({
            date: today,
            challenges: this.dailyChallenges
        }));
    }
    
    initializeDailyChallenges() {
        this.updateStreakSystem();
        this.showDailyChallenges();
    }
    
    updateStreakSystem() {
        const today = new Date().toDateString();
        const lastPlay = this.playerStats.lastPlayDate;
        
        if (lastPlay) {
            const lastDate = new Date(lastPlay);
            const todayDate = new Date(today);
            const diffTime = Math.abs(todayDate - lastDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays === 1) {
                // Consecutive day - maintain streak
                this.currentStreak = this.playerStats.currentStreak;
            } else if (diffDays > 1) {
                // Streak broken
                this.currentStreak = 0;
            }
        }
        
        this.playerStats.lastPlayDate = today;
    }
    
    updateChallengeProgress(type, value) {
        this.dailyChallenges.forEach(challenge => {
            if (challenge.type === type && !challenge.completed) {
                challenge.progress = Math.max(challenge.progress, value);
                
                if (challenge.progress >= challenge.target) {
                    challenge.completed = true;
                    this.awardChallengeReward(challenge);
                }
            }
        });
        
        this.saveDailyChallenges();
    }
    
    awardChallengeReward(challenge) {
        const oldLevel = this.level;
        this.experience += challenge.reward;
        this.level = Math.floor(this.experience / 100) + 1;
        this.playerStats.experience = this.experience;
        
        // Check for new unlocks if level increased
        if (this.level > oldLevel) {
            this.checkUnlocks();
        }
        
        // Show completion animation
        this.showChallengeComplete(challenge);
        
        // Check if all daily challenges completed
        const allCompleted = this.dailyChallenges.every(c => c.completed);
        if (allCompleted) {
            this.currentStreak++;
            this.playerStats.currentStreak = this.currentStreak;
            
            if (this.currentStreak > this.longestStreak) {
                this.longestStreak = this.currentStreak;
                this.playerStats.longestStreak = this.longestStreak;
            }
            
            // Bonus reward for completing all challenges
            this.experience += 100;
            this.playerStats.experience = this.experience;
            this.showStreakBonus();
        }
        
        this.savePlayerStats();
    }
    
    showChallengeComplete(challenge) {
        const notification = document.createElement('div');
        notification.className = 'challenge-complete';
        notification.innerHTML = `
            <div style="
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(45deg, #4CAF50, #45a049);
                color: white;
                padding: 15px;
                border-radius: 10px;
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                z-index: 1000;
                animation: slideInRight 0.5s ease-out;
            ">
                <div style="font-weight: bold;">🎉 Challenge Complete!</div>
                <div style="font-size: 14px; margin-top: 5px;">${challenge.description}</div>
                <div style="font-size: 12px; margin-top: 5px; color: #FFD700;">+${challenge.reward} XP</div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
    
    showStreakBonus() {
        const notification = document.createElement('div');
        notification.className = 'streak-bonus';
        notification.innerHTML = `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: linear-gradient(45deg, #FFD700, #FFA500);
                color: #333;
                padding: 20px;
                border-radius: 15px;
                box-shadow: 0 8px 16px rgba(0,0,0,0.4);
                z-index: 1001;
                text-align: center;
                animation: bounceIn 0.6s ease-out;
            ">
                <div style="font-size: 24px; font-weight: bold;">🔥 STREAK BONUS!</div>
                <div style="font-size: 18px; margin: 10px 0;">${this.currentStreak} Day Streak</div>
                <div style="font-size: 14px;">+100 Bonus XP</div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 4000);
    }
    
    showDailyChallenges() {
        // Update challenge UI if it exists
        this.updateChallengesUI();
    }
    
    // Power-Up System
    spawnPowerUp() {
        const now = Date.now();
        if (now - (this.lastPowerUpSpawn || 0) > 8000) { // Every 8 seconds
            const powerUpTypes = [
                { type: 'slowMotion', color: '#9C27B0', duration: 5000, description: 'Slow Motion' },
                { type: 'magnet', color: '#FF9800', duration: 7000, description: 'Fruit Magnet' },
                { type: 'shield', color: '#2196F3', duration: 10000, description: 'Shield' },
                { type: 'doublePoints', color: '#4CAF50', duration: 8000, description: '2x Points' },
                { type: 'superSlice', color: '#F44336', duration: 6000, description: 'Super Slice' }
            ];
            
            const powerUpType = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
            
            this.powerUps.push({
                id: `powerup_${Date.now()}_${Math.random()}`,
                x: this.canvas.width + 30,
                y: Math.random() * (this.canvas.height - 100) + 50,
                width: 30,
                height: 30,
                velocityX: -this.gameSpeed * 0.8,
                velocityY: Math.sin(Date.now() * 0.005) * 2,
                ...powerUpType,
                rotation: 0,
                collected: false
            });
            
            this.lastPowerUpSpawn = now;
        }
    }
    
    checkPowerUpCollection() {
        this.powerUps.forEach((powerUp, index) => {
            if (powerUp.collected) return;
            
            // Check collision with player
            if (this.checkRectCollision(this.player, powerUp)) {
                this.collectPowerUp(powerUp);
                powerUp.collected = true;
                
                // Remove power-up after collection
                setTimeout(() => {
                    const currentIndex = this.powerUps.findIndex(p => p.id === powerUp.id);
                    if (currentIndex !== -1) {
                        this.powerUps.splice(currentIndex, 1);
                    }
                }, 200);
            }
        });
    }
    
    collectPowerUp(powerUp) {
        // Check cooldown
        if (this.powerUpCooldowns.has(powerUp.type)) {
            const cooldownEnd = this.powerUpCooldowns.get(powerUp.type);
            if (Date.now() < cooldownEnd) {
                return; // Still on cooldown
            }
        }
        
        // Activate power-up
        this.activatePowerUp(powerUp);
        
        // Visual, audio, and haptic feedback
        this.createParticles(powerUp.x, powerUp.y, powerUp.color, 12);
        this.showPowerUpNotification(powerUp);
        this.playPowerUpSound();
        this.vibrate([100, 50, 100]);
        this.addScreenShake(5, 20);
        this.addZoomEffect(1.1, 25);
        this.createBackgroundEffect('burst', powerUp.x, powerUp.y, powerUp.color);
        
        // Track for achievements
        this.powerUpsCollected = (this.powerUpsCollected || 0) + 1;
    }
    
    activatePowerUp(powerUp) {
        const endTime = Date.now() + powerUp.duration;
        this.activePowerUps.set(powerUp.type, endTime);
        
        switch (powerUp.type) {
            case 'slowMotion':
                this.originalGameSpeed = this.gameSpeed;
                this.gameSpeed *= 0.3;
                break;
                
            case 'shield':
                this.player.hasShield = true;
                break;
                
            case 'doublePoints':
                this.hasDoublePoints = true;
                break;
                
            case 'superSlice':
                this.hasSuperSlice = true;
                break;
        }
        
        // Set cooldown (power-up duration + 5 seconds)
        this.powerUpCooldowns.set(powerUp.type, endTime + 5000);
    }
    
    updatePowerUps() {
        const now = Date.now();
        
        // Check for expired power-ups
        for (const [type, endTime] of this.activePowerUps.entries()) {
            if (now >= endTime) {
                this.deactivatePowerUp(type);
                this.activePowerUps.delete(type);
            }
        }
        
        // Update power-up positions
        this.powerUps.forEach((powerUp, index) => {
            powerUp.x += powerUp.velocityX;
            powerUp.y += Math.sin(Date.now() * 0.005 + index) * 0.5;
            powerUp.rotation += 0.05;
            
            // Remove power-ups that are off screen
            if (powerUp.x < -powerUp.width) {
                this.powerUps.splice(index, 1);
            }
        });
        
        // Apply magnet effect
        if (this.activePowerUps.has('magnet')) {
            this.applyMagnetEffect();
        }
    }
    
    deactivatePowerUp(type) {
        switch (type) {
            case 'slowMotion':
                this.gameSpeed = this.originalGameSpeed || 2;
                break;
                
            case 'shield':
                this.player.hasShield = false;
                break;
                
            case 'doublePoints':
                this.hasDoublePoints = false;
                break;
                
            case 'superSlice':
                this.hasSuperSlice = false;
                break;
        }
    }
    
    applyMagnetEffect() {
        const magnetRadius = 100;
        const magnetStrength = 0.3;
        
        this.fruits.forEach(fruit => {
            if (fruit.sliced) return;
            
            const dx = (this.player.x + this.player.width/2) - fruit.x;
            const dy = (this.player.y + this.player.height/2) - fruit.y;
            const distance = Math.sqrt(dx*dx + dy*dy);
            
            if (distance < magnetRadius) {
                const force = magnetStrength * (1 - distance / magnetRadius);
                fruit.velocityX += (dx / distance) * force;
                fruit.velocityY += (dy / distance) * force;
            }
        });
    }
    
    checkRectCollision(rect1, rect2) {
        return rect1.x < rect2.x + rect2.width &&
               rect1.x + rect1.width > rect2.x &&
               rect1.y < rect2.y + rect2.height &&
               rect1.y + rect1.height > rect2.y;
    }
    
    showPowerUpNotification(powerUp) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: ${powerUp.color};
            color: white;
            padding: 15px 25px;
            border-radius: 25px;
            font-weight: bold;
            font-size: 18px;
            z-index: 1000;
            animation: bounceIn 0.5s ease-out;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;
        notification.textContent = powerUp.description + ' Activated!';
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 2000);
    }
    
    drawPowerUp(powerUp) {
        if (powerUp.collected) return;
        
        this.ctx.save();
        this.ctx.translate(powerUp.x + powerUp.width/2, powerUp.y + powerUp.height/2);
        this.ctx.rotate(powerUp.rotation);
        
        // Draw glow effect
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = powerUp.color;
        
        // Draw power-up icon
        this.ctx.fillStyle = powerUp.color;
        this.ctx.fillRect(-powerUp.width/2, -powerUp.height/2, powerUp.width, powerUp.height);
        
        // Draw inner symbol based on type
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = '16px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        let symbol = '?';
        switch(powerUp.type) {
            case 'slowMotion': symbol = '⏱'; break;
            case 'magnet': symbol = '🧲'; break;
            case 'shield': symbol = '🛡'; break;
            case 'doublePoints': symbol = '2x'; break;
            case 'superSlice': symbol = '⚡'; break;
        }
        
        this.ctx.fillText(symbol, 0, 0);
        
        this.ctx.restore();
    }
    
    drawPowerUpEffects() {
        // Draw shield effect around player
        if (this.player.hasShield) {
            this.ctx.save();
            this.ctx.strokeStyle = '#2196F3';
            this.ctx.lineWidth = 3;
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = '#2196F3';
            
            const radius = 30;
            this.ctx.beginPath();
            this.ctx.arc(
                this.player.x + this.player.width/2,
                this.player.y + this.player.height/2,
                radius,
                0,
                Math.PI * 2
            );
            this.ctx.stroke();
            
            this.ctx.restore();
        }
        
        // Draw slow motion effect
        if (this.activePowerUps.has('slowMotion')) {
            this.ctx.fillStyle = 'rgba(156, 39, 176, 0.1)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Draw double points effect
        if (this.hasDoublePoints) {
            this.ctx.save();
            this.ctx.fillStyle = '#4CAF50';
            this.ctx.font = '12px Arial';
            this.ctx.fillText('2X POINTS', this.player.x, this.player.y - 10);
            this.ctx.restore();
        }
    }
    
    createSuperSliceEffect(x, y) {
        // Create a larger, more impressive slice effect
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                this.createParticles(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40, '#F44336', 6);
            }, i * 50);
        }
    }
    
    createShieldBreakEffect(x, y) {
        // Create shield break particles
        this.createParticles(x, y, '#2196F3', 15);
        
        // Show shield break notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 30%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #2196F3;
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            font-weight: bold;
            z-index: 1000;
            animation: bounceIn 0.5s ease-out;
        `;
        notification.textContent = 'Shield Broken!';
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 1500);
    }
    
    // Audio System
    initializeAudio() {
        this.audioContext = null;
        
        // Initialize Web Audio API on first user interaction
        document.addEventListener('click', () => {
            if (!this.audioContext) {
                this.setupAudioContext();
            }
        }, { once: true });
        
        document.addEventListener('keydown', () => {
            if (!this.audioContext) {
                this.setupAudioContext();
            }
        }, { once: true });
    }
    
    setupAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio API not supported');
        }
    }
    
    playSound(frequency, duration = 0.1, volume = 0.1, type = 'sine') {
        if (!this.audioEnabled || !this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            oscillator.type = type;
            
            gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + duration);
        } catch (e) {
            console.warn('Error playing sound:', e);
        }
    }
    
    playJumpSound() {
        this.playSound(400, 0.1, 0.15, 'square');
    }
    
    playSliceSound() {
        // Create a satisfying slice sound
        this.playSound(800, 0.05, 0.2, 'sawtooth');
        setTimeout(() => this.playSound(600, 0.05, 0.15, 'sawtooth'), 20);
    }
    
    playComboSound(comboCount) {
        // Higher pitch for higher combos
        const frequency = Math.min(400 + (comboCount * 50), 1200);
        this.playSound(frequency, 0.2, 0.25, 'triangle');
    }
    
    playPowerUpSound() {
        // Ascending power-up sound
        this.playSound(600, 0.1, 0.2, 'sine');
        setTimeout(() => this.playSound(800, 0.1, 0.2, 'sine'), 50);
        setTimeout(() => this.playSound(1000, 0.15, 0.25, 'sine'), 100);
    }
    
    playDeathSound() {
        // Dramatic death sound
        this.playSound(200, 0.3, 0.3, 'sawtooth');
        setTimeout(() => this.playSound(150, 0.4, 0.25, 'sawtooth'), 100);
    }
    
    playWallBounceSound() {
        this.playSound(300, 0.08, 0.1, 'square');
    }
    
    createAudioToggle() {
        const toggle = document.createElement('button');
        toggle.id = 'audioToggle';
        toggle.style.cssText = `
            position: absolute;
            top: 20px;
            right: 350px;
            background: ${this.audioEnabled ? '#4CAF50' : '#f44336'};
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
        `;
        toggle.textContent = this.audioEnabled ? '🔊 ON' : '🔇 OFF';
        toggle.onclick = () => this.toggleAudio();
        
        document.getElementById('gameContainer').appendChild(toggle);
    }
    
    toggleAudio() {
        this.audioEnabled = !this.audioEnabled;
        localStorage.setItem('audioEnabled', this.audioEnabled.toString());
        
        const toggle = document.getElementById('audioToggle');
        toggle.style.background = this.audioEnabled ? '#4CAF50' : '#f44336';
        toggle.textContent = this.audioEnabled ? '🔊 ON' : '🔇 OFF';
        
        if (this.audioEnabled && !this.audioContext) {
            this.setupAudioContext();
        }
    }
    
    // Haptic Feedback (for mobile devices)
    vibrate(pattern = [50]) {
        if ('vibrate' in navigator && window.DeviceMotionEvent) {
            try {
                navigator.vibrate(pattern);
            } catch (e) {
                console.warn('Vibration not supported');
            }
        }
    }
    
    // Visual Effects System
    resetVisualEffects() {
        this.screenShake = { x: 0, y: 0, intensity: 0, duration: 0 };
        this.backgroundEffects = [];
        this.cameraZoom = 1.0;
        this.targetZoom = 1.0;
    }
    
    addScreenShake(intensity, duration) {
        this.screenShake.intensity = Math.max(this.screenShake.intensity, intensity);
        this.screenShake.duration = Math.max(this.screenShake.duration, duration);
    }
    
    updateScreenShake() {
        if (this.screenShake.duration > 0) {
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.duration--;
            this.screenShake.intensity *= 0.95; // Gradually reduce intensity
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
            this.screenShake.intensity = 0;
        }
    }
    
    addZoomEffect(targetZoom, duration = 30) {
        this.targetZoom = targetZoom;
        this.zoomDuration = duration;
    }
    
    updateZoomEffect() {
        if (Math.abs(this.cameraZoom - this.targetZoom) > 0.01) {
            this.cameraZoom += (this.targetZoom - this.cameraZoom) * 0.15;
        } else {
            this.cameraZoom = this.targetZoom;
        }
    }
    
    createBackgroundEffect(type, x, y, color = '#FFD700') {
        this.backgroundEffects.push({
            type: type,
            x: x,
            y: y,
            color: color,
            life: 60,
            maxLife: 60,
            size: 0,
            maxSize: type === 'explosion' ? 80 : 40,
            rotation: 0
        });
    }
    
    updateBackgroundEffects() {
        this.backgroundEffects.forEach((effect, index) => {
            effect.life--;
            effect.rotation += 0.1;
            
            // Animate size
            if (effect.life > effect.maxLife * 0.7) {
                effect.size += (effect.maxSize - effect.size) * 0.2;
            } else {
                effect.size *= 0.95;
            }
            
            if (effect.life <= 0) {
                this.backgroundEffects.splice(index, 1);
            }
        });
    }
    
    createTrailEffect(x, y, color, size = 3) {
        for (let i = 0; i < 3; i++) {
            this.particles.push({
                x: x + (Math.random() - 0.5) * 10,
                y: y + (Math.random() - 0.5) * 10,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
                color: color,
                life: 30 + Math.random() * 20,
                maxLife: 50,
                size: size,
                alpha: 1.0
            });
        }
    }
    
    drawBackgroundEffect(effect) {
        this.ctx.save();
        this.ctx.translate(effect.x, effect.y);
        this.ctx.rotate(effect.rotation);
        this.ctx.globalAlpha = effect.life / effect.maxLife;
        
        if (effect.type === 'explosion') {
            // Draw explosion effect
            const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, effect.size);
            gradient.addColorStop(0, effect.color);
            gradient.addColorStop(0.5, effect.color + '80');
            gradient.addColorStop(1, effect.color + '00');
            
            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, effect.size, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Add some spikes for explosion effect
            this.ctx.strokeStyle = effect.color;
            this.ctx.lineWidth = 2;
            for (let i = 0; i < 8; i++) {
                const angle = (Math.PI * 2 / 8) * i;
                const x1 = Math.cos(angle) * effect.size * 0.5;
                const y1 = Math.sin(angle) * effect.size * 0.5;
                const x2 = Math.cos(angle) * effect.size;
                const y2 = Math.sin(angle) * effect.size;
                
                this.ctx.beginPath();
                this.ctx.moveTo(x1, y1);
                this.ctx.lineTo(x2, y2);
                this.ctx.stroke();
            }
        } else if (effect.type === 'burst') {
            // Draw burst effect
            this.ctx.strokeStyle = effect.color;
            this.ctx.lineWidth = 3;
            this.ctx.lineCap = 'round';
            
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI * 2 / 6) * i + effect.rotation;
                const x = Math.cos(angle) * effect.size;
                const y = Math.sin(angle) * effect.size;
                
                this.ctx.beginPath();
                this.ctx.moveTo(0, 0);
                this.ctx.lineTo(x, y);
                this.ctx.stroke();
            }
        }
        
        this.ctx.restore();
    }
    
    // Character Progression System
    checkUnlocks() {
        const characterUnlocks = {
            'ninja': { level: 5, description: 'Reach Level 5' },
            'robot': { level: 10, description: 'Reach Level 10' },
            'phoenix': { level: 15, description: 'Reach Level 15' },
            'dragon': { level: 25, description: 'Reach Level 25' },
            'cosmic': { level: 50, description: 'Reach Level 50' }
        };
        
        const colorUnlocks = {
            '#FF4444': { level: 3, description: 'Unlock Red' },
            '#44FF44': { level: 6, description: 'Unlock Green' },
            '#4444FF': { level: 9, description: 'Unlock Blue' },
            '#FF44FF': { level: 12, description: 'Unlock Purple' },
            '#44FFFF': { level: 18, description: 'Unlock Cyan' },
            '#FF8844': { level: 22, description: 'Unlock Orange' },
            '#8844FF': { level: 30, description: 'Unlock Violet' }
        };
        
        // Check character unlocks
        for (const [character, unlock] of Object.entries(characterUnlocks)) {
            if (this.level >= unlock.level && !this.unlockedCharacters.includes(character)) {
                this.unlockedCharacters.push(character);
                this.showUnlockNotification('character', character, unlock.description);
            }
        }
        
        // Check color unlocks
        for (const [color, unlock] of Object.entries(colorUnlocks)) {
            if (this.level >= unlock.level && !this.unlockedColors.includes(color)) {
                this.unlockedColors.push(color);
                this.showUnlockNotification('color', color, unlock.description);
            }
        }
        
        this.savePlayerStats();
    }
    
    showUnlockNotification(type, item, description) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(45deg, #FFD700, #FFA500);
            color: #333;
            padding: 15px 25px;
            border-radius: 15px;
            font-weight: bold;
            z-index: 1002;
            animation: slideInRight 0.5s ease-out;
            box-shadow: 0 4px 20px rgba(255, 215, 0, 0.3);
        `;
        
        const icon = type === 'character' ? '🥷' : '🎨';
        notification.innerHTML = `
            <div style="font-size: 18px;">${icon} NEW UNLOCK!</div>
            <div style="font-size: 14px; margin-top: 5px;">${description}</div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 4000);
    }
    
    getCharacterStats(character) {
        const characterStats = {
            'default': { speed: 1.0, jumpPower: 1.0, size: 1.0, special: 'none' },
            'ninja': { speed: 1.1, jumpPower: 1.05, size: 0.9, special: 'stealth' },
            'robot': { speed: 0.9, jumpPower: 1.2, size: 1.1, special: 'shield_boost' },
            'phoenix': { speed: 1.2, jumpPower: 0.95, size: 1.0, special: 'fire_trail' },
            'dragon': { speed: 1.0, jumpPower: 1.3, size: 1.2, special: 'double_slice' },
            'cosmic': { speed: 1.15, jumpPower: 1.15, size: 0.95, special: 'time_slow' }
        };
        
        return characterStats[character] || characterStats['default'];
    }
    
    applyCharacterStats() {
        const stats = this.getCharacterStats(this.currentCharacter);
        
        this.player.width = 40 * stats.size;
        this.player.height = 30 * stats.size;
        this.player.jumpPower = -10 * stats.jumpPower;
        this.gameSpeedMultiplier = stats.speed;
        
        // Apply special abilities
        this.characterSpecial = stats.special;
    }
    
    createCustomizationMenu() {
        const menu = document.createElement('div');
        menu.id = 'customizationMenu';
        menu.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 30px;
            border-radius: 15px;
            max-width: 500px;
            z-index: 1003;
            display: none;
        `;
        
        menu.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <h2>🎨 Customize Character</h2>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3>Characters</h3>
                <div id="characterSelector" style="display: flex; flex-wrap: wrap; gap: 10px;"></div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3>Colors</h3>
                <div id="colorSelector" style="display: flex; flex-wrap: wrap; gap: 10px;"></div>
            </div>
            
            <div style="text-align: center;">
                <button onclick="closeCustomizationMenu()" style="background: #f44336; margin-right: 10px;">Close</button>
                <button onclick="applyCustomization()" style="background: #4CAF50;">Apply</button>
            </div>
        `;
        
        document.getElementById('gameContainer').appendChild(menu);
        this.populateCustomizationOptions();
    }
    
    populateCustomizationOptions() {
        const characterSelector = document.getElementById('characterSelector');
        const colorSelector = document.getElementById('colorSelector');
        
        if (!characterSelector || !colorSelector) return;
        
        // Character options
        const allCharacters = ['default', 'ninja', 'robot', 'phoenix', 'dragon', 'cosmic'];
        characterSelector.innerHTML = '';
        
        allCharacters.forEach(character => {
            const isUnlocked = this.unlockedCharacters.includes(character);
            const button = document.createElement('button');
            button.style.cssText = `
                padding: 10px;
                margin: 5px;
                border: ${this.currentCharacter === character ? '3px solid #FFD700' : '1px solid #666'};
                background: ${isUnlocked ? '#333' : '#666'};
                color: ${isUnlocked ? 'white' : '#999'};
                border-radius: 5px;
                cursor: ${isUnlocked ? 'pointer' : 'not-allowed'};
            `;
            button.textContent = character.charAt(0).toUpperCase() + character.slice(1);
            
            if (isUnlocked) {
                button.onclick = () => this.selectCharacter(character);
            }
            
            characterSelector.appendChild(button);
        });
        
        // Color options
        colorSelector.innerHTML = '';
        
        this.unlockedColors.forEach(color => {
            const button = document.createElement('div');
            button.style.cssText = `
                width: 30px;
                height: 30px;
                background: ${color};
                border: ${this.currentColor === color ? '3px solid white' : '1px solid #666'};
                border-radius: 50%;
                cursor: pointer;
                margin: 5px;
            `;
            button.onclick = () => this.selectColor(color);
            
            colorSelector.appendChild(button);
        });
    }
    
    selectCharacter(character) {
        this.currentCharacter = character;
        this.populateCustomizationOptions();
    }
    
    selectColor(color) {
        this.currentColor = color;
        this.populateCustomizationOptions();
    }
    
    // Dynamic Difficulty System
    updateDifficulty() {
        if (!this.adaptiveDifficulty) return;
        
        // Calculate performance metrics
        this.calculatePerformanceMetrics();
        
        const targetDifficulty = this.calculateTargetDifficulty();
        
        // Gradually adjust difficulty
        if (targetDifficulty > this.difficultyLevel) {
            this.difficultyLevel = Math.min(this.difficultyLevel + 0.1, targetDifficulty);
        } else if (targetDifficulty < this.difficultyLevel) {
            this.difficultyLevel = Math.max(this.difficultyLevel - 0.05, targetDifficulty);
        }
        
        // Apply difficulty changes
        this.applyDifficultySettings();
    }
    
    calculatePerformanceMetrics() {
        if (this.performanceMetrics.recentScores.length > 0) {
            this.performanceMetrics.avgScore = 
                this.performanceMetrics.recentScores.reduce((a, b) => a + b, 0) / 
                this.performanceMetrics.recentScores.length;
        }
        
        if (this.performanceMetrics.recentSurvivalTimes.length > 0) {
            this.performanceMetrics.avgSurvival = 
                this.performanceMetrics.recentSurvivalTimes.reduce((a, b) => a + b, 0) / 
                this.performanceMetrics.recentSurvivalTimes.length;
        }
    }
    
    calculateTargetDifficulty() {
        let targetDifficulty = 1.0;
        
        // Base difficulty on player level
        targetDifficulty += (this.level - 1) * 0.1;
        
        // Adjust based on recent performance
        if (this.performanceMetrics.avgScore > 300) {
            targetDifficulty += 0.5;
        } else if (this.performanceMetrics.avgScore < 100) {
            targetDifficulty -= 0.3;
        }
        
        if (this.performanceMetrics.avgSurvival > 45) {
            targetDifficulty += 0.4;
        } else if (this.performanceMetrics.avgSurvival < 15) {
            targetDifficulty -= 0.2;
        }
        
        // Adjust based on death rate
        const deathsPerGame = this.performanceMetrics.deaths / Math.max(this.playerStats.totalGamesPlayed, 1);
        if (deathsPerGame < 0.5) {
            targetDifficulty += 0.3;
        } else if (deathsPerGame > 2) {
            targetDifficulty -= 0.4;
        }
        
        return Math.max(0.5, Math.min(3.0, targetDifficulty));
    }
    
    applyDifficultySettings() {
        // Adjust game speed
        this.gameSpeed = this.baseGameSpeed * (0.8 + this.difficultyLevel * 0.4);
        
        // Adjust wall spawn frequency
        this.wallSpawnInterval = Math.max(2000, 4000 - (this.difficultyLevel - 1) * 800);
        
        // Adjust gap size
        this.wallGapSize = Math.max(180, 220 - (this.difficultyLevel - 1) * 20);
        
        // Adjust fruit spawn rate
        this.fruitSpawnRate = Math.max(0.8, 1.2 - (this.difficultyLevel - 1) * 0.1);
    }
    
    recordGamePerformance(score, survivalTime) {
        // Record recent performance (keep last 5 games)
        this.performanceMetrics.recentScores.push(score);
        this.performanceMetrics.recentSurvivalTimes.push(survivalTime);
        
        if (this.performanceMetrics.recentScores.length > 5) {
            this.performanceMetrics.recentScores.shift();
        }
        
        if (this.performanceMetrics.recentSurvivalTimes.length > 5) {
            this.performanceMetrics.recentSurvivalTimes.shift();
        }
        
        this.performanceMetrics.deaths++;
        
        // Update difficulty after recording performance
        this.updateDifficulty();
    }
    
    getDifficultyDescription() {
        if (this.difficultyLevel < 1.2) return 'Easy';
        if (this.difficultyLevel < 1.5) return 'Normal';
        if (this.difficultyLevel < 2.0) return 'Hard';
        if (this.difficultyLevel < 2.5) return 'Expert';
        return 'Insane';
    }
    
    // Achievement System
    loadAchievements() {
        return {
            'first_slice': { name: 'First Slice', description: 'Slice your first fruit', icon: '🍎', unlocked: false },
            'combo_master': { name: 'Combo Master', description: 'Achieve a 15x combo', icon: '⚡', unlocked: false },
            'centurion': { name: 'Centurion', description: 'Score 100 points in one game', icon: '💯', unlocked: false },
            'survivor': { name: 'Survivor', description: 'Survive for 60 seconds', icon: '⏱', unlocked: false },
            'fruit_ninja': { name: 'Fruit Ninja', description: 'Slice 100 fruits in one game', icon: '🥷', unlocked: false },
            'perfectionist': { name: 'Perfectionist', description: 'Complete a game without missing any fruits', icon: '✨', unlocked: false },
            'power_collector': { name: 'Power Collector', description: 'Collect 10 power-ups in one game', icon: '🔋', unlocked: false },
            'level_up': { name: 'Level Up', description: 'Reach level 10', icon: '🎆', unlocked: false },
            'streak_champion': { name: 'Streak Champion', description: 'Maintain a 7-day streak', icon: '🔥', unlocked: false },
            'high_scorer': { name: 'High Scorer', description: 'Score 1000 points in one game', icon: '🏆', unlocked: false },
            'wall_dodger': { name: 'Wall Dodger', description: 'Pass through 50 walls in one game', icon: '🧨', unlocked: false },
            'speed_demon': { name: 'Speed Demon', description: 'Play on Insane difficulty', icon: '🚀', unlocked: false }
        };
    }
    
    checkAchievements() {
        const gameStats = {
            score: this.score,
            combo: this.bestCombo,
            fruitsSliced: this.fruitsSliced || 0,
            survivalTime: Math.floor((Date.now() - this.gameStartTime) / 1000),
            powerUpsCollected: this.powerUpsCollected || 0,
            wallsPassed: this.wallsPassed || 0,
            missedFruits: this.missedFruits || 0,
            level: this.level,
            streak: this.currentStreak,
            difficulty: this.getDifficultyDescription()
        };
        
        this.evaluateAchievements(gameStats);
    }
    
    evaluateAchievements(stats) {
        const achievements = [
            { id: 'first_slice', condition: () => stats.fruitsSliced >= 1 },
            { id: 'combo_master', condition: () => stats.combo >= 15 },
            { id: 'centurion', condition: () => stats.score >= 100 },
            { id: 'survivor', condition: () => stats.survivalTime >= 60 },
            { id: 'fruit_ninja', condition: () => stats.fruitsSliced >= 100 },
            { id: 'perfectionist', condition: () => stats.fruitsSliced > 0 && this.missedFruits === 0 },
            { id: 'power_collector', condition: () => stats.powerUpsCollected >= 10 },
            { id: 'level_up', condition: () => stats.level >= 10 },
            { id: 'streak_champion', condition: () => stats.streak >= 7 },
            { id: 'high_scorer', condition: () => stats.score >= 1000 },
            { id: 'wall_dodger', condition: () => stats.wallsPassed >= 50 },
            { id: 'speed_demon', condition: () => stats.difficulty === 'Insane' }
        ];
        
        achievements.forEach(achievement => {
            if (!this.unlockedAchievements.includes(achievement.id) && achievement.condition()) {
                this.unlockAchievement(achievement.id);
            }
        });
    }
    
    unlockAchievement(achievementId) {
        this.unlockedAchievements.push(achievementId);
        const achievement = this.achievements[achievementId];
        
        if (achievement) {
            achievement.unlocked = true;
            this.showAchievementNotification(achievement);
            this.savePlayerStats();
        }
    }
    
    showAchievementNotification(achievement) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50px;
            right: 20px;
            background: linear-gradient(45deg, #FFD700, #FFA500);
            color: #333;
            padding: 20px;
            border-radius: 15px;
            box-shadow: 0 8px 20px rgba(255, 215, 0, 0.4);
            z-index: 1004;
            animation: slideInRight 0.5s ease-out;
            max-width: 300px;
        `;
        
        notification.innerHTML = `
            <div style="font-size: 20px; font-weight: bold; margin-bottom: 10px;">
                🏆 ACHIEVEMENT UNLOCKED!
            </div>
            <div style="font-size: 24px; margin-bottom: 8px;">
                ${achievement.icon} ${achievement.name}
            </div>
            <div style="font-size: 14px; margin-bottom: 15px;">
                ${achievement.description}
            </div>
            <button onclick="shareAchievement('${achievement.name}', '${achievement.description}')" 
                    style="background: #4CAF50; color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer;">
                📱 Share
            </button>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }
    
    createAchievementsMenu() {
        const menu = document.createElement('div');
        menu.id = 'achievementsMenu';
        menu.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 30px;
            border-radius: 15px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            z-index: 1003;
            display: none;
        `;
        
        const unlockedCount = this.unlockedAchievements.length;
        const totalCount = Object.keys(this.achievements).length;
        const completionPercentage = Math.round((unlockedCount / totalCount) * 100);
        
        menu.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <h2>🏆 Achievements</h2>
                <div style="margin: 10px 0; font-size: 16px;">
                    Progress: ${unlockedCount}/${totalCount} (${completionPercentage}%)
                </div>
                <div style="width: 100%; height: 8px; background: #333; border-radius: 4px; margin: 10px 0;">
                    <div style="width: ${completionPercentage}%; height: 100%; background: #4CAF50; border-radius: 4px;"></div>
                </div>
            </div>
            
            <div id="achievementsList" style="margin-bottom: 20px;"></div>
            
            <div style="text-align: center;">
                <button onclick="closeAchievementsMenu()" style="background: #f44336; color: white; border: none; padding: 10px 20px; border-radius: 5px;">Close</button>
            </div>
        `;
        
        document.getElementById('gameContainer').appendChild(menu);
        this.populateAchievementsList();
    }
    
    populateAchievementsList() {
        const achievementsList = document.getElementById('achievementsList');
        if (!achievementsList) return;
        
        achievementsList.innerHTML = '';
        
        Object.entries(this.achievements).forEach(([id, achievement]) => {
            const isUnlocked = this.unlockedAchievements.includes(id);
            
            const achievementDiv = document.createElement('div');
            achievementDiv.style.cssText = `
                display: flex;
                align-items: center;
                padding: 15px;
                margin: 10px 0;
                background: ${isUnlocked ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255,255,255,0.1)'};
                border-radius: 10px;
                opacity: ${isUnlocked ? '1' : '0.6'};
            `;
            
            achievementDiv.innerHTML = `
                <div style="font-size: 24px; margin-right: 15px;">
                    ${isUnlocked ? achievement.icon : '🔒'}
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 16px;">${achievement.name}</div>
                    <div style="font-size: 14px; color: #ccc; margin-top: 5px;">${achievement.description}</div>
                </div>
                ${isUnlocked ? `
                    <button onclick="shareAchievement('${achievement.name}', '${achievement.description}')" 
                            style="background: #2196F3; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;">
                        Share
                    </button>
                ` : ''}
            `;
            
            achievementsList.appendChild(achievementDiv);
        });
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
    window.game.players = {};
    window.game.isReady = false;
    document.getElementById('roomInfo').style.display = 'none';
    document.getElementById('singlePlayerMode').style.display = 'block';
    window.game.gameState = 'menu';
    
    // Clean up share URL
    const shareDiv = document.getElementById('shareURL');
    if (shareDiv) shareDiv.remove();
    
    // Clean up ready button
    const readyButton = document.getElementById('readyButton');
    if (readyButton) readyButton.remove();
}

function copyShareURL() {
    const input = document.getElementById('shareURLInput');
    input.select();
    document.execCommand('copy');
    alert('Share URL copied to clipboard!');
}

function restartGame() {
    window.game.quickRestart();
}

function showMainMenu() {
    const gameOverDiv = document.getElementById('gameOver');
    gameOverDiv.style.display = 'none';
    window.game.gameState = 'menu';
    document.getElementById('singlePlayerMode').style.display = 'block';
    document.getElementById('multiplayerOptions').style.display = 'none';
    document.getElementById('roomInfo').style.display = 'none';
}

function toggleChallenges() {
    const challengesUI = document.getElementById('challengesUI');
    const showBtn = document.getElementById('showChallengesBtn');
    
    if (challengesUI.style.display === 'none' || challengesUI.style.display === '') {
        challengesUI.style.display = 'block';
        showBtn.style.display = 'none';
        window.game.updateChallengesUI();
    } else {
        challengesUI.style.display = 'none';
        showBtn.style.display = 'block';
    }
}

function showCustomizationMenu() {
    if (!document.getElementById('customizationMenu')) {
        window.game.createCustomizationMenu();
    }
    document.getElementById('customizationMenu').style.display = 'block';
}

function closeCustomizationMenu() {
    document.getElementById('customizationMenu').style.display = 'none';
}

function applyCustomization() {
    window.game.player.color = window.game.currentColor;
    window.game.applyCharacterStats();
    window.game.savePlayerStats();
    closeCustomizationMenu();
}

function showAchievementsMenu() {
    if (!document.getElementById('achievementsMenu')) {
        window.game.createAchievementsMenu();
    }
    document.getElementById('achievementsMenu').style.display = 'block';
}

function closeAchievementsMenu() {
    document.getElementById('achievementsMenu').style.display = 'none';
}

function shareAchievement(name, description) {
    const shareText = `🏆 I just unlocked "${name}" in Flappy Bird Ninja! ${description} #FlappyBirdNinja #Achievement`;
    
    if (navigator.share) {
        // Use native sharing API if available
        navigator.share({
            title: 'Flappy Bird Ninja Achievement',
            text: shareText,
            url: window.location.origin
        }).catch(console.error);
    } else {
        // Fallback to copying to clipboard
        navigator.clipboard.writeText(shareText).then(() => {
            alert('Achievement copied to clipboard! Share it on your favorite social media.');
        }).catch(() => {
            // Final fallback
            const textArea = document.createElement('textarea');
            textArea.value = shareText;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            alert('Achievement copied to clipboard! Share it on your favorite social media.');
        });
    }
}

function shareScore(score, level, combo) {
    const shareText = `🎮 Just scored ${score} points in Flappy Bird Ninja! Level ${level}, best combo: ${combo}x! Can you beat my score? #FlappyBirdNinja`;
    
    if (navigator.share) {
        navigator.share({
            title: 'Flappy Bird Ninja High Score',
            text: shareText,
            url: window.location.origin
        }).catch(console.error);
    } else {
        navigator.clipboard.writeText(shareText).then(() => {
            alert('Score copied to clipboard! Share it on your favorite social media.');
        }).catch(() => {
            const textArea = document.createElement('textarea');
            textArea.value = shareText;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            alert('Score copied to clipboard! Share it on your favorite social media.');
        });
    }
}

// Initialize game when page loads
window.addEventListener('load', () => {
    window.game = new FlappySlice();
});