# Data Loss Root Cause Report - Workplace Tracker

**Date:** 2025-01-13  
**Issue:** User entries disappear after a while  
**Mode:** Read-only investigation

---

## A. Executive Summary

**Most Likely Cause:** **Case-sensitive storage with case-insensitive queries** combined with **destructive bulk upsert logic** creates scenarios where entries appear to vanish. When a user submits entries with different name casing (e.g., "John Smith" vs "john smith"), the upsert deletes existing entries matching the case-insensitive name, then inserts new entries with the new casing. This makes previously stored entries "disappear" because queries for the original casing return empty results. Secondary causes include potential environment configuration drift (fallback to ephemeral SQLite) and the upsert's date-range deletion behavior that can leave orphaned entries when partial weeks are submitted.

**Evidence:** `app.py:64-96` (case-insensitive delete, case-sensitive insert), `app.py:73` (storage preserves case), `db.py:6-10` (SQLite fallback if DATABASE_URL missing).

---

## B. Evidence by Hypothesis

### 1. Ephemeral DB / Redeploy Wipes Data

**Verdict:** **LIKELY (Historical) / UNLIKELY (Current)**

**Evidence:**

**Historical Confirmation:**
- Documentation confirms SQLite was used initially and caused data loss on redeploy: `docs/deployment/DEPLOY_WITH_PERSISTENT_DB.md:4` ("When you redeploy your app, the database gets wiped because SQLite data is stored in ephemeral container storage")
- Migration to PostgreSQL documented: `render.yaml:3-7` (PostgreSQL database configured), `docs/deployment/DEPLOY_WITH_PERSISTENT_DB.md:6-11` (PostgreSQL solution implemented)

**Current Risk:**
- **SQLite fallback still exists:** `db.py:6-10` - If `DATABASE_URL` environment variable is missing, defaults to `sqlite:///./worktracker.db`
- **Render deployment:** `render.yaml:17-20` sets `DATABASE_URL` from database connection string, but if misconfigured or missing, falls back to SQLite
- **Docker deployment:** `docker-compose.yml:11` sets `DATABASE_PATH=/app/data/worktracker.db` (persistent volume), but if volume not mounted, data is ephemeral
- **No destructive startup:** `app.py:25-30` - `create_db_and_tables()` only creates tables, does not drop or truncate (`db.py:21-25` confirms "won't wipe existing data")
- **Seed script not auto-run:** `seed.py:80-84` - Only runs if executed as `__main__`, not called from `app.py` lifespan

**Risk Scenario:** If `DATABASE_URL` env var is missing in production (misconfiguration, env file not loaded, etc.), app falls back to SQLite in `./worktracker.db`, which on container restart/redeploy would be wiped.

---

### 2. Destructive Application Logic

**Verdict:** **CONFIRMED**

**Evidence:**

**Bulk Upsert Delete-Then-Insert Pattern:**
- **Delete phase:** `app.py:64-80` - Fetches ALL entries in date range (`min_date` to `max_date`), filters by case-insensitive name match, then deletes matching entries
- **Insert phase:** `app.py:82-96` - Inserts new entries with the exact `user_name` as provided (preserves case)
- **Problem:** Date range calculated from submitted entries only: `app.py:55-60` (`min_date = min(dates)`, `max_date = max(dates)`)

**Destructive Scenarios:**

1. **Partial Week Submission:**
   - User submits Mon-Wed entries → deletes their Mon-Wed entries, inserts new Mon-Wed entries
   - User later submits Thu-Fri entries → deletes their Thu-Fri entries, inserts new Thu-Fri entries
   - **BUT:** If user only submits Mon-Wed and never submits Thu-Fri, their Thu-Fri entries from previous submission remain (not problematic, but inconsistent)

2. **Overlapping Date Ranges:**
   - User submits Mon-Fri (dates: ["2024-01-15", "2024-01-19"])
   - User later submits Wed-Fri only (dates: ["2024-01-17", "2024-01-19"])
   - Second submission deletes ALL their entries from Wed-Fri (including the Mon-Fri entries for Wed-Fri), then inserts new Wed-Fri entries
   - **Result:** Mon-Tue entries remain, but Wed-Fri entries from first submission are replaced
   - **Not a bug per se, but confusing UX**

3. **Admin Migration Endpoint:**
   - `app.py:345-391` - `/admin/migrate-locations` endpoint exists but:
     - Only updates location names (non-destructive)
     - Deletes PTO entries (destructive): `app.py:372-377`
     - **No auth check** - publicly accessible (`app.py:345`), could be called accidentally or maliciously
   - **Risk:** If called, deletes all entries with `location="PTO"`

