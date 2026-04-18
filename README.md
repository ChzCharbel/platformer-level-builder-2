# Platformer Level Builder

Turn a hand-drawn sketch into a playable platformer level in seconds — powered by Gemini Vision AI.

![workflow: sketch → photo → play](https://img.shields.io/badge/workflow-sketch%20→%20photo%20→%20play-orange)

## What it does

1. **Sketch** a platformer level on grid paper using simple symbols
2. **Upload** a photo of your sketch (or capture it with your camera)
3. **Gemini 2.5 Flash** detects platforms, spikes, coins, goal, and player spawn from the image
4. **Play** the generated level instantly in the browser
5. **Edit** the level live — add or remove tiles directly on the canvas
6. **Analyze** with K2 Think AI to check solvability and get design suggestions

## Symbols for sketching

| Symbol | Meaning |
|--------|---------|
| Filled square | Platform tile |
| Triangle | Spike (instant death) |
| Circle | Coin (collectible) |
| Star | Goal (finish line) |
| Dot / mark | Player spawn point |

## Getting started

### Prerequisites

- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/app/apikey)
- A K2 Think API key (optional — needed for solvability analysis)

### Setup

```bash
# 1. Install backend dependencies
npm install

# 2. Install frontend dependencies
cd frontend && npm install && cd ..

# 3. Create .env in the project root
cp .env.example .env
# Fill in your API keys (see Environment variables below)
```

### Running locally

```bash
# Terminal 1 — backend (port 3000)
npm start

# Terminal 2 — frontend dev server (port 5173)
cd frontend && npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The Vite dev server proxies `/upload` and `/verify` to the backend automatically.

### Environment variables

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key_here

K2_API_KEY=your_k2_api_key_here
K2_API_BASE_URL=https://api.k2think.ai/v1
```

## Project structure

```
platformer-level-builder/
├── frontend/               # React + Vite app (port 5173)
│   └── src/
│       ├── App.jsx
│       └── pages/
│           ├── Upload.jsx      # Photo upload / camera capture
│           ├── Processing.jsx  # AI conversion progress
│           └── Play.jsx        # Game canvas + live editor
├── src/
│   ├── geminiPipeline.js   # Gemini Vision image → level JSON
│   ├── levelConverter.js   # Conversion orchestration
│   ├── verificationEngine.js # K2 solvability analysis
│   ├── imageProcessor.js   # Image preprocessing (sharp)
│   ├── validator.js        # Grid validation
│   └── config.js           # Grid dimensions (50×35)
├── server.js               # Express API (port 3000)
└── index.js                # CLI entry point
```

## Level format

Levels are stored in `localStorage` as JSON and use a 50-column × 35-row grid:

```json
{
  "width": 50,
  "height": 35,
  "data": [
    [0, 1, 1, "S", "C", "G", "P", ...]
  ],
  "playerStart": { "row": 26, "col": 4 },
  "goal":        { "row": 16, "col": 20 }
}
```

| Value | Tile |
|-------|------|
| `0` | Empty |
| `1` / `"T"` | Platform |
| `"S"` | Spike |
| `"C"` | Coin |
| `"G"` | Goal |
| `"P"` | Player spawn |

## In-game controls

| Key | Action |
|-----|--------|
| Arrow keys / WASD | Move |
| Space / Up / W | Jump |
| R | Respawn |

## Live editor

Click the **✏ EDIT** button in the top bar to enter edit mode:

- **Click or drag** on the canvas to paint tiles
- **Right-click** to erase
- **Ctrl+Z** to undo (up to 50 steps)
- Select a tool from the left panel: Platform, Spike, Coin, Goal, Spawn Point, Eraser
- Click **Save & Play** to save and restart the level, or **Cancel** to discard changes

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload an image; returns level JSON |
| `POST` | `/verify` | Stream K2 solvability analysis (SSE) |

## Tech stack

**Frontend** — React 19, Vite, Tailwind CSS 4, Framer Motion, HTML5 Canvas

**Backend** — Node.js, Express, Multer, Sharp

**AI** — Gemini 2.5 Flash (image → level), K2 Think V2 (solvability reasoning)
