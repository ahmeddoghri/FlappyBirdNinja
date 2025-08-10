const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

// Shared game configuration to unify single and multiplayer feel
const GAME_CONFIG = {
    gravity: 0.3,
    jumpPower: -10,
    fruitGravity: 0.2,
    wallGapSize: 220,
    wallWidth: 40,
    wallSpawnIntervalMs: 4000,
    baseGameSpeed: 2,
};

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Game state management
const rooms = new Map();
const players = new Map();

class GameRoom {
    constructor(roomId, roomName, password = null) {
        this.roomId = roomId;
        this.roomName = roomName;
        this.password = password;
        this.players = new Map();
        this.gameState = 'waiting';
        this.createdAt = Date.now();
        this.maxPlayers = 4;
        this.gameStartTime = null;
        this.fruits = [];
        this.walls = [];
        this.gameLoop = null;
        this.lastFruitSpawn = 0;
        this.lastWallSpawn = 0;
        this.gameSpeed = GAME_CONFIG.baseGameSpeed;
    }
    
    addPlayer(playerId, socket) {
        if (this.players.size >= this.maxPlayers) {
            return { success: false, message: 'Room is full' };
        }
        
        const playerColors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1'];
        const playerIndex = this.players.size;
        
        this.players.set(playerId, {
            id: playerId,
            socket: socket,
            score: 0,
            combo: 0,
            player: {
                x: 150,
                y: 300,
                velocityY: 0,
                width: 40,
                height: 30,
                gravity: GAME_CONFIG.gravity,
                jumpPower: GAME_CONFIG.jumpPower,
                color: playerColors[playerIndex],
                character: 'ninja', // Default cute character
                customization: {
                    character: 'ninja',
                    color: playerColors[playerIndex],
                    accessory: 'none',
                    trail: 'sparkle'
                }
            },
            isReady: false,
            isAlive: true,
            lastUpdate: Date.now(),
            sabotageEffects: new Map() // For tracking active sabotage effects
        });
        
        return { success: true };
    }
    
    removePlayer(playerId) {
        this.players.delete(playerId);
        
        // If room is empty, mark for deletion
        if (this.players.size === 0) {
            this.shouldDelete = true;
            if (this.gameLoop) {
                clearInterval(this.gameLoop);
                this.gameLoop = null;
            }
        }
    }
    
    getPlayerCount() {
        return this.players.size;
    }
    
    broadcastToRoom(event, data, excludePlayerId = null) {
        this.players.forEach((player, playerId) => {
            if (playerId !== excludePlayerId) {
                player.socket.emit(event, data);
            }
        });
    }
    
    getGameState() {
        const players = {};
        this.players.forEach((player, playerId) => {
            players[playerId] = {
                score: player.score,
                combo: player.combo,
                player: player.player,
                isAlive: player.isAlive
            };
        });
        return { 
            players,
            fruits: this.fruits,
            walls: this.walls,
            gameState: this.gameState,
            gameSpeed: this.gameSpeed,
            gameConfig: GAME_CONFIG
        };
    }
    
    startGame() {
        if (this.gameState === 'playing') return;
        
        this.gameState = 'playing';
        this.gameStartTime = Date.now();
        this.lastFruitSpawn = Date.now();
        this.lastWallSpawn = Date.now();
        this.fruits = [];
        this.walls = [];
        
        // Reset all players
        this.players.forEach((player) => {
            player.player.y = 300;
            player.player.velocityY = 0;
            player.isAlive = true;
            player.score = 0;
            player.combo = 0;
        });
        
        // Start synchronized game loop
        this.gameLoop = setInterval(() => {
            this.updateGame();
        }, 1000/60); // 60 FPS
        
        this.broadcastToRoom('gameStarted', this.getGameState());
    }
    
