import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, delete, select

from db import create_db_and_tables, get_session
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
            logger.info(f"Deleting {len(entries_to_delete)} existing entries for {request.user_name}")
            delete_ids_stmt = delete(Entry).where(Entry.id.in_(entries_to_delete))
            session.exec(delete_ids_stmt)
            session.commit()  # Commit deletions first

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

        logger.info(f"Adding {len(new_entries)} new entries for {request.user_name}")
        session.add_all(new_entries)
        session.commit()
        
        # Verify the entries were actually saved
        verify_count = session.exec(
            select(Entry)
            .where(Entry.user_name.ilike(request.user_name))
            .where(Entry.date >= min_date)
            .where(Entry.date <= max_date)
        ).all()
        
        logger.info(
            f"Successfully upserted {len(new_entries)} entries for {request.user_name}. "
            f"Verification: {len(verify_count)} entries found in database."
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


@app.get("/summary/all-users")
def get_all_users(
    session: Session = Depends(get_session),
):
    """Get list of all unique users who have ever submitted entries."""
    logger.info("All users request")

    try:
        # Query all entries to get unique user names
        stmt = select(Entry)
        entries = session.exec(stmt).all()

        # Get unique user names (preserve case but sort alphabetically)
        users = sorted(list(set([entry.user_name for entry in entries])))

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
        
        # Get total entry count
        all_entries = session.exec(select(Entry)).all()
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
        
        return {
            "database_type": db_type,
            "database_info": db_info,
            "connection_ok": connection_ok,
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
                    "client": e.client,
                }
                for e in recent_entries
            ]
        }
    except Exception as e:
        logger.error(f"Debug error: {str(e)}")
        return {"error": str(e), "traceback": str(e.__class__.__name__)}


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Work Location Tracker API", "docs": "/docs"}
