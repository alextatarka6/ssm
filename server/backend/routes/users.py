import os

import requests
from fastapi import APIRouter, HTTPException, Request
from psycopg.rows import dict_row

from ..db import DATABASE_URL, get_connection
from ..persist import persist_engine_results, sync_engine_from_database
from ..schemas import UserCreate

router = APIRouter(prefix="/users", tags=["users"])

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
def _soft_delete_postgres_user(conn, user_id: str) -> bool:
    cur = conn.cursor(row_factory=dict_row)
    try:
        cur.execute(
            """
            select
              id::text as id,
              deleted_at
            from public.profiles
            where id = %s::uuid
            limit 1
            """,
            (user_id,),
        )
        profile_row = cur.fetchone()
        if profile_row is None:
            return False
        if profile_row["deleted_at"] is not None:
            return True

        cur.execute(
            """
            update public.orders
            set status = 'CANCELED',
                remaining_qty = 0,
                updated_at = timezone('utc', now())
            where
              auth_user_id = %s::uuid
              and status in ('OPEN', 'PARTIALLY_FILLED')
              and remaining_qty > 0
            """,
            (user_id,),
        )

        cur.execute(
            """
            update public.holdings
            set reserved_shares = 0,
                updated_at = timezone('utc', now())
            where auth_user_id = %s::uuid
            """,
            (user_id,),
        )

        cur.execute(
            """
            delete from public.user_accounts
            where auth_user_id = %s::uuid
            """,
            (user_id,),
        )

        cur.execute(
            """
            update public.profiles
            set username = concat('deleted-', left(replace(id::text, '-', ''), 8)),
                email = null,
                deleted_at = coalesce(deleted_at, timezone('utc', now())),
                updated_at = timezone('utc', now())
            where id = %s::uuid
            """,
            (user_id,),
        )
        return True
    finally:
        cur.close()


@router.post("/", status_code=201)
def create_user(payload: UserCreate, request: Request) -> dict:
    engine = request.app.state.engine
    with get_connection() as conn:
        if getattr(conn, "is_sqlite", False):
            engine.set_user_default(payload.user_id, payload.initial_cash_cents)
            if engine.events:
                with conn.transaction():
                    persist_engine_results(conn, events=engine.events, order=None, trades=[], engine=engine)
                engine.events = []
        else:
            with conn.transaction():
                cur = conn.cursor()
                try:
                    # Derive a username fallback using the same logic as the Supabase trigger
                    username = payload.username
                    if not username:
                        username = (
                            payload.email.split("@")[0]
                            if payload.email
                            else payload.user_id.replace("-", "")[:8]
                        )

                    cur.execute(
                        """
                        insert into public.profiles (id, username, email)
                        values (%s::uuid, %s, %s)
                        on conflict (id) do update
                          set username   = case when public.profiles.deleted_at is null then excluded.username   else public.profiles.username end,
                              email      = case when public.profiles.deleted_at is null then excluded.email      else public.profiles.email    end,
                              updated_at = timezone('utc', now())
                        returning deleted_at
                        """,
                        (payload.user_id, username, payload.email),
                    )
                    row = cur.fetchone()
                    if row is not None and row[0] is not None:
                        raise HTTPException(status_code=410, detail="This profile has been deleted.")

                    cur.execute("SELECT public.ensure_initial_market_state_for_user(%s::uuid)", (payload.user_id,))
                finally:
                    cur.close()
            sync_engine_from_database(engine, conn)

    return {"ok": True}


@router.delete("/me", status_code=204)
def delete_current_user(request: Request) -> None:
    if DATABASE_URL is None or DATABASE_URL.startswith("sqlite://"):
        raise HTTPException(status_code=501, detail="Profile deletion is only available with Supabase.")

    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
        raise HTTPException(
            status_code=503,
            detail="Profile deletion is not configured on the server.",
        )

    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="You need to be signed in to delete your profile.")

    access_token = authorization.split(" ", 1)[1].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="You need to be signed in to delete your profile.")

    try:
        current_user_response = requests.get(
            f"{SUPABASE_URL.rstrip('/')}/auth/v1/user",
            headers={
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                "Authorization": f"Bearer {access_token}",
            },
            timeout=15,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Unable to verify your session right now.") from exc

    if current_user_response.status_code != 200:
        raise HTTPException(status_code=401, detail="Your session expired. Sign in again to delete your profile.")

    user_id = current_user_response.json().get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unable to verify the current user.")

    with get_connection() as conn:
        with conn.transaction():
            did_soft_delete = _soft_delete_postgres_user(conn, user_id)

        sync_engine_from_database(request.app.state.engine, conn)

    if not did_soft_delete:
        raise HTTPException(status_code=404, detail="Unable to find the current profile.")