    updateGame() {
        if (this.gameState !== 'playing') return;
        
        // Spawn fruits at synchronized intervals
        const now = Date.now();
        if (now - this.lastFruitSpawn > 1000 / this.gameSpeed) {
            this.spawnFruit();
            this.lastFruitSpawn = now;
        }
        
        // Spawn walls at synchronized intervals
        if (now - this.lastWallSpawn > GAME_CONFIG.wallSpawnIntervalMs) { // Configurable spacing
            this.spawnWall();
            this.lastWallSpawn = now;
        }
        
        // Update fruits
        this.fruits = this.fruits.filter(fruit => {
            // Remove sliced fruits after they've been processed for a short time
            if (fruit.sliced) {
                fruit.sliceTimer = (fruit.sliceTimer || 0) + 1;
                // Remove after 60 frames (~1 second at 60fps)
                if (fruit.sliceTimer > 60) {
                    return false;
                }
                return true; // Keep sliced fruits briefly for visual effects
            }
            
            // Store old position for collision detection
            const oldX = fruit.x;
            const oldY = fruit.y;
            
            // Update position
            fruit.x += fruit.velocityX;
            fruit.y += fruit.velocityY;
            fruit.rotation += fruit.rotationSpeed || 0.1;
            
            // Add fruit physics interactions with players
            this.players.forEach((player, playerId) => {
                if (!player.isAlive) return;
                
                // Check if fruit bounces off player (but doesn't kill them)
                if (this.checkCircleRectCollision(fruit, player.player)) {
                    // Calculate deflection angle
                    const dx = fruit.x - (player.player.x + player.player.width/2);
                    const dy = fruit.y - (player.player.y + player.player.height/2);
                    const distance = Math.sqrt(dx*dx + dy*dy);
                    
                    if (distance > 0) {
                        // Normalize and apply deflection
                        const normalX = dx / distance;
                        const normalY = dy / distance;
                        
                        // Deflect fruit away from player
                        fruit.velocityX = normalX * 4 + fruit.velocityX * 0.3;
                        fruit.velocityY = normalY * 4 + fruit.velocityY * 0.3;
                        
                        // Slightly deflect player trajectory
                        player.player.velocityY += normalY * 0.5;
                        
                        this.broadcastToRoom('fruitPlayerBounce', {
                            fruitId: fruit.id,
                            playerId: playerId,
                            x: fruit.x,
                            y: fruit.y
                        });
                    }
                }
            });
            
            // Apply gravity only to some fruits for more varied movement
            if (fruit.hasGravity) {
                fruit.velocityY += GAME_CONFIG.fruitGravity * 0.75; // Reduced gravity
            } else {
                // Add slight random velocity changes for more dynamic movement
                fruit.velocityX += (Math.random() - 0.5) * 0.1;
                fruit.velocityY += (Math.random() - 0.5) * 0.1;
            }
            
            // Check collision with walls - enhanced physics with proper separation
            this.walls.forEach(wall => {
                const collision = this.checkFruitWallCollisionDetailed(fruit, wall);
                if (collision.hasCollision) {
                    // Ensure proper separation from wall to prevent sticking
                    this.separateFruitFromWall(fruit, wall, collision);
                    
                    // Calculate reflection based on collision normal
                    const reflectionData = this.calculateFruitReflection(fruit, collision);
                    
                    // Apply reflection with energy loss
                    fruit.velocityX = reflectionData.velocityX * 0.85;
                    fruit.velocityY = reflectionData.velocityY * 0.85;
                    
                    // Ensure minimum velocity to prevent getting stuck
                    const minVel = 1.5;
                    if (Math.abs(fruit.velocityX) < minVel && Math.abs(fruit.velocityY) < minVel) {
                        fruit.velocityX = fruit.velocityX >= 0 ? minVel : -minVel;
                        fruit.velocityY = fruit.velocityY >= 0 ? minVel : -minVel;
                    }
                    
                    // Add rotational spin based on impact
                    fruit.rotationSpeed = (Math.random() - 0.5) * 0.4;
                    
                    // Broadcast bounce effect
                    this.broadcastToRoom('fruitBounce', {
                        fruitId: fruit.id,
                        x: fruit.x,
                        y: fruit.y,
                        side: collision.side,
                        wallType: wall.type
                    });
                }
            });
            
            // Check ball-to-ball collisions to prevent overlap
            for (let j = 0; j < this.fruits.length; j++) {
                if (j === this.fruits.indexOf(fruit)) continue; // Skip self
                const otherFruit = this.fruits[j];
                if (otherFruit.sliced) continue;
                
                const collision = this.checkBallToBallCollision(fruit, otherFruit);
                if (collision.hasCollision) {
                    this.handleBallToBallCollision(fruit, otherFruit, collision);
                }
            }
            
            // Bounce off screen boundaries with more energy
            if (fruit.y - fruit.radius < 0) {
                fruit.y = fruit.radius + 2; // Add buffer to prevent sticking
                fruit.velocityY = Math.abs(fruit.velocityY) * 0.9;
                fruit.velocityX += (Math.random() - 0.5) * 2; // Add horizontal randomness
            }
            if (fruit.y + fruit.radius > 600) {
                fruit.y = 600 - fruit.radius - 2; // Add buffer
                fruit.velocityY = -Math.abs(fruit.velocityY) * 0.9;
                fruit.velocityX += (Math.random() - 0.5) * 2; // Add horizontal randomness
            }
            
            // Bounce off left and right screen boundaries (instead of removing)
            if (fruit.x - fruit.radius < 0) {
                fruit.x = fruit.radius + 2;
                fruit.velocityX = Math.abs(fruit.velocityX) * 0.9;
                fruit.velocityY += (Math.random() - 0.5) * 2; // Add vertical randomness
            }
            if (fruit.x + fruit.radius > 800) {
                fruit.x = 800 - fruit.radius - 2;
                fruit.velocityX = -Math.abs(fruit.velocityX) * 0.9;
                fruit.velocityY += (Math.random() - 0.5) * 2; // Add vertical randomness
            }
            
            // Only remove fruits after they've been on screen for a while and are moving away
            const fruitAge = Date.now() - fruit.spawnTime;
            const shouldRemove = fruit.x < -fruit.radius * 2 && fruit.velocityX < 0 && fruitAge > 2000;
            return !shouldRemove && !fruit.sliced;
        });
        
        // Update walls
        this.walls = this.walls.filter(wall => {
            wall.x += wall.velocityX;
            
            // Remove walls that are off screen
            return wall.x > -wall.width;
        });
        
        // Check collisions for all alive players
        this.players.forEach((player, playerId) => {
            if (!player.isAlive) return;
            
            // Check fruit collisions (death)
            this.fruits.forEach(fruit => {
                if (!fruit.sliced && this.checkCircleCollision(player.player, fruit)) {
                    player.isAlive = false;
                    player.combo = 0;
                    this.broadcastToRoom('playerDied', {
                        playerId: playerId,
                        cause: 'fruit',
                        x: player.player.x,
                        y: player.player.y
                    });
                }
            });
            
            // Check wall collisions (death or shield)
            this.walls.forEach(wall => {
                if (this.checkWallCollision(player.player, wall)) {
                    if (player.player.hasShield) {
                        // Shield protects player - break shield and allow passage
                        player.player.hasShield = false;
                        
                        // Mark wall as broken by shield
                        wall.brokenByShield = true;
                        wall.breakTime = Date.now();
                        
                        // Broadcast shield break event
                        this.broadcastToRoom('shieldBreak', {
                            playerId: playerId,
                            x: player.player.x,
                            y: player.player.y,
                            wallId: wall.id
                        });
                        
                        // Push player slightly forward to ensure passage
                        player.player.velocityY = -3;
                        player.player.x += 5;
                    } else {
                        player.isAlive = false;
                        player.combo = 0;
                        this.broadcastToRoom('playerDied', {
                            playerId: playerId,
                            cause: 'wall',
                            x: player.player.x,
                            y: player.player.y
                        });
                    }
                }
            });
        });
        
        // Broadcast game state updates
        this.broadcastToRoom('gameUpdate', {
            fruits: this.fruits,
            walls: this.walls,
            timestamp: now
        });
    }
    