**Transaction Safety Gap:**
- Separate commits for delete and insert: `app.py:80` (delete commit), `app.py:96` (insert commit)
- If insert fails after delete commits, entries are permanently lost (no rollback)
- If network error occurs between commits, user sees success but data is lost

---

### 3. Case/Identity Collisions

**Verdict:** **CONFIRMED (Primary Cause)**

**Evidence:**

**Storage vs Query Mismatch:**
- **Storage is case-sensitive:** `models.py:8` - `user_name: str` stored as provided, no normalization
- **Queries are case-insensitive:** `app.py:73` (`.lower()` comparison), `app.py:101` (`.ilike()`), `app.py:309, 319` (`.lower()` comparisons)
- **Upsert preserves submitted case:** `app.py:86` - `user_name=request.user_name` (no normalization)

**Data Loss Scenario:**
1. User "John Smith" submits Mon-Fri entries → stored as `user_name="John Smith"` (entries created)
2. User later types "john smith" (lowercase) and submits Mon-Fri → upsert logic:
   - Queries for entries where `user_name.lower() == "john smith"` → finds entries with `user_name="John Smith"` (case-insensitive match)
   - Deletes those entries: `app.py:71-74`
   - Inserts new entries with `user_name="john smith"` (lowercase): `app.py:86`
3. **Result:** Original "John Smith" entries deleted, replaced with "john smith" entries
4. User searches for "John Smith" in dashboard → queries case-sensitively (or case-insensitively but sees "john smith" in results)
5. **Appears as:** "John Smith" entries "disappeared"

**Evidence in Code:**
- Delete query: `app.py:71-74` - `e.user_name.lower() == request.user_name.lower()` (finds "John Smith" when searching for "john smith")
- Insert query: `app.py:86` - `user_name=request.user_name` (preserves "john smith" as-is)
- Dashboard display: `App.tsx:890-989` - Shows entries grouped by exact `user_name` as stored
- User selection: `App.tsx:280-285` - User can select any name from list, but if they type a different case, creates new entries

**Additional Collision Risk:**
- No uniqueness constraint: `models.py:6-13` - No `UNIQUE(user_name, date)` constraint
- Multiple entries per user/day allowed at DB level
- Only prevented by upsert's delete-before-insert pattern, which itself causes the case-sensitivity issue

---

### 4. Environment Drift

**Verdict:** **LIKELY**

**Evidence:**

**Environment Variable Dependency:**
- Production should use PostgreSQL: `render.yaml:17-20` (DATABASE_URL from database service)
- Fallback to SQLite: `db.py:6-10` - If `DATABASE_URL` not set, uses `sqlite:///./worktracker.db`
- **Risk:** If env var not loaded or misconfigured in production, app silently falls back to SQLite

**Configuration Files:**
- **Render:** `render.yaml:17-20` - Sets `DATABASE_URL` from database service (auto-configured)
- **Docker:** `docker-compose.yml:11` - Sets `DATABASE_PATH=/app/data/worktracker.db` (volume mounted)
- **Local:** `db.py:6` - Defaults to `./worktracker.db` (local file)

**Dev vs Prod Drift:**
- Developer tests locally with SQLite → sees data persist
- Production missing `DATABASE_URL` → uses SQLite in ephemeral container storage → data lost on redeploy
- **Evidence:** `docs/deployment/DEPLOY_WITH_PERSISTENT_DB.md:116-119` documents this exact scenario ("Database seems empty after migration")

**Missing Validation:**
- No startup check to verify `DATABASE_URL` is set in production
- No warning log if falling back to SQLite
- App silently uses SQLite if env var missing

---

## C. Timeline Triggers

**Events That Coincide with Data Loss:**

1. **Redeployment (Historical):**
   - **When:** Every backend redeploy on Render (before PostgreSQL migration)
   - **Why:** SQLite file in ephemeral container storage wiped
   - **Evidence:** `docs/deployment/DEPLOY_WITH_PERSISTENT_DB.md:4-5`

2. **User Resubmission with Different Name Casing:**
   - **When:** User types name with different capitalization (e.g., "john smith" vs "John Smith")
   - **Why:** Case-insensitive delete matches existing entries, then inserts with new casing
   - **Evidence:** `app.py:73` (case-insensitive delete), `app.py:86` (case-sensitive insert)

3. **Partial Week Resubmission:**
   - **When:** User submits only part of week (e.g., Mon-Wed) when they previously submitted full week
   - **Why:** Deletes entries in submitted date range only, leaving other days intact but appearing inconsistent
   - **Evidence:** `app.py:59-60` (date range from submitted entries only)

