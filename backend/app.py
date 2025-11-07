import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from sqlalchemy import text

from db import create_db_and_tables, get_session, engine
from models import Entry
from report import generate_and_send_weekly_report
from schemas import (
    BulkUpsertRequest,
    BulkUpsertResponse,
    EntryResponse,
    SummaryRow,
    WeekSummaryResponse,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Cache for time_period column check
_time_period_exists = None

def create_entry_from_row(row, include_time_period: bool = False) -> object:
    """Create an Entry-like object from a database row.
    
    Args:
        row: Database row tuple
        include_time_period: If True, expects time_period as row[8], shifts other fields
    """
    entry = type('Entry', (), {})()
    entry.id = row[0]
    entry.user_key = row[1]
    entry.user_name = row[2]
    entry.date = row[3]
    entry.location = row[4]
    if include_time_period and len(row) > 8:
        # Row includes time_period: id, user_key, user_name, date, location, time_period, client, notes, created_at, updated_at
        # Normalize empty string to None for consistency
        entry.time_period = None if (not row[5] or row[5] == '') else row[5]
        entry.client = row[6]
        entry.notes = row[7]
        entry.created_at = row[8]
        entry.updated_at = row[9]
    else:
        # Row doesn't include time_period: id, user_key, user_name, date, location, client, notes, created_at, updated_at
        entry.time_period = None
        entry.client = row[5]
        entry.notes = row[6]
        entry.created_at = row[7]
        entry.updated_at = row[8]
    return entry

def check_time_period_column_exists(session: Session = None) -> bool:
    """Check if time_period column exists in entry table."""
    global _time_period_exists
    if _time_period_exists is not None:
        return _time_period_exists
    
    try:
        is_postgres = "postgresql" in str(engine.url).lower()
        if is_postgres:
            result = engine.connect().execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'entry' AND column_name = 'time_period'
            """))
            _time_period_exists = result.fetchone() is not None
        else:
            result = engine.connect().execute(text("PRAGMA table_info(entry)"))
            columns = [row[1] for row in result.fetchall()]
            _time_period_exists = 'time_period' in columns
    except Exception as e:
        logger.warning(f"Could not check time_period column: {e}")
        _time_period_exists = False
    
    return _time_period_exists


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    create_db_and_tables()
    
    # Run migrations if needed
    try:
        import sys
        import os
        migrations_path = os.path.join(os.path.dirname(__file__), 'migrations')
        if os.path.exists(migrations_path):
            from db import engine
            # Run migration 001: Add user_key constraint
            try:
                from migrations.migrate_001_add_user_key_constraint import migrate as migrate_001
                migrate_001(engine)
            except ImportError as e:
                logger.debug(f"Migration 001 module not found: {e}")
            except Exception as e:
                logger.warning(f"Migration 001 check failed (may already be applied): {str(e)}")
            
            # Run migration 002: Add time_period
            try:
                logger.info("Attempting to run migration 002 (time_period)...")
                from migrations.migrate_002_add_time_period import migrate as migrate_002
                migrate_002(engine)
                logger.info("Migration 002 completed (check logs above for details)")
            except ImportError as e:
                logger.debug(f"Migration 002 module not found: {e}")
            except Exception as e:
                logger.error(f"Migration 002 failed: {str(e)}")
                # Don't raise - allow app to start, but log the error clearly
                import traceback
                logger.error(f"Migration 002 traceback: {traceback.format_exc()}")
    except Exception as e:
        logger.warning(f"Migration check failed: {str(e)}")
    
    logger.info("Database initialized")
    yield


# Create FastAPI app
app = FastAPI(title="Work Location Tracker API", version="1.0.0", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/entries/bulk_upsert", response_model=BulkUpsertResponse)
def bulk_upsert_entries(
    request: BulkUpsertRequest, session: Session = Depends(get_session)
):
    """Bulk upsert entries for a user using atomic per-day upserts (no destructive deletes)."""
    if not request.entries:
        raise HTTPException(status_code=400, detail="No entries provided")
    
    # Normalize user identity once
    user_key = request.user_name.strip().lower()
    logger.info(f"Bulk upsert request for user_key: {user_key} (display: {request.user_name})")

    try:
        from sqlalchemy import text
        from datetime import UTC, datetime
        
        # Use single transaction for atomicity
        count = 0
        
        # Check if time_period column exists
        time_period_exists = check_time_period_column_exists()
        logger.info(f"time_period column exists: {time_period_exists}")
        
        # Check if PostgreSQL (for ON CONFLICT) or SQLite (use merge pattern)
        is_postgres = False
        try:
            if hasattr(session.bind, 'url'):
                is_postgres = "postgresql" in str(session.bind.url).lower()
            else:
                # Fallback: check engine URL
                from db import engine
                is_postgres = "postgresql" in str(engine.url).lower()
        except Exception:
            pass  # Default to SQLite pattern
        
        for entry_data in request.entries:
            # Validate entry
            if not entry_data.date:
                continue
                
            # Use current timestamp for created_at/updated_at
            now = datetime.now(UTC)
            
            if is_postgres:
                if time_period_exists:
                    # PostgreSQL: Use INSERT ... ON CONFLICT DO UPDATE with time_period
                    # Normalize None to empty string for consistency with migration
                    time_period_value = entry_data.time_period if entry_data.time_period is not None else ''
                    logger.info(f"Saving entry: date={entry_data.date}, location={entry_data.location}, time_period={time_period_value}")
                    result = session.execute(
                        text("""
                            INSERT INTO entry (user_key, user_name, date, location, time_period, client, notes, created_at, updated_at)
                            VALUES (:user_key, :user_name, :date, :location, :time_period, :client, :notes, :created_at, :updated_at)
                            ON CONFLICT (user_key, date, time_period) DO UPDATE
                            SET user_name = EXCLUDED.user_name,
                                location = EXCLUDED.location,
                                client = EXCLUDED.client,
                                notes = EXCLUDED.notes,
                                updated_at = EXCLUDED.updated_at
                        """),
                        {
                            "user_key": user_key,
                            "user_name": request.user_name.strip(),
                            "date": entry_data.date,
                            "location": entry_data.location,
                            "time_period": time_period_value,
                            "client": entry_data.client,
                            "notes": entry_data.notes,
                            "created_at": now,
                            "updated_at": now,
                        }
                    )
                else:
                    # PostgreSQL: Use INSERT ... ON CONFLICT DO UPDATE without time_period
                    result = session.execute(
                        text("""
                            INSERT INTO entry (user_key, user_name, date, location, client, notes, created_at, updated_at)
                            VALUES (:user_key, :user_name, :date, :location, :client, :notes, :created_at, :updated_at)
                            ON CONFLICT (user_key, date) DO UPDATE
                            SET user_name = EXCLUDED.user_name,
                                location = EXCLUDED.location,
                                client = EXCLUDED.client,
                                notes = EXCLUDED.notes,
                                updated_at = EXCLUDED.updated_at
                        """),
                        {
                            "user_key": user_key,
                            "user_name": request.user_name.strip(),
                            "date": entry_data.date,
                            "location": entry_data.location,
                            "client": entry_data.client,
                            "notes": entry_data.notes,
                            "created_at": now,
                            "updated_at": now,
                        }
                    )
                count += result.rowcount if result.rowcount else 1
            else:
                # SQLite: Use ORM merge pattern (select, update or insert)
                # Normalize None to empty string for consistency
                time_period_value = entry_data.time_period if entry_data.time_period is not None else ''
                
                if time_period_exists:
                    existing = session.exec(
                        select(Entry)
                        .where(Entry.user_key == user_key)
                        .where(Entry.date == entry_data.date)
                        .where(Entry.time_period == time_period_value)
                    ).first()
                else:
                    # Use raw SQL to check existing entry
                    result = session.execute(text("""
                        SELECT id, user_key, user_name, date, location, client, notes, created_at, updated_at
                        FROM entry
                        WHERE user_key = :user_key AND date = :date
                    """), {"user_key": user_key, "date": entry_data.date})
                    row = result.fetchone()
                    existing = type('Entry', (), {
                        "id": row[0], "user_key": row[1], "user_name": row[2],
                        "date": row[3], "location": row[4], "client": row[5],
                        "notes": row[6], "created_at": row[7], "updated_at": row[8],
                    })() if row else None
                
                if existing:
                    # Update existing
                    if time_period_exists:
                        existing.user_name = request.user_name.strip()
                        existing.location = entry_data.location
                        existing.time_period = time_period_value
                        existing.client = entry_data.client
                        existing.notes = entry_data.notes
                        existing.updated_at = now
                    else:
                        # Use raw SQL to update
                        session.execute(text("""
                            UPDATE entry
                            SET user_name = :user_name, location = :location,
                                client = :client, notes = :notes, updated_at = :updated_at
                            WHERE id = :id
                        """), {
                            "id": existing.id,
                            "user_name": request.user_name.strip(),
                            "location": entry_data.location,
                            "client": entry_data.client,
                            "notes": entry_data.notes,
                            "updated_at": now,
                        })
                else:
                    # Insert new
                    if time_period_exists:
                        new_entry = Entry(
                            user_key=user_key,
                            user_name=request.user_name.strip(),
                            date=entry_data.date,
                            location=entry_data.location,
                            time_period=time_period_value,
                            client=entry_data.client,
                            notes=entry_data.notes,
                            created_at=now,
                            updated_at=now,
                        )
                        session.add(new_entry)
                    else:
                        # Use raw SQL to insert
                        session.execute(text("""
                            INSERT INTO entry (user_key, user_name, date, location, client, notes, created_at, updated_at)
                            VALUES (:user_key, :user_name, :date, :location, :client, :notes, :created_at, :updated_at)
                        """), {
                            "user_key": user_key,
                            "user_name": request.user_name.strip(),
                            "date": entry_data.date,
                            "location": entry_data.location,
                            "client": entry_data.client,
                            "notes": entry_data.notes,
                            "created_at": now,
                            "updated_at": now,
                        })
                count += 1
        
        # Single commit for all operations (atomic)
        session.commit()
        
        logger.info(
            f"Successfully upserted {count} entries for user_key: {user_key} "
            f"(display: {request.user_name})"
        )
        return BulkUpsertResponse(ok=True, count=count)

    except Exception as e:
        session.rollback()
        logger.error(f"Error in bulk upsert: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/summary/week", response_model=WeekSummaryResponse)
def get_week_summary(
    week_start: str = Query(..., description="Week start date in YYYY-MM-DD format"),
    session: Session = Depends(get_session),
):
    """Get all entries for a week starting from the given date."""
    logger.info(f"Week summary request for week starting: {week_start}")

    try:
        # Calculate week end date (4 days after start = Friday)
        start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
        end_date = start_date + timedelta(days=4)  # Monday to Friday

        # Query entries for the week using raw SQL to handle missing time_period column gracefully
        from sqlalchemy import text
        is_postgres = "postgresql" in str(session.bind.url).lower() if hasattr(session.bind, 'url') else False
        
        if is_postgres:
            # Check if time_period column exists
            try:
                result = session.execute(text("""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'entry' AND column_name = 'time_period'
                """))
                time_period_exists = result.fetchone() is not None
            except:
                time_period_exists = False
            
            if time_period_exists:
                # Use raw SQL to include time_period and normalize empty string to None
                result = session.execute(text("""
                    SELECT id, user_key, user_name, date, location, 
                           NULLIF(time_period, '') as time_period,
                           client, notes, created_at, updated_at
                    FROM entry
                    WHERE date >= :start_date AND date <= :end_date
                    ORDER BY date, user_name, time_period
                """), {"start_date": week_start, "end_date": end_date.strftime("%Y-%m-%d")})
                rows = result.fetchall()
                entries = [create_entry_from_row(row, include_time_period=True) for row in rows]
            else:
                # Use raw SQL to avoid time_period column (when it doesn't exist)
                result = session.execute(text("""
                    SELECT id, user_key, user_name, date, location, client, notes, created_at, updated_at
                    FROM entry
                    WHERE date >= :start_date AND date <= :end_date
                    ORDER BY date, user_name
                """), {"start_date": week_start, "end_date": end_date.strftime("%Y-%m-%d")})
                rows = result.fetchall()
                # Convert to Entry-like objects (time_period doesn't exist in DB)
                entries = [create_entry_from_row(row, include_time_period=False) for row in rows]
        else:
            # SQLite - similar approach
            try:
                result = session.execute(text("PRAGMA table_info(entry)"))
                columns = [row[1] for row in result.fetchall()]
                time_period_exists = 'time_period' in columns
            except:
                time_period_exists = False
            
            if time_period_exists:
                # Use raw SQL to include time_period and normalize empty string to None
                result = session.execute(text("""
                    SELECT id, user_key, user_name, date, location, 
                           NULLIF(time_period, '') as time_period,
                           client, notes, created_at, updated_at
                    FROM entry
                    WHERE date >= :start_date AND date <= :end_date
                    ORDER BY date, user_name, time_period
                """), {"start_date": week_start, "end_date": end_date.strftime("%Y-%m-%d")})
                rows = result.fetchall()
                entries = [create_entry_from_row(row, include_time_period=True) for row in rows]
            else:
                result = session.execute(text("""
                    SELECT id, user_key, user_name, date, location, client, notes, created_at, updated_at
                    FROM entry
                    WHERE date >= :start_date AND date <= :end_date
                    ORDER BY date, user_name
                """), {"start_date": week_start, "end_date": end_date.strftime("%Y-%m-%d")})
                rows = result.fetchall()
                entries = [create_entry_from_row(row, include_time_period=False) for row in rows]

        # Convert to response format
        # Normalize empty string back to None for API consistency
        summary_rows = [
            SummaryRow(
                user_name=entry.user_name,
                date=entry.date,
                location=entry.location,
                time_period=None if getattr(entry, 'time_period', None) == '' else getattr(entry, 'time_period', None),
                client=entry.client,
                notes=entry.notes,
            )
            for entry in entries
        ]

        logger.info(f"Found {len(summary_rows)} entries for week {week_start}")
        # Log a few entries with time_period for debugging
        for row in summary_rows[:5]:
            if row.time_period:
                logger.info(f"Entry: {row.user_name} on {row.date} at {row.location} ({row.time_period})")
        return WeekSummaryResponse(entries=summary_rows)

    except ValueError as e:
        logger.error(f"Invalid date format: {str(e)}")
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD"
        ) from e
    except Exception as e:
        logger.error(f"Error getting week summary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get("/entries", response_model=list[EntryResponse])
def get_entries(
    date_from: str = Query(None, description="Start date filter (YYYY-MM-DD)"),
    date_to: str = Query(None, description="End date filter (YYYY-MM-DD)"),
    session: Session = Depends(get_session),
):
    """Get entries with optional date filtering."""
    logger.info(f"Entries request - from: {date_from}, to: {date_to}")

    try:
        time_period_exists = check_time_period_column_exists()
        
        if time_period_exists:
            # Use model query if column exists
            stmt = select(Entry)

            if date_from:
                stmt = stmt.where(Entry.date >= date_from)
            if date_to:
                stmt = stmt.where(Entry.date <= date_to)

            stmt = stmt.order_by(Entry.date, Entry.user_name)
            entries = session.exec(stmt).all()
        else:
            # Use raw SQL if column doesn't exist
            sql = "SELECT id, user_key, user_name, date, location, client, notes, created_at, updated_at FROM entry WHERE 1=1"
            params = {}
            if date_from:
                sql += " AND date >= :date_from"
                params["date_from"] = date_from
            if date_to:
                sql += " AND date <= :date_to"
                params["date_to"] = date_to
            sql += " ORDER BY date, user_name"
            
            result = session.execute(text(sql), params)
            rows = result.fetchall()
            # Convert to Entry-like objects
            entries = [create_entry_from_row(row) for row in rows]

        return [
            EntryResponse(
                id=entry.id,
                user_name=entry.user_name,
                date=entry.date,
                location=entry.location,
                time_period=None if getattr(entry, 'time_period', None) == '' else getattr(entry, 'time_period', None),
                client=entry.client,
                notes=entry.notes,
                created_at=entry.created_at,
                updated_at=entry.updated_at,
            )
            for entry in entries
        ]

    except Exception as e:
        logger.error(f"Error getting entries: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.delete("/entries/{entry_id}")
def delete_entry(entry_id: int, session: Session = Depends(get_session)):
    """Delete a specific entry by ID."""
    logger.info(f"Delete entry request for ID: {entry_id}")

    try:
        stmt = select(Entry).where(Entry.id == entry_id)
        entry = session.exec(stmt).first()

        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")

        session.delete(entry)
        session.commit()

        logger.info(f"Successfully deleted entry {entry_id}")
        return {"ok": True, "message": "Entry deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        logger.error(f"Error deleting entry: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get("/summary/all-users")
def get_all_users(
    session: Session = Depends(get_session),
):
    """Get list of all unique users who have ever submitted entries."""
    logger.info("All users request")

    try:
        # Query all entries to get unique user names
        time_period_exists = check_time_period_column_exists()
        
        if time_period_exists:
            # Use model query if column exists
            entries = session.exec(select(Entry)).all()
        else:
            # Use raw SQL if column doesn't exist
            result = session.execute(text("""
                SELECT id, user_key, user_name, date, location, client, notes, created_at, updated_at
                FROM entry
            """))
            rows = result.fetchall()
            entries = [create_entry_from_row(row) for row in rows]

        # Group by user_key and get latest user_name (preserve display name with latest casing)
        user_map = {}
        for entry in entries:
            if entry.user_key not in user_map:
                user_map[entry.user_key] = entry.user_name
            # Prefer more recent user_name (if updated_at exists)
            elif entry.updated_at and (
                not user_map.get(entry.user_key) or 
                (isinstance(entry.updated_at, datetime) and 
                 user_map.get(entry.user_key + "_ts", datetime.min) < entry.updated_at)
            ):
                user_map[entry.user_key] = entry.user_name
        
        # Return unique user names sorted alphabetically
        users = sorted(list(set(user_map.values())))

        logger.info(f"Found {len(users)} total users")
        return {"users": users}

    except Exception as e:
        logger.error(f"Error getting all users: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/summary/users")
def get_users_for_week(
    week_start: str = Query(..., description="Week start date in YYYY-MM-DD format"),
    session: Session = Depends(get_session),
):
    """Get list of unique users who have entries for a given week."""
    logger.info(f"Users request for week starting: {week_start}")

    try:
        # Calculate week end date (Friday)
        start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
        end_date = start_date + timedelta(days=4)

        # Query entries for the week
        time_period_exists = check_time_period_column_exists()
        
        if time_period_exists:
            stmt = (
                select(Entry)
                .where(
                    Entry.date >= week_start,
                    Entry.date <= end_date.strftime("%Y-%m-%d"),
                )
            )
            entries = session.exec(stmt).all()
        else:
            # Use raw SQL if column doesn't exist
            result = session.execute(text("""
                SELECT id, user_key, user_name, date, location, client, notes, created_at, updated_at
                FROM entry
                WHERE date >= :start_date AND date <= :end_date
            """), {"start_date": week_start, "end_date": end_date.strftime("%Y-%m-%d")})
            rows = result.fetchall()
            entries = [create_entry_from_row(row, include_time_period=False) for row in rows]

        # Get unique user names grouped by user_key (normalized)
        user_map = {}
        for entry in entries:
            if entry.user_key not in user_map:
                user_map[entry.user_key] = entry.user_name
                if hasattr(entry, 'updated_at') and entry.updated_at:
                    user_map[entry.user_key + "_ts"] = entry.updated_at
            # Prefer latest user_name if updated_at is more recent
            elif hasattr(entry, 'updated_at') and entry.updated_at:
                existing_ts = user_map.get(entry.user_key + "_ts")
                if existing_ts and isinstance(existing_ts, type(entry.updated_at)):
                    # Only compare if both are the same type
                    if entry.updated_at > existing_ts:
                        user_map[entry.user_key] = entry.user_name
                        user_map[entry.user_key + "_ts"] = entry.updated_at
                elif not existing_ts:
                    # If no existing timestamp, use this one
                    user_map[entry.user_key] = entry.user_name
                    user_map[entry.user_key + "_ts"] = entry.updated_at
        
        users = sorted(list(set(user_map.values())))

        logger.info(f"Found {len(users)} users for week {week_start}")
        return {"users": users}

    except ValueError as e:
        logger.error(f"Invalid date format: {str(e)}")
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD"
        )
    except Exception as e:
        logger.error(f"Error getting users: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/entries/check")
def check_existing_entries(
    user_name: str = Query(..., description="User name to check"),
    week_start: str = Query(..., description="Week start date in YYYY-MM-DD format"),
    session: Session = Depends(get_session),
):
    """Check if a user already has entries for a given week (uses normalized user_key)."""
    logger.info(f"Check entries request for user: {user_name}, week: {week_start}")
    
    try:
        # Calculate week end date (Friday)
        start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
        end_date = start_date + timedelta(days=4)
        
        # Normalize user name to user_key
        user_key = user_name.strip().lower()
        
        # Check if time_period column exists
        time_period_exists = check_time_period_column_exists()
        
        if time_period_exists:
            # Use model query if column exists
            user_entries = session.exec(
                select(Entry)
                .where(Entry.user_key == user_key)
                .where(Entry.date >= week_start)
                .where(Entry.date <= end_date.strftime("%Y-%m-%d"))
            ).all()
            
            return {
                "exists": len(user_entries) > 0,
                "count": len(user_entries),
                "entries": [
                    {
                        "date": e.date,
                        "location": e.location,
                        "time_period": None if getattr(e, 'time_period', None) == '' else getattr(e, 'time_period', None),
                        "client": e.client,
                        "notes": e.notes,
                    }
                    for e in user_entries
                ]
            }
        else:
            # Use raw SQL if column doesn't exist yet
            result = session.execute(text("""
                SELECT date, location, client, notes
                FROM entry
                WHERE user_key = :user_key
                AND date >= :start_date
                AND date <= :end_date
            """), {
                "user_key": user_key,
                "start_date": week_start,
                "end_date": end_date.strftime("%Y-%m-%d")
            })
            rows = result.fetchall()
            
            return {
                "exists": len(rows) > 0,
                "count": len(rows),
                "entries": [
                    {
                        "date": row[0],
                        "location": row[1],
                        "time_period": None,
                        "client": row[2],
                        "notes": row[3],
                    }
                    for row in rows
                ]
            }
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid date format")
    except Exception as e:
        logger.error(f"Error checking entries: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/migrate-locations")
def migrate_locations(session: Session = Depends(get_session)):
    """Migrate old location names to new ones."""
    logger.info("Starting location migration")
    
    # Mapping old names to new names
    migration_map = {
        "Office": "Neal Street",
        "Client": "Client Office", 
        "Off": "Holiday"
        # PTO entries will need to be handled separately or deleted
    }
    
    try:
        updated_count = 0
        deleted_count = 0
        
        for old_name, new_name in migration_map.items():
            stmt = select(Entry).where(Entry.location == old_name)
            entries = session.exec(stmt).all()
            
            for entry in entries:
                entry.location = new_name
                updated_count += 1
            
            session.commit()
        
        # Delete PTO entries since we removed that option
        stmt = select(Entry).where(Entry.location == "PTO")
        pto_entries = session.exec(stmt).all()
        for entry in pto_entries:
            session.delete(entry)
            deleted_count += 1
        
        session.commit()
        
        logger.info(f"Migration complete: {updated_count} updated, {deleted_count} PTO entries deleted")
        return {
            "ok": True, 
            "updated": updated_count,
            "deleted_pto": deleted_count,
            "message": "Migration complete"
        }
    except Exception as e:
        session.rollback()
        logger.error(f"Migration error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/send-weekly-report")
def send_weekly_report(
    recipients: str = Query(None, description="Comma-separated email addresses (or use REPORT_EMAILS env var)"),
    session: Session = Depends(get_session),
):
    """
    Generate and send weekly office attendance report for the previous week.
    
    This endpoint is designed to be called by a cron job every Monday morning.
    It calculates days each person was NOT working from home (excluding holidays)
    for the previous Monday-Friday.
    """
    logger.info("Weekly report generation requested")
    
    try:
        # Parse recipients if provided
        email_list = None
        if recipients:
            email_list = [e.strip() for e in recipients.split(",") if e.strip()]
        
        result = generate_and_send_weekly_report(session, recipients=email_list)
        
        if result["success"]:
            logger.info(
                f"Weekly report sent successfully. Week: {result['week_start']} to {result['week_end']}, "
                f"Recipients: {result['recipients']}"
            )
            return {
                "ok": True,
                "message": "Weekly report sent successfully",
                "week_start": result["week_start"],
                "week_end": result["week_end"],
                "recipients": result["recipients"],
                "users_reported": result["users_reported"],
                "total_entries": result["total_entries"],
            }
        else:
            logger.error(f"Failed to send weekly report: {result.get('error')}")
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to send report"))
    
    except Exception as e:
        logger.error(f"Error sending weekly report: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/debug")
def debug_database(session: Session = Depends(get_session)):
    """Debug endpoint to check database contents and connection."""
    try:
        # Check database type and connection
        from db import DATABASE_URL, engine
        db_type = "PostgreSQL" if "postgresql://" in DATABASE_URL or "postgres://" in DATABASE_URL else "SQLite"
        
        # Try to get database name/info (sanitized for security)
        db_info = "unknown"
        if "@" in DATABASE_URL:
            # Show only the host part, not credentials
            db_info = DATABASE_URL.split("@")[-1].split("?")[0]
        elif "sqlite" in DATABASE_URL:
            db_info = DATABASE_URL.split("/")[-1]
        
        # Check if time_period column exists
        time_period_exists = False
        try:
            from sqlalchemy import text, inspect
            inspector = inspect(engine)
            columns = [col['name'] for col in inspector.get_columns('entry')]
            time_period_exists = 'time_period' in columns
        except Exception as col_e:
            logger.warning(f"Could not check columns: {col_e}")
        
        # Check table structure
        try:
            from sqlalchemy import text
            with engine.connect() as conn:
                result = conn.execute(text("""
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_name = 'entry'
                    ORDER BY ordinal_position
                """))
                table_columns = [{"name": row[0], "type": row[1]} for row in result.fetchall()]
        except Exception:
            table_columns = []
        
        # Get total entry count
        time_period_exists_check = check_time_period_column_exists()
        if time_period_exists_check:
            all_entries = session.exec(select(Entry)).all()
        else:
            # Use raw SQL if column doesn't exist
            result = session.execute(text("""
                SELECT id, user_key, user_name, date, location, client, notes, created_at, updated_at
                FROM entry
            """))
            rows = result.fetchall()
            all_entries = [create_entry_from_row(row) for row in rows]
        
        total_count = len(all_entries)
        
        # Get sample entries (last 10)
        recent_entries = all_entries[-10:] if all_entries else []
        
        # Get unique users
        users = sorted(list(set([e.user_name for e in all_entries])))
        
        # Get date range
        dates = [e.date for e in all_entries] if all_entries else []
        min_date = min(dates) if dates else None
        max_date = max(dates) if dates else None
        
        # Test if we can write (just verify connection works)
        connection_ok = True
        try:
            # Just verify the connection
            from sqlalchemy import text
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as conn_e:
            connection_ok = False
            logger.error(f"Connection test failed: {str(conn_e)}")
        
        # Check if we can query time_period (will fail if column doesn't exist)
        time_period_query_works = False
        if time_period_exists:
            try:
                sample_with_time_period = session.exec(
                    select(Entry).limit(1)
                ).first()
                if sample_with_time_period:
                    _ = sample_with_time_period.time_period  # Try to access it
                    time_period_query_works = True
            except Exception:
                time_period_query_works = False
        
        return {
            "database_type": db_type,
            "database_info": db_info,
            "connection_ok": connection_ok,
            "time_period_column_exists": time_period_exists,
            "time_period_query_works": time_period_query_works,
            "table_columns": table_columns,
            "total_entries": total_count,
            "unique_users": users,
            "date_range": {
                "earliest": min_date,
                "latest": max_date
            },
            "sample_entries": [
                {
                    "id": e.id,
                    "user_name": e.user_name,
                    "date": e.date,
                    "location": e.location,
                    "time_period": getattr(e, 'time_period', None),
                    "client": e.client,
                }
                for e in recent_entries
            ]
        }
    except Exception as e:
        logger.error(f"Debug error: {str(e)}")
        import traceback
        return {
            "error": str(e), 
            "traceback": traceback.format_exc(),
            "error_type": str(e.__class__.__name__)
        }


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Work Location Tracker API", "docs": "/docs"}