    spawnFruit() {
        const types = ['apple', 'orange', 'banana', 'bonus', 'destroyer', 'rainbow', 'chaos'];
        const weights = [35, 25, 20, 10, 5, 3, 2]; // Probability weights
        const type = this.weightedRandom(types, weights);
        
        // Create more varied initial velocities for multi-directional movement
        const angle = Math.random() * Math.PI * 2; // Random angle 0-360 degrees
        const speed = 2 + Math.random() * 3; // Speed between 2-5
        const initialVelX = Math.cos(angle) * speed;
        const initialVelY = Math.sin(angle) * speed;
        
        const fruit = {
            id: `fruit_${Date.now()}_${Math.random()}`,
            x: 850, // Start off-screen
            y: Math.random() * 400 + 100,
            radius: this.getFruitRadius(type),
            velocityX: initialVelX - this.gameSpeed * (type === 'chaos' ? 1.5 : 1), // Combine random motion with screen movement
            velocityY: initialVelY,
            color: this.getFruitColor(type),
            type: type,
            sliced: false,
            rotation: 0,
            spawnTime: Date.now(),
            special: ['destroyer', 'rainbow', 'chaos'].includes(type),
            pulsePhase: Math.random() * Math.PI * 2, // For visual effects
            trailParticles: [],
            hasGravity: Math.random() < 0.3 // Only 30% of balls have gravity
        };
        
        this.fruits.push(fruit);
    }
    
    getFruitRadius(type) {
        const radii = {
            apple: 20,
            orange: 20,
            banana: 22,
            bonus: 25,
            destroyer: 30,
            rainbow: 28,
            chaos: 24
        };
        return radii[type] || 20;
    }
    
