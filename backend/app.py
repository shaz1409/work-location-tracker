import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, delete, select

from db import create_db_and_tables, get_session
from models import Entry
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    create_db_and_tables()
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
    """Bulk upsert entries for a user, replacing existing entries in the date range."""
    logger.info(f"Bulk upsert request for user: {request.user_name}")

    try:
        # Get date range from entries
        dates = [entry.date for entry in request.entries]
        if not dates:
            raise HTTPException(status_code=400, detail="No entries provided")

        min_date = min(dates)
        max_date = max(dates)

        # Delete existing entries for this user in the date range (case-insensitive matching)
        # Fetch all entries in date range and filter by case-insensitive name match
        existing_entries = session.exec(
            select(Entry)
            .where(Entry.date >= min_date)
            .where(Entry.date <= max_date)
        ).all()
        
        # Delete entries where user_name matches case-insensitively
        entries_to_delete = [
            e.id for e in existing_entries 
            if e.user_name.lower() == request.user_name.lower()
        ]
        
        if entries_to_delete:
            delete_ids_stmt = delete(Entry).where(Entry.id.in_(entries_to_delete))
            session.exec(delete_ids_stmt)

        # Insert new entries
        new_entries = []
        for entry_data in request.entries:
            entry = Entry(
                user_name=request.user_name,
                date=entry_data.date,
                location=entry_data.location,
                client=entry_data.client,
                notes=entry_data.notes,
            )
            new_entries.append(entry)

        session.add_all(new_entries)
        session.commit()

        logger.info(
            f"Successfully upserted {len(new_entries)} entries for {request.user_name}"
        )
        return BulkUpsertResponse(ok=True, count=len(new_entries))

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

        # Query entries for the week
        stmt = (
            select(Entry)
            .where(
                Entry.date >= week_start,
                Entry.date <= end_date.strftime("%Y-%m-%d"),
            )
            .order_by(Entry.date, Entry.user_name)
        )

        entries = session.exec(stmt).all()

        # Convert to response format
        summary_rows = [
            SummaryRow(
                user_name=entry.user_name,
                date=entry.date,
                location=entry.location,
                client=entry.client,
                notes=entry.notes,
            )
            for entry in entries
        ]

        logger.info(f"Found {len(summary_rows)} entries for week {week_start}")
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
        stmt = select(Entry)

        if date_from:
            stmt = stmt.where(Entry.date >= date_from)
        if date_to:
            stmt = stmt.where(Entry.date <= date_to)

        stmt = stmt.order_by(Entry.date, Entry.user_name)

        entries = session.exec(stmt).all()

        return [
            EntryResponse(
                id=entry.id,
                user_name=entry.user_name,
                date=entry.date,
                location=entry.location,
                client=entry.client,
                notes=entry.notes,
                created_at=entry.created_at,
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
        stmt = (
            select(Entry)
            .where(
                Entry.date >= week_start,
                Entry.date <= end_date.strftime("%Y-%m-%d"),
            )
        )

        entries = session.exec(stmt).all()

        # Get unique user names (case-insensitive)
        users = list(set([entry.user_name for entry in entries]))
        users.sort()

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
    """Check if a user already has entries for a given week (case-insensitive)."""
    logger.info(f"Check entries request for user: {user_name}, week: {week_start}")
    
    try:
        # Calculate week end date (Friday)
        start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
        end_date = start_date + timedelta(days=4)
        
        # Get all entries in the week
        entries = session.exec(
            select(Entry)
            .where(Entry.date >= week_start)
            .where(Entry.date <= end_date.strftime("%Y-%m-%d"))
        ).all()
        
        # Filter for case-insensitive name match
        user_entries = [
            e for e in entries 
            if e.user_name.lower() == user_name.lower()
        ]
        
        return {
            "exists": len(user_entries) > 0,
            "count": len(user_entries),
            "entries": [
                {
                    "date": e.date,
                    "location": e.location,
                    "client": e.client,
                    "notes": e.notes,
                }
                for e in user_entries
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


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Work Location Tracker API", "docs": "/docs"}
