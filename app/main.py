from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.checklist import router as checklist_router, seed_if_empty
from app.conversations import router as conversations_router


@asynccontextmanager
async def lifespan(_):
    seed_if_empty()
    yield


app = FastAPI(title="CQA", lifespan=lifespan)
app.include_router(checklist_router)
app.include_router(conversations_router)
# Mounted last so /api/* routes win.
app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "web", html=True), name="web")
