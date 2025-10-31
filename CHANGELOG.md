# Changelog

## [Unreleased]

### Fixed - Data Loss Prevention

**Problem:** User entries were disappearing due to:
- Destructive week-wide delete-then-insert pattern
- Case-sensitive storage with case-insensitive queries causing identity collisions
- No uniqueness constraints allowing duplicate entries

**Solution:**
- **Added `user_key` field:** Normalized identifier (`lower(trim(user_name))`) for consistent user identity across name casing variations
- **Added `updated_at` field:** Tracks when entries were last modified for audit purposes
- **Added unique constraint:** `UNIQUE(user_key, date)` at database level prevents duplicate entries per user per day
- **Replaced destructive upsert:** Removed week-wide delete logic, implemented atomic per-day upserts using:
  - PostgreSQL: `INSERT ... ON CONFLICT DO UPDATE` (idempotent)
  - SQLite: ORM merge pattern (select, update or insert)
- **Single transaction:** All upsert operations now occur in one atomic transaction, preventing partial failures
- **Production SQLite guard:** Application refuses to start in production without `DATABASE_URL` to prevent accidental SQLite fallback

**Migration:**
- Automatic migration on startup adds `user_key` column, backfills from existing `user_name`, deduplicates entries, and creates unique constraint
- Supports both PostgreSQL and SQLite

**Behavior Changes:**
- Re-saving part of a week no longer erases other days
- Changing name casing no longer "loses" previous entries; all entries remain under same `user_key`
- Duplicate rows for `(user, date)` cannot be created (enforced at database level)
- Upserts are now idempotent - submitting the same data twice results in same entry count

**Files Changed:**
- `backend/models.py` - Added `user_key`, `updated_at`, unique constraint
- `backend/app.py` - Replaced bulk delete with atomic per-day upserts, updated queries to use `user_key`
- `backend/db.py` - Added production SQLite guard and database driver logging
- `backend/schemas.py` - Added `updated_at` to `EntryResponse`
- `backend/migrations/001_add_user_key_constraint.py` - Migration script (new)
- `backend/tests/test_upsert_fix.py` - Comprehensive tests for new behavior (new)

**Breaking Changes:** None - backward compatible with existing data (migration handles existing entries)

