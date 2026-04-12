import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

DOTENV_PATH = Path(__file__).resolve().parent / ".env"
if DOTENV_PATH.exists():
    load_dotenv(DOTENV_PATH)

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be set for the FastAPI backend")


def get_connection():
    return psycopg.connect(DATABASE_URL)
