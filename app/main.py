import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import schedule
from app.agent import router as agent_router
from app.appeals import router as appeals_router
from app.checklist import router as checklist_router, seed_if_empty
from app.conversations import router as conversations_router
from app.evaluate import router as evaluate_router


@asynccontextmanager
async def lifespan(_):
    seed_if_empty()
    task = asyncio.create_task(schedule.loop())
    yield
    task.cancel()


app = FastAPI(title="CQA", lifespan=lifespan)
app.include_router(checklist_router)
app.include_router(conversations_router)
app.include_router(evaluate_router)
app.include_router(appeals_router)
app.include_router(agent_router)
app.include_router(schedule.router)
# Mounted last so /api/* routes win.
app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "web", html=True), name="web")