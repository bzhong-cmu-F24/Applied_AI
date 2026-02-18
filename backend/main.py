"""
FastAPI server for the Group Dining Planner Agent.
Endpoints:
  GET  /api/friends        → list all friends in the DB
  POST /api/plan           → SSE stream of agent execution steps (supports sessions)
  DELETE /api/session/{id} → clear a session
  GET  /api/health         → health check
"""

import json
import os
import uuid

from dotenv import load_dotenv

load_dotenv()  # load .env before other imports use env vars

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from agent import run_agent, AgentSession
from tools import FRIENDS_DB

app = FastAPI(title="Group Dining Planner Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── In-memory session store ───
sessions: dict[str, AgentSession] = {}


class UserLocation(BaseModel):
    lat: float = 0
    lng: float = 0
    address: str = ""

class PlanRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    user_location: Optional[UserLocation] = None


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/friends")
async def list_friends():
    return FRIENDS_DB["friends"]


@app.post("/api/plan")
async def create_plan(req: PlanRequest):
    """Stream agent steps as Server-Sent Events. Supports multi-turn via session_id."""

    # Resolve or create session
    session_id = req.session_id
    if session_id and session_id in sessions:
        session = sessions[session_id]
    else:
        session_id = str(uuid.uuid4())[:8]
        session = None  # agent will create one

    async def event_stream():
        nonlocal session

        # Send session_id as first event
        yield f"data: {json.dumps({'type': 'session', 'content': session_id})}\n\n"

        loc_dict = req.user_location.model_dump() if req.user_location else None
        async for step_type, content in run_agent(req.message, session, user_location=loc_dict):
            # Capture the session reference from the agent
            if step_type == "_session_ref":
                session = content
                sessions[session_id] = session
                continue

            event = {"type": step_type, "content": content}
            yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.delete("/api/session/{session_id}")
async def clear_session(session_id: str):
    sessions.pop(session_id, None)
    return {"status": "cleared"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
