# HopIt

**Turn a hand-drawn sketch into a playable platformer level in seconds.**

> 🎮 **Live demo → [hopit.us](https://hopit.us)**

Sketch a level on grid paper, snap a photo, and HopIt converts it into a fully playable browser game — complete with AI solvability analysis and an adaptive Hard Mode that remixes the level based on exactly where you died.

---

## Features

- **Sketch → Play** — Upload a photo of any hand-drawn grid and play it instantly
- **Live Editor** — Paint and erase tiles directly on the canvas
- **K2 Think Analysis** — Streaming AI reasoning verifies if your level is beatable and flags design issues
- **Hard Mode** — Claude remixes your level with walkers, saws, crumble tiles, and flyers targeted at your death spots
- **Physics Tuner** — Adjust gravity, jump strength, speed, and friction in real time
- **Auto Mode** — Built-in decision-tree AI plays the level for you

---

## Drawing symbols

| Draw this | Tile |
|-----------|------|
| Filled / shaded rectangle | Platform |
| Triangle △ | Spike (instant death) |
| Circle ○ | Player spawn |
| Star ★ | Goal (finish) |

---

## Running locally

### Prerequisites

- **Node.js 18+**
- **Gemini API key** — [Get one free at Google AI Studio](https://aistudio.google.com/app/apikey) (image → level conversion)
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com) (Hard Mode remixing)
- **K2 Think API key** — [api.k2think.ai](https://api.k2think.ai) (optional — solvability analysis panel)

### 1. Clone & install

```bash
git clone https://github.com/merkusvictory/platformer-level-builder.git
cd platformer-level-builder

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### 2. Configure environment variables

```bash
# From the repo root
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit **`backend/.env`**:

```env
# Required — converts uploaded images to level grids
GEMINI_API_KEY=your_gemini_key_here

# Required — powers Hard Mode level remixing (Claude Haiku)
ANTHROPIC_API_KEY=your_anthropic_key_here

# Optional — enables the K2 Think solvability analysis panel
K2_API_KEY=your_k2_key_here
K2_API_BASE_URL=https://api.k2think.ai/v1

# Leave as-is for local dev; set to your Vercel URL in production
FRONTEND_URL=http://localhost:5173

# Port (default 3000)
PORT=3000
```

Edit **`frontend/.env`**:

```env
# Leave empty for local dev — Vite proxy forwards /api to localhost:3000
# Set to your Render backend URL for production
VITE_API_URL=
```

### 3. Start the servers

Open two terminals:

```bash
# Terminal 1 — backend (port 3000)
cd backend
node server.js

# Terminal 2 — frontend (port 5173)
cd frontend
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)**.

The Vite dev server automatically proxies `/upload`, `/verify`, and `/api` to the backend — no CORS issues, no extra config.

---

## Project structure

```
platformer-level-builder/
├── backend/
│   ├── server.js                   # Express API — /upload /verify /api/levels/hard-mode
│   ├── .env.example                # All environment variables with descriptions
│   ├── render.yaml                 # Render deployment config
│   └── src/
│       ├── geminiPipeline.js       # Gemini Vision → level JSON
│       ├── levelConverter.js       # Pipeline orchestration
│       ├── verificationEngine.js   # BFS reachability + K2 Think streaming
│       ├── hardModeEngine.js       # Deterministic hard mode fallback
│       ├── agents/
│       │   └── hardModeAgent.js    # Claude Haiku hard-mode remixer
│       └── config.js               # Grid dimensions (50×35)
└── frontend/
    ├── vite.config.js              # Dev proxy → localhost:3000
    ├── .env.example                # Frontend environment variables
    ├── vercel.json                 # SPA rewrite rule for Vercel
    └── src/
        ├── pages/
        │   ├── Upload.jsx          # Upload, camera capture, demo picker
        │   ├── Processing.jsx      # Upload progress
        │   └── Play.jsx            # Game engine — canvas, physics, AI, editor
        ├── data/demoLevels.js      # 5 built-in demo levels
        └── components/             # Aurora, SplitText, StarBorder UI primitives
```

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Multipart image → SSE stream → level JSON |
| `POST` | `/verify` | SSE stream — BFS + K2 Think solvability verdict |
| `POST` | `/api/levels/hard-mode` | Claude hard-mode remix (deterministic fallback) |
| `GET`  | `/health` | Health check |

---

## Tile reference

| Value | Tile |
|-------|------|
| `0` / `""` | Empty |
| `"T"` / `1` | Platform |
| `"S"` | Spike |
| `"C"` | Coin |
| `"G"` | Goal |
| `"P"` | Player spawn |
| `"W"` | Walker enemy |
| `"F"` | Flyer enemy |
| `"Z"` | Saw blade |
| `"B"` | Crumble platform |
| `"J"` | Spring |

---

## Controls

| Input | Action |
|-------|--------|
| Arrow keys / WASD | Move |
| Space / Up / W | Jump |
| R | Respawn |

**Edit mode** (click ✏ EDIT): click or drag to paint tiles, right-click to erase, Ctrl+Z to undo.

---

## Deployment

### Frontend → Vercel

| Setting | Value |
|---------|-------|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| `VITE_API_URL` | Your Render backend URL |

### Backend → Render

| Setting | Value |
|---------|-------|
| Root directory | `backend` |
| Build command | `npm install` |
| Start command | `node server.js` |
| Env vars | Same as `backend/.env.example` |

> **Deploy order:** Render first → copy URL → set `VITE_API_URL` in Vercel → deploy Vercel → copy URL → set `FRONTEND_URL` in Render → redeploy Render.

---

## Tech stack

| Layer | Stack |
|-------|-------|
| Frontend | React 19, Vite, Tailwind CSS 4, Framer Motion, HTML5 Canvas |
| Backend | Node.js, Express 5, Multer, Sharp |
| Vision AI | Gemini 2.5 Flash — image to level grid |
| Hard Mode AI | Claude Haiku (Anthropic) — adaptive level remixing |
| Solvability AI | K2 Think V2 (MBZUAI) — streaming BFS reasoning |
