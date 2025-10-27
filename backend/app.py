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

        # Delete existing entries for this user in the date range
        delete_stmt = delete(Entry).where(
            Entry.user_name == request.user_name,
            Entry.date >= min_date,
            Entry.date <= max_date,
        )
        session.exec(delete_stmt)

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


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Work Location Tracker API", "docs": "/docs"}
