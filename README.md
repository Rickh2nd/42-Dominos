# 42 Dominio Saloon (3D Prototype)

A 4-player online Forty-Two domino game prototype with:

- 3D smoky saloon table presentation (Three.js)
- 4 seats with hot-swappable human/bot players
- CPU fill for missing seats (5 difficulty levels)
- Bid + trump side controls
- Click or drag dominoes to play
- WebSocket multiplayer server (internet-capable when hosted)

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000` in up to 4 browsers/devices.

## Rules basis

Uses the Forty-Two rules from: https://www.dominorules.com/forty-two

Implemented core behavior:
- 4 players, 2 teams, double-six set, 7 tricks
- Bidding 30-42, clockwise, one bid per player
- Trump chosen by winning bidder
- Trump suit overrides non-trump suit identity
- Follow suit based on highest end of the lead tile (unless lead tile includes trump)
- Trick + count-tile scoring (42 total hand points)
- Match target 250 points
- Same-hand 250 tie breaks to bidding team

Current simplification/variant:
- If all four players pass, this prototype uses the optional "dealer forced to 30" rule instead of redeal.

## Files

- `server/server.js` - Express + WebSocket authoritative game server
- `shared/fortyTwo.js` - Forty-Two game engine and bot AI
- `client/main.js` - 3D scene, interaction, multiplayer UI
- `client/styles.css` - saloon-themed interface styling