    getFruitColor(type) {
        const colors = {
            apple: '#FF4444',
            orange: '#FF8844',
            banana: '#FFDD44',
            bonus: '#FF44FF',
            destroyer: '#FF0000',
            rainbow: '#FF0080',
            chaos: '#8000FF'
        };
        return colors[type] || '#44FF44';
    }
    
    weightedRandom(items, weights) {
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let random = Math.random() * totalWeight;
        
        for (let i = 0; i < items.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return items[i];
            }
        }
        
        return items[0];
    }
    
    sliceFruit(fruitId, playerId) {
        const fruit = this.fruits.find(f => f.id === fruitId && !f.sliced);
        if (!fruit) return null;
        
        const player = this.players.get(playerId);
        if (!player || !player.isAlive) return null;
        
        fruit.sliced = true;
        fruit.slicedBy = playerId;
        
        // Calculate base score
        let points = this.getBaseFruitPoints(fruit.type);
        if (player.combo > 0) {
            points += player.combo * 2;
        }
        
        player.score += points;
        player.combo++;
        
        // Special fruit effects
        const specialEffect = this.handleSpecialFruitEffects(fruit, playerId);
        
        return {
            points,
            newScore: player.score,
            newCombo: player.combo,
            fruit: fruit,
            specialEffect: specialEffect
        };
    }
    
    getBaseFruitPoints(type) {
        const pointValues = {
            apple: 10,
            orange: 10,
            banana: 15,
            bonus: 50,
            destroyer: 100,
            rainbow: 75,
            chaos: 25
        };
        return pointValues[type] || 10;
    }
    
    handleSpecialFruitEffects(fruit, playerId) {
        const effects = [];
        
        switch (fruit.type) {
            case 'bonus':
                this.gameSpeed = Math.min(this.gameSpeed + 0.1, 4);
                effects.push({ type: 'speedBoost', value: this.gameSpeed });
                break;
                
            case 'destroyer':
                // Destroy all nearby fruits without shade effect
                const nearbyFruits = this.fruits.filter(f => 
                    !f.sliced && 
                    f.id !== fruit.id && 
                    this.getDistance(f, fruit) < 150
                );
                
                nearbyFruits.forEach(f => {
                    f.sliced = true;
                    f.destroyedBy = 'destroyer';
                    const destroyerPlayer = this.players.get(playerId);
                    if (destroyerPlayer) {
                        destroyerPlayer.score += 5; // Bonus points for chain destruction
                    }
                });
                
                effects.push({ 
                    type: 'chainDestruction', 
                    destroyedFruits: nearbyFruits.map(f => f.id),
                    count: nearbyFruits.length
                });
                break;
                
            case 'rainbow':
                // Change background colors for all players
                const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
                const randomColor = colors[Math.floor(Math.random() * colors.length)];
                
                effects.push({ 
                    type: 'backgroundChange', 
                    color: randomColor,
                    duration: 5000 // 5 seconds
                });
                break;
                
            case 'chaos':
                // Sabotage ability - scramble other players' controls briefly
                const otherPlayers = Array.from(this.players.keys()).filter(id => id !== playerId);
                
                effects.push({ 
                    type: 'controlScramble', 
                    targetPlayers: otherPlayers,
                    duration: 2000 // 2 seconds
                });
                break;
        }
        
        // Broadcast special effects to all players
        if (effects.length > 0) {
            this.broadcastToRoom('specialFruitEffect', {
                fruitId: fruit.id,
                fruitType: fruit.type,
                playerId: playerId,
                effects: effects,
                x: fruit.x,
                y: fruit.y
            });
        }
        
        return effects;
    }
    
    getDistance(obj1, obj2) {
        const dx = obj1.x - obj2.x;
        const dy = obj1.y - obj2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    spawnWall() {
        const gapSize = GAME_CONFIG.wallGapSize; // Much larger gap for easier gameplay
        const wallWidth = GAME_CONFIG.wallWidth; // Thinner walls for better navigation
        const canvasHeight = 600;
        const gapY = Math.random() * (canvasHeight - gapSize - 120) + 60;
        
        // Choose random wall type for variety
        const wallTypes = ['crystal', 'tech', 'nature', 'neon'];
        const wallType = wallTypes[Math.floor(Math.random() * wallTypes.length)];
        
        const wall = {
            id: `wall_${Date.now()}_${Math.random()}`,
            x: 850,
            width: wallWidth,
            topHeight: gapY,
            bottomY: gapY + gapSize,
            bottomHeight: canvasHeight - (gapY + gapSize),
            velocityX: -this.gameSpeed,
            spawnTime: Date.now(),
            type: wallType
        };
        
        this.walls.push(wall);
    }
    
    checkCircleCollision(rect, circle) {
        // Check collision between rectangle (bird) and circle (fruit) - for death
        const distX = Math.abs(circle.x - rect.x - rect.width/2);
        const distY = Math.abs(circle.y - rect.y - rect.height/2);
        
        if (distX > (rect.width/2 + circle.radius)) return false;
        if (distY > (rect.height/2 + circle.radius)) return false;
        
        if (distX <= (rect.width/2)) return true;
        if (distY <= (rect.height/2)) return true;
        
        const dx = distX - rect.width/2;
        const dy = distY - rect.height/2;
        return (dx*dx + dy*dy <= (circle.radius*circle.radius));
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
    
    checkWallCollision(bird, wall) {
        // Skip collision detection for walls broken by shield
        if (wall.brokenByShield) {
            return false;
        }
        
        // Only check vertical wall collisions (left and right sides of pipes)
        const birdLeft = bird.x;
        const birdRight = bird.x + bird.width;
        const birdTop = bird.y;
        const birdBottom = bird.y + bird.height;
        
        const wallLeft = wall.x;
        const wallRight = wall.x + wall.width;
        
        // Check if bird hits the left side of the wall
        if (birdRight > wallLeft && birdLeft < wallLeft && 
            ((birdTop < wall.topHeight) || (birdBottom > wall.bottomY))) {
            return true;
        }
        
        // Check if bird hits the right side of the wall
        if (birdLeft < wallRight && birdRight > wallRight && 
            ((birdTop < wall.topHeight) || (birdBottom > wall.bottomY))) {
            return true;
        }
        
        return false;
    }
    
    checkFruitWallCollision(fruit, wall) {
        // Check if fruit collides with wall (top or bottom part)
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
    
    checkFruitWallCollisionDetailed(fruit, wall) {
        const fruitLeft = fruit.x - fruit.radius;
        const fruitRight = fruit.x + fruit.radius;
        const fruitTop = fruit.y - fruit.radius;
        const fruitBottom = fruit.y + fruit.radius;
        
        const wallLeft = wall.x;
        const wallRight = wall.x + wall.width;
        
        let hasCollision = false;
        let collisionSide = null;
        let penetrationDepth = 0;
        let normal = { x: 0, y: 0 };
        
        // Check if fruit is within wall's x range
        if (fruitRight > wallLeft && fruitLeft < wallRight) {
            // Check collision with top wall part
            if (fruitTop < wall.topHeight) {
                hasCollision = true;
                collisionSide = 'top';
                penetrationDepth = wall.topHeight - fruitTop;
                normal = { x: 0, y: -1 }; // Normal points downward from top wall
            }
            // Check collision with bottom wall part
            else if (fruitBottom > wall.bottomY) {
                hasCollision = true;
                collisionSide = 'bottom';
                penetrationDepth = fruitBottom - wall.bottomY;
                normal = { x: 0, y: 1 }; // Normal points upward from bottom wall
            }
        }
        
        // Check side collisions (left and right sides of wall)
        if (!hasCollision) {
            const fruitCenterY = fruit.y;
            // Only check side collisions if fruit is in the gap area
            if (fruitCenterY > wall.topHeight && fruitCenterY < wall.bottomY) {
                // Check left side collision
                if (fruitRight > wallLeft && fruit.x < wallLeft) {
                    hasCollision = true;
                    collisionSide = 'left';
                    penetrationDepth = fruitRight - wallLeft;
                    normal = { x: -1, y: 0 }; // Normal points left from wall
                }
                // Check right side collision
                else if (fruitLeft < wallRight && fruit.x > wallRight) {
                    hasCollision = true;
                    collisionSide = 'right';
                    penetrationDepth = wallRight - fruitLeft;
                    normal = { x: 1, y: 0 }; // Normal points right from wall
                }
            }
        }
        
        return {
            hasCollision,
            side: collisionSide,
            penetrationDepth,
            normal
        };
    }
    
    separateFruitFromWall(fruit, wall, collision) {
        // Move fruit out of wall by penetration depth plus a small buffer
        const buffer = 2; // Extra separation to prevent immediate re-collision
        const separation = collision.penetrationDepth + buffer;
        
        fruit.x -= collision.normal.x * separation;
        fruit.y -= collision.normal.y * separation;
    }
    
    calculateFruitReflection(fruit, collision) {
        // Calculate reflection using collision normal
        const normal = collision.normal;
        
        // Calculate dot product of velocity and normal
        const dotProduct = fruit.velocityX * normal.x + fruit.velocityY * normal.y;
        
        // Reflect velocity vector
        const reflectedX = fruit.velocityX - 2 * dotProduct * normal.x;
        const reflectedY = fruit.velocityY - 2 * dotProduct * normal.y;
        
        // Add some randomness to prevent predictable bouncing
        const randomFactor = 0.3;
        const randomX = (Math.random() - 0.5) * randomFactor;
        const randomY = (Math.random() - 0.5) * randomFactor;
        
        return {
            velocityX: reflectedX + randomX,
            velocityY: reflectedY + randomY
        };
    }
    
    checkBallToBallCollision(ball1, ball2) {
        const dx = ball2.x - ball1.x;
        const dy = ball2.y - ball1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = ball1.radius + ball2.radius;
        
        if (distance < minDistance && distance > 0) {
            const penetration = minDistance - distance;
            const normal = { x: dx / distance, y: dy / distance };
            
            return {
                hasCollision: true,
                penetration,
                normal,
                distance
            };
        }
        
        return { hasCollision: false };
    }
    
    handleBallToBallCollision(ball1, ball2, collision) {
        // Separate balls to prevent overlap
        const separationDistance = collision.penetration / 2 + 1; // Extra buffer
        
        ball1.x -= collision.normal.x * separationDistance;
        ball1.y -= collision.normal.y * separationDistance;
        ball2.x += collision.normal.x * separationDistance;
        ball2.y += collision.normal.y * separationDistance;
        
        // Calculate relative velocity
        const relativeVelX = ball2.velocityX - ball1.velocityX;
        const relativeVelY = ball2.velocityY - ball1.velocityY;
        
        // Calculate relative velocity along collision normal
        const velocityAlongNormal = relativeVelX * collision.normal.x + relativeVelY * collision.normal.y;
        
        // Don't resolve if velocities are separating
        if (velocityAlongNormal > 0) return;
        
        // Calculate restitution (bounciness) - increased for more energetic bounces
        const restitution = 0.85;
        
        // Calculate impulse scalar
        const impulseScalar = -(1 + restitution) * velocityAlongNormal;
        
        // Mass proportional to area
        const mass1 = ball1.radius * ball1.radius;
        const mass2 = ball2.radius * ball2.radius;
        const totalMass = mass1 + mass2;
        
        // Apply impulse
        const impulse1 = impulseScalar * mass2 / totalMass;
        const impulse2 = impulseScalar * mass1 / totalMass;
        
        ball1.velocityX -= impulse1 * collision.normal.x;
        ball1.velocityY -= impulse1 * collision.normal.y;
        ball2.velocityX += impulse2 * collision.normal.x;
        ball2.velocityY += impulse2 * collision.normal.y;
        
        // Add perpendicular velocity component for more varied bouncing
        const perpX = -collision.normal.y; // Perpendicular to collision normal
        const perpY = collision.normal.x;
        const perpImpulse = (Math.random() - 0.5) * 2; // Random perpendicular force
        
        ball1.velocityX += perpX * perpImpulse;
        ball1.velocityY += perpY * perpImpulse;
        ball2.velocityX -= perpX * perpImpulse;
        ball2.velocityY -= perpY * perpImpulse;
        
        // Reduced damping to maintain energy longer
        const damping = 0.98;
        ball1.velocityX *= damping;
        ball1.velocityY *= damping;
        ball2.velocityX *= damping;
        ball2.velocityY *= damping;
        
        // Ensure minimum velocity to keep balls moving
        const minSpeed = 1.0;
        const speed1 = Math.sqrt(ball1.velocityX * ball1.velocityX + ball1.velocityY * ball1.velocityY);
        const speed2 = Math.sqrt(ball2.velocityX * ball2.velocityX + ball2.velocityY * ball2.velocityY);
        
        if (speed1 < minSpeed && speed1 > 0) {
            ball1.velocityX = (ball1.velocityX / speed1) * minSpeed;
            ball1.velocityY = (ball1.velocityY / speed1) * minSpeed;
        }
        if (speed2 < minSpeed && speed2 > 0) {
            ball2.velocityX = (ball2.velocityX / speed2) * minSpeed;
            ball2.velocityY = (ball2.velocityY / speed2) * minSpeed;
        }
        
        // Broadcast ball collision event
        this.broadcastToRoom('ballCollision', {
            ball1Id: ball1.id,
            ball2Id: ball2.id,
            x: ball1.x + collision.normal.x * ball1.radius,
            y: ball1.y + collision.normal.y * ball1.radius
        });
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    socket.on('createRoom', ({ roomName, password }) => {
        try {
            // Check if room name already exists
            const existingRoom = Array.from(rooms.values()).find(room => room.roomName === roomName);
            if (existingRoom) {
                socket.emit('roomError', { message: 'Room name already exists' });
                return;
            }
            
            const roomId = generateRoomId();
            const room = new GameRoom(roomId, roomName, password);
            
            const result = room.addPlayer(socket.id, socket);
            if (!result.success) {
                socket.emit('roomError', { message: result.message });
                return;
            }
            
            rooms.set(roomId, room);
            players.set(socket.id, { roomId, playerId: socket.id });
            
            socket.join(roomId);
            socket.emit('roomCreated', { 
                roomId, 
                roomName,
                playerCount: room.getPlayerCount(),
                gameUrl: `${getBaseUrl()}/room/${roomId}`
            });
            
            console.log(`Room created: ${roomName} (${roomId}) by ${socket.id}`);
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('roomError', { message: 'Failed to create room' });
        }
    });
    
    socket.on('joinRoom', ({ roomName, password }) => {
        try {
            const room = Array.from(rooms.values()).find(r => r.roomName === roomName);
            if (!room) {
                socket.emit('roomError', { message: 'Room not found' });
                return;
            }
            
            if (room.password && room.password !== password) {
                socket.emit('roomError', { message: 'Incorrect password' });
                return;
            }
            
            const result = room.addPlayer(socket.id, socket);
            if (!result.success) {
                socket.emit('roomError', { message: result.message });
                return;
            }
            
            players.set(socket.id, { roomId: room.roomId, playerId: socket.id });
            
            socket.join(room.roomId);
            socket.emit('roomJoined', { 
                roomId: room.roomId,
                roomName: room.roomName,
                playerCount: room.getPlayerCount()
            });
            
            // Notify other players
            room.broadcastToRoom('playerJoined', { 
                playerId: socket.id,
                playerCount: room.getPlayerCount()
            }, socket.id);
            
            // Send current game state to new player
            socket.emit('gameState', room.getGameState());
            
            // If game is in progress, sync the new player
            if (room.gameState === 'playing') {
                socket.emit('gameStarted', room.getGameState());
            }
            
            console.log(`Player ${socket.id} joined room ${room.roomName}`);
        } catch (error) {
            console.error('Error joining room:', error);
            socket.emit('roomError', { message: 'Failed to join room' });
        }
    });
    
    socket.on('leaveRoom', ({ roomId }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            room.removePlayer(socket.id);
            players.delete(socket.id);
            
            socket.leave(roomId);
            
            // Notify other players
            room.broadcastToRoom('playerLeft', { 
                playerId: socket.id,
                playerCount: room.getPlayerCount()
            });
            
            // Clean up empty room
            if (room.shouldDelete) {
                rooms.delete(roomId);
                console.log(`Room ${roomId} deleted (empty)`);
            }
            
            console.log(`Player ${socket.id} left room ${roomId}`);
        } catch (error) {
            console.error('Error leaving room:', error);
        }
    });
    
    socket.on('playerUpdate', ({ roomId, player }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            const playerData = room.players.get(socket.id);
            if (!playerData) return;
            
            // Update player position and physics
            playerData.player.y = player.y;
            playerData.player.velocityY = player.velocityY;
            playerData.lastUpdate = Date.now();
            
            // Check for collision with ground
            if (player.y + player.height >= 600) {
                playerData.isAlive = false;
                playerData.combo = 0;
            }
            
            // Broadcast to other players in the room
            room.broadcastToRoom('playerMoved', {
                playerId: socket.id,
                player: playerData.player,
                isAlive: playerData.isAlive,
                score: playerData.score,
                combo: playerData.combo
            }, socket.id);
            
        } catch (error) {
            console.error('Error updating player:', error);
        }
    });
    
    socket.on('playerJump', ({ roomId }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            const playerData = room.players.get(socket.id);
            if (!playerData || !playerData.isAlive) return;
            
            // Apply jump
            playerData.player.velocityY = playerData.player.jumpPower;
            
            // Broadcast jump to other players
            room.broadcastToRoom('playerJumped', {
                playerId: socket.id,
                player: playerData.player
            }, socket.id);
            
        } catch (error) {
            console.error('Error handling jump:', error);
        }
    });
    
    socket.on('sliceFruit', ({ roomId, fruitId, sliceData }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            const result = room.sliceFruit(fruitId, socket.id);
            if (!result) return;
            
            // Broadcast slice to all players including the one who sliced
            room.broadcastToRoom('fruitSliced', {
                playerId: socket.id,
                fruitId: fruitId,
                points: result.points,
                newScore: result.newScore,
                newCombo: result.newCombo,
                sliceData: sliceData
            });
            
            // Also send to the player who made the slice
            socket.emit('fruitSliced', {
                playerId: socket.id,
                fruitId: fruitId,
                points: result.points,
                newScore: result.newScore,
                newCombo: result.newCombo,
                sliceData: sliceData
            });
            
        } catch (error) {
            console.error('Error handling fruit slice:', error);
        }
    });
    
    socket.on('startGame', ({ roomId }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            // Only room creator can start the game
            const playerData = room.players.get(socket.id);
            if (!playerData) return;
            
            room.startGame();
            
        } catch (error) {
            console.error('Error starting game:', error);
        }
    });
    
    socket.on('playerReady', ({ roomId, isReady }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            const playerData = room.players.get(socket.id);
            if (!playerData) return;
            
            playerData.isReady = isReady;
            
            // Check if all players are ready
            const allReady = Array.from(room.players.values()).every(p => p.isReady);
            
            room.broadcastToRoom('playerReadyUpdate', {
                playerId: socket.id,
                isReady: isReady,
                allReady: allReady && room.players.size > 1
            });
            
        } catch (error) {
            console.error('Error updating ready state:', error);
        }
    });
    
    socket.on('updateCustomization', ({ roomId, customization }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            const playerData = room.players.get(socket.id);
            if (!playerData) return;
            
            // Update player customization
            if (customization.character) playerData.player.customization.character = customization.character;
            if (customization.color) playerData.player.customization.color = customization.color;
            if (customization.accessory) playerData.player.customization.accessory = customization.accessory;
            if (customization.trail) playerData.player.customization.trail = customization.trail;
            
            // Update main color for compatibility
            if (customization.color) playerData.player.color = customization.color;
            
            // Broadcast customization update to all players
            room.broadcastToRoom('playerCustomizationUpdate', {
                playerId: socket.id,
                customization: playerData.player.customization
            });
            
        } catch (error) {
            console.error('Error updating customization:', error);
        }
    });
    
    socket.on('disconnect', () => {
        try {
            const playerInfo = players.get(socket.id);
            if (playerInfo) {
                const room = rooms.get(playerInfo.roomId);
                if (room) {
                    room.removePlayer(socket.id);
                    
                    // Notify other players
                    room.broadcastToRoom('playerLeft', { 
                        playerId: socket.id,
                        playerCount: room.getPlayerCount()
                    });
                    
                    // Clean up empty room
                    if (room.shouldDelete) {
                        rooms.delete(playerInfo.roomId);
                        console.log(`Room ${playerInfo.roomId} deleted (empty)`);
                    }
                }
                
                players.delete(socket.id);
            }
            
            console.log(`Player disconnected: ${socket.id}`);
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });
});

