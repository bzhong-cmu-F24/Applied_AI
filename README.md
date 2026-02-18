# AI Group Dining Planner

An AI-powered restaurant recommendation app for group dinners. Select friends, set dining preferences, and let the Claude agent find the perfect restaurant for everyone.

## Features

- **AI Agent** — Claude-powered multi-step reasoning with tool-use (search restaurants, calculate drive times, rank & score, fetch details)
- **Interactive Map** — Google Maps with friend locations, restaurant markers, and drive time overlays
- **Friend Locator Radar** — Animated radar scanning effect when the agent fetches friend locations
- **Real-time Chat** — Streaming chat UI with tool-call status cards and markdown rendering
- **Smart Ranking** — Considers cuisine preferences, allergies, drive times, ratings, and budget

## Architecture

```
frontend/          Next.js 16 + TypeScript + Tailwind CSS + Google Maps
backend/           Python FastAPI + Claude API (tool-use) + Google Maps/Yelp APIs
```

## Setup

### 1. API Keys

You need the following API keys:

| Key | Where to get it | Used for |
|-----|----------------|----------|
| `OPENAI_API_KEY` | [OpenAI Platform](https://platform.openai.com/api-keys) | Claude agent (GPT-4o) |
| `GOOGLE_MAPS_API_KEY` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | Places, Geocoding, Distance Matrix APIs |
| `YELP_API_KEY` | [Yelp Fusion](https://www.yelp.com/developers/v3/manage_app) | Restaurant reviews & menus (optional) |

Google Maps API needs these APIs enabled: **Places API**, **Geocoding API**, **Distance Matrix API**, **Maps JavaScript API**.

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:

```
OPENAI_API_KEY=sk-your-openai-key
GOOGLE_MAPS_API_KEY=your-google-maps-key
YELP_API_KEY=your-yelp-key
```

Start the server:

```bash
uvicorn main:app --reload --port 8001
```

### 3. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your-google-maps-key
NEXT_PUBLIC_API_URL=http://localhost:8001
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. **Select friends** from the dropdown (top-right)
2. **Set preferences** — cuisines, budget, occasion, max drive time
3. Click **Run Agent** — watch the AI work through its tool pipeline
4. Browse the **top 3 recommendations** on the map with drive times, ratings, and details
