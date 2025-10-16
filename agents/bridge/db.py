from __future__ import annotations

import aiosqlite
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from agents.shared.config import get_settings


@asynccontextmanager
async def db_connection() -> AsyncIterator[aiosqlite.Connection]:
  settings = get_settings()
  db_path = settings.podx_database_url
  if db_path.startswith("file:"):
    db_path = db_path.split("file:", 1)[1]
  db_file = Path(__file__).resolve().parent.parent.parent / db_path
  async with aiosqlite.connect(str(db_file)) as conn:
    conn.row_factory = aiosqlite.Row
    yield conn
