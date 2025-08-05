# FlappyBird Ninja - Multiplayer Setup

## Quick Start

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Start the server**:
   ```bash
   npm start
   ```

3. **Open the game** in your browser:
   ```
   http://localhost:3001
   ```

## How to Play Multiplayer

### Creating a Room
1. Click "Multiplayer" 
2. Enter a room name (and optional password)
3. Click "Create Room"
4. Share the generated URL with friends (up to 4 players total)

### Joining a Room
1. Click "Multiplayer"
2. Enter the room name (and password if required)
3. Click "Join Room"

### Starting the Game
1. All players click "Ready" 
2. Game starts automatically when everyone is ready
3. Players see each other in real-time with different colors

## Game Features

### Real-time Multiplayer
- ✅ Up to 4 players per room
- ✅ Synchronized fruit spawning
- ✅ Real-time player movements
- ✅ Shared game state
- ✅ Live scoring and combo tracking

### Controls
- **Space Bar** or **Tap**: Make your bird jump
- **Mouse/Touch**: Slice fruits with gesture trails
- **Ready Button**: Mark yourself as ready to start

### Network Features
- Optimized for low latency (~60fps sync)
- Automatic room cleanup
- Shareable room URLs
- Password protection for private games

## Hosting for Friends

### Local Network
Your friends can join using your local IP:
```
http://YOUR_IP_ADDRESS:3001
```

### Internet Access (Advanced)
For internet access, consider using:
- **ngrok**: `ngrok http 3001`
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3001`
- **Port forwarding** on your router

## Performance Tips

- Game runs at 60 FPS for smooth multiplayer
- Network updates are throttled for optimal performance
- Automatic fruit synchronization across all players
- Visual effects for other players' actions

## Troubleshooting

- **Can't connect**: Check firewall settings
- **Lag issues**: Ensure stable internet connection
- **Room not found**: Verify room name spelling
- **Game not starting**: All players must be ready

Enjoy your multiplayer FlappyBird Ninja experience! 🎮🥷