// Utility functions
function generateRoomId() {
    return Math.random().toString(36).substring(2, 11);
}

function getBaseUrl() {
    return process.env.NGROK_URL || 
           (process.env.NODE_ENV === 'production' 
               ? 'https://your-domain.com' 
               : `http://localhost:${PORT}`);
}

// Room cleanup - remove empty rooms every 5 minutes
setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, roomId) => {
        // Remove rooms that have been empty for more than 5 minutes
        if (room.players.size === 0 && now - room.createdAt > 5 * 60 * 1000) {
            rooms.delete(roomId);
            console.log(`Cleaned up empty room: ${roomId}`);
        }
    });
}, 5 * 60 * 1000);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeRooms: rooms.size,
        activePlayers: players.size
    });
});

// Room info endpoint
app.get('/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const room = rooms.get(roomId);
    
    if (!room) {
        return res.redirect('/');
    }
    
    // Serve the main game page
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API endpoint to get room info
app.get('/api/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const room = rooms.get(roomId);
    
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    
    res.json({
        roomId: room.roomId,
        roomName: room.roomName,
        playerCount: room.getPlayerCount(),
        maxPlayers: room.maxPlayers,
        gameState: room.gameState
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Flappy Slice server running on port ${PORT}`);
    console.log(`📱 Game URL: http://localhost:${PORT}`);
    console.log(`🎮 Ready for multiplayer gaming!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});