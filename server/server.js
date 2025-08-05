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

const PORT = process.env.PORT || 3000;

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
    }
    
    addPlayer(playerId, socket) {
        if (this.players.size >= this.maxPlayers) {
            return { success: false, message: 'Room is full' };
        }
        
        this.players.set(playerId, {
            id: playerId,
            socket: socket,
            score: 0,
            combo: 0,
            player: {
                x: 150,
                y: 300,
                velocityY: 0
            },
            isReady: false
        });
        
        return { success: true };
    }
    
    removePlayer(playerId) {
        this.players.delete(playerId);
        
        // If room is empty, mark for deletion
        if (this.players.size === 0) {
            this.shouldDelete = true;
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
        const opponents = {};
        this.players.forEach((player, playerId) => {
            opponents[playerId] = {
                score: player.score,
                combo: player.combo,
                player: player.player
            };
        });
        return { opponents };
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
    
    socket.on('playerUpdate', ({ roomId, score, combo, player }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            const playerData = room.players.get(socket.id);
            if (!playerData) return;
            
            // Update player data
            playerData.score = score;
            playerData.combo = combo;
            playerData.player = player;
            
            // Broadcast to other players in the room
            room.broadcastToRoom('opponentUpdate', {
                playerId: socket.id,
                score: score,
                combo: combo,
                player: player
            }, socket.id);
            
        } catch (error) {
            console.error('Error updating player:', error);
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
    return Math.random().toString(36).substr(2, 9);
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