4. **Admin Migration Endpoint Called:**
   - **When:** `/admin/migrate-locations` endpoint accessed (no auth required)
   - **Why:** Deletes all entries with `location="PTO"`
   - **Evidence:** `app.py:372-377`

5. **Environment Variable Missing (Current Risk):**
   - **When:** Production deployment without `DATABASE_URL` set
   - **Why:** Falls back to SQLite in ephemeral storage, data lost on restart
   - **Evidence:** `db.py:6-10` (SQLite fallback)

6. **Network Error During Upsert:**
   - **When:** Network failure between delete commit and insert commit
   - **Why:** Delete commits successfully (`app.py:80`), insert fails, entries permanently lost
   - **Evidence:** `app.py:80, 96` (separate commits)

---

## D. Minimal Repro Steps

**Reproduce Case-Sensitivity Data Loss:**

1. **Submit entries with original casing:**
   ```bash
   curl -X POST http://localhost:8000/entries/bulk_upsert \
     -H "Content-Type: application/json" \
     -d '{
       "user_name": "John Smith",
       "entries": [
         {"date": "2024-01-15", "location": "Neal Street"},
         {"date": "2024-01-16", "location": "WFH"}
       ]
     }'
   ```

2. **Verify entries exist:**
   ```bash
   curl http://localhost:8000/entries/check?user_name=John%20Smith&week_start=2024-01-15
   # Returns: {"exists": true, "count": 2, "entries": [...]}
   ```

3. **Resubmit with different casing:**
   ```bash
   curl -X POST http://localhost:8000/entries/bulk_upsert \
     -H "Content-Type: application/json" \
     -d '{
       "user_name": "john smith",
       "entries": [
         {"date": "2024-01-15", "location": "Neal Street"},
         {"date": "2024-01-16", "location": "WFH"}
       ]
     }'
   ```

4. **Query with original casing:**
   ```bash
   curl http://localhost:8000/entries/check?user_name=John%20Smith&week_start=2024-01-15
   # Returns: {"exists": false, "count": 0, "entries": []}
   ```

5. **Query with new casing:**
   ```bash
   curl http://localhost:8000/entries/check?user_name=john%20smith&week_start=2024-01-15
   # Returns: {"exists": true, "count": 2, "entries": [...]}
   ```

**Code Paths:**
- Delete logic: `app.py:64-80` (finds "John Smith" entries when searching for "john smith")
- Insert logic: `app.py:82-96` (stores as "john smith")
- Query logic: `app.py:319-321` (case-insensitive, finds "john smith" entries)

**Reproduce Partial Week Deletion:**

1. Submit full week (Mon-Fri)
2. Submit partial week (Wed-Fri only)
3. Query for Mon-Tue entries → still exist
4. Query for Wed-Fri entries → replaced (from second submission)

**Code Path:** `app.py:59-60` (date range = min/max of submitted entries only)

---

## E. Data Risk Surface

**Destructive Routes/Commands:**

| Route/Command | Destructive Action | Auth Required | Who Can Call | Location |
|--------------|-------------------|---------------|--------------|----------|
| `POST /entries/bulk_upsert` | Deletes all entries for user in submitted date range (case-insensitive match) | ❌ No | Anyone (public endpoint) | `app.py:46-115` |
| `DELETE /entries/{entry_id}` | Hard deletes single entry by ID | ❌ No | Anyone with entry_id | `app.py:207-230` |
| `POST /admin/migrate-locations` | Deletes all entries with `location="PTO"` | ❌ No | Anyone (public endpoint) | `app.py:345-391` (lines 372-377) |
| Database fallback to SQLite | Data in SQLite file lost on container restart | N/A | Environment misconfiguration | `db.py:6-10` |

**Upsert Delete Logic Details:**
- **Scope:** All entries for user (case-insensitive name match) in date range (min to max of submitted dates)
- **Code:** `app.py:64-80`
- **Risk:** Partial week submissions leave orphaned entries; case mismatches cause apparent data loss

**Admin Endpoint Risks:**
- `/admin/migrate-locations`: No auth, deletes PTO entries (`app.py:372-377`)
- `/admin/send-weekly-report`: No auth, can trigger email spam (`app.py:394-436`)
- `/admin/debug`: No auth, exposes database contents (`app.py:439-504`)

**Database Initialization:**
- `create_db_and_tables()`: Safe, only creates tables (`db.py:21-25`, `app.py:28`)
- `seed_database()`: Not auto-run, only if called manually (`seed.py:80-84`, not called from `app.py`)

**Scheduled Tasks:**
- None found - no cron jobs or scheduled deletions
- `cron_job.py` exists but only triggers report email, no data deletion (`cron_job.py:1-34`)

---

**Report End**

