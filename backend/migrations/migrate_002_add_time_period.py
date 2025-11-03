"""
Migration: Add time_period field and update unique constraint.

This migration:
1. Adds time_period column (nullable string for 'Morning', 'Afternoon', or NULL for full day)
2. Updates unique constraint from (user_key, date) to (user_key, date, time_period)
3. Handles both PostgreSQL and SQLite
"""
import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


def is_postgres(engine):
    """Check if database is PostgreSQL."""
    return "postgresql" in str(engine.url).lower()


def migrate(engine):
    """Run migration."""
    with engine.connect() as conn:
        # Start transaction
        trans = conn.begin()
        
        try:
            if is_postgres(engine):
                migrate_postgres(conn)
            else:
                migrate_sqlite(conn)
            
            trans.commit()
            logger.info("Migration 002 completed successfully")
        except Exception as e:
            trans.rollback()
            logger.error(f"Migration 002 failed: {str(e)}")
            raise


def migrate_postgres(conn):
    """PostgreSQL migration."""
    logger.info("Running PostgreSQL migration for time_period...")
    
    # Check if time_period already exists (idempotent)
    result = conn.execute(text("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'entry' AND column_name = 'time_period'
    """))
    
    if result.fetchone():
        logger.info("time_period column already exists, checking constraint...")
        # Check if unique constraint is already updated
        result = conn.execute(text("""
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'entry' 
            AND indexname = 'uniq_entries_userkey_date_timeperiod'
        """))
        if result.fetchone():
            logger.info("Unique constraint already updated, skipping migration")
            return
        # Column exists but constraint doesn't - continue to update constraint
    else:
        # Step 1: Add time_period column (nullable) - SAFE: doesn't affect existing data
        # All existing rows will have time_period = NULL (which means full day)
        logger.info("Adding time_period column...")
        logger.info("⚠️  IMPORTANT: All existing entries will have time_period = NULL (full day entries)")
        conn.execute(text("ALTER TABLE entry ADD COLUMN time_period TEXT"))
        logger.info("✅ Column added. Existing entries preserved with time_period = NULL")
    
    # Step 2: Verify we can drop old constraint safely (check if any duplicates would be created)
    logger.info("Checking for potential duplicate entries before updating constraint...")
    result = conn.execute(text("""
        SELECT user_key, date, COUNT(*) as count
        FROM entry
        GROUP BY user_key, date
        HAVING COUNT(*) > 1
    """))
    duplicates = result.fetchall()
    if duplicates:
        logger.warning(f"Found {len(duplicates)} duplicate (user_key, date) pairs. These will be preserved but may cause constraint issues.")
        for dup in duplicates:
            logger.warning(f"  - user_key: {dup[0]}, date: {dup[1]}, count: {dup[2]}")
    
    # Step 2: Drop old unique constraint/index - SAFE: existing data is preserved
    logger.info("Dropping old unique constraint...")
    try:
        conn.execute(text("DROP INDEX IF EXISTS uniq_entries_userkey_date"))
        logger.info("✅ Old index dropped")
    except Exception as e:
        logger.warning(f"Could not drop old index (might not exist): {e}")
    
    try:
        conn.execute(text("""
            ALTER TABLE entry DROP CONSTRAINT IF EXISTS uniq_entries_userkey_date
        """))
        logger.info("✅ Old constraint dropped")
    except Exception as e:
        logger.warning(f"Could not drop old constraint (might not exist): {e}")
    
    # Step 3: Create new unique constraint with time_period - SAFE: preserves existing entries
    # Use COALESCE to treat NULL as empty string for uniqueness
    # This ensures only one NULL (full day) entry per (user_key, date)
    # All existing entries have time_period = NULL, so they'll still be unique per (user_key, date)
    logger.info("Creating new unique constraint on (user_key, date, time_period)...")
    logger.info("✅ Existing entries will remain unique (time_period = NULL is treated as empty string)")
    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_entries_userkey_date_timeperiod 
        ON entry (user_key, date, COALESCE(time_period, ''))
    """))
    logger.info("✅ New unique constraint created. All existing data preserved!")


def migrate_sqlite(conn):
    """SQLite migration."""
    logger.info("Running SQLite migration for time_period...")
    
    # Check if entry table exists
    result = conn.execute(text("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='entry'
    """))
    
    if not result.fetchone():
        logger.info("Entry table does not exist, skipping migration")
        return
    
    # Check if migration already applied
    result = conn.execute(text("PRAGMA table_info(entry)"))
    columns = [row[1] for row in result.fetchall()]
    
    if "time_period" in columns:
        logger.info("time_period column already exists, checking constraint...")
        # Check if unique index is updated
        result = conn.execute(text("""
            SELECT name FROM sqlite_master 
            WHERE type='index' 
            AND name='uniq_entries_userkey_date_timeperiod'
        """))
        if result.fetchone():
            logger.info("Unique constraint already updated, skipping migration")
            return
    
    # Step 1: Add time_period column (nullable)
    logger.info("Adding time_period column...")
    try:
        conn.execute(text("ALTER TABLE entry ADD COLUMN time_period TEXT"))
    except Exception as e:
        if "duplicate column" not in str(e).lower():
            raise
        logger.info("time_period column already exists")
    
    # Step 2: Drop old unique index
    logger.info("Dropping old unique index...")
    try:
        conn.execute(text("DROP INDEX IF EXISTS uniq_entries_userkey_date"))
    except Exception as e:
        logger.warning(f"Could not drop old index: {e}")
    
    # Step 3: Create new unique index with time_period
    # SQLite uses COALESCE for NULL handling in unique indexes
    logger.info("Creating new unique index on (user_key, date, time_period)...")
    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_entries_userkey_date_timeperiod 
        ON entry (user_key, date, COALESCE(time_period, ''))
    """))


if __name__ == "__main__":
    from db import engine
    migrate(engine)

