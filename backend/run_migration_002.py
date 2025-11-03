#!/usr/bin/env python3
"""
Manual script to run migration 002 on production database.
Run this from the backend directory or adjust the import path.
"""
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import engine
from migrations.migrate_002_add_time_period import migrate
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if __name__ == "__main__":
    logger.info("Running migration 002 manually...")
    try:
        migrate(engine)
        logger.info("✅ Migration 002 completed successfully!")
    except Exception as e:
        logger.error(f"❌ Migration 002 failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        sys.exit(1)

