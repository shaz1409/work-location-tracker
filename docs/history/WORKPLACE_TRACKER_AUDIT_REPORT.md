# Workplace Tracker System - User Logic Audit Report

**Date:** 2025-01-13  
**Auditor:** AI Code Review System  
**Scope:** User flows, validation rules, permissions, edge cases, data integrity, privacy  
**Mode:** Read-only analysis

---

## A. Executive Summary

The Workplace Tracker is a minimal web application allowing employees to submit their weekly work location preferences (Office/Home/Leave/Other) by name and date. The system demonstrates **functional user flows** with appropriate validation for required fields and location enums, but shows **critical gaps in security, privacy, and data integrity** that render it unsuitable for production use without significant hardening.

**Overall Fitness:** **Medium** - Core functionality works but lacks essential safeguards.

**Top 5 Risks:**
1. **No authentication/authorization** - Anyone can create, edit, or delete any user's entries (CRITICAL)
2. **No uniqueness constraints** - Multiple entries per user per day allowed, causing data conflicts (HIGH)
3. **Case-sensitive name matching inconsistencies** - Queries use case-insensitive comparisons but storage preserves case, leading to duplicates (HIGH)
4. **No audit trail** - `created_at` exists but no `updated_by` or `updated_at`, making attribution impossible (MEDIUM)
5. **Public data exposure** - All employee locations visible to anyone via dashboard endpoint (MEDIUM)

**Confidence Level:** **High** - Codebase review complete, all endpoints and flows traced.

---

## B. Architecture & Entities

### Domain Model

```
Entry (SQLModel)
├── id: int (PK)
├── user_name: str (indexed, NO uniqueness constraint)
├── date: str (YYYY-MM-DD, indexed, NO uniqueness constraint)
├── location: str (indexed) - enum: "Neal Street" | "WFH" | "Client Office" | "Holiday"
├── client: str | None (optional, required when location="Client Office")
├── notes: str | None (optional)
└── created_at: datetime (UTC, auto-generated)

No Employee entity - user_name is plain text string
No User/Role entity - no authentication system
No Audit/History entity - soft deletes not implemented
```

**Entity Relationships:**
- None (single table design)
- `user_name` has no foreign key or normalization
- No relationship to employee directory or HRIS

**Validation Layers:**
- **Frontend (React):** Field presence, client requirement, name input (lines 395-413 in `App.tsx`)
- **Backend (Pydantic):** Location enum, client requirement, date format (lines 7-33 in `schemas.py`)
- **Database (SQLModel):** No constraints beyond PK and indexes - **NO uniqueness constraints**

**Key Finding:** Missing `UNIQUE(user_name, date)` constraint allows duplicate entries per user per day.

---

## C. User Flows

### 1. Create Entry Flow

**Entry Points:**
- UI: "Fill my week" tab → enter name → fill week grid → "Save my week" button
- API: `POST /entries/bulk_upsert` with `BulkUpsertRequest`

**Preconditions:**
- User name must be non-empty (FE: `App.tsx:396`, BE: implicit via Pydantic)
- At least one entry in `entries` array (BE: `app.py:56-57`)

**Business Rules:**
1. **Name handling:** 
   - Stored as provided (preserves case)
   - Queried case-insensitively (BE: `app.py:73, 101, 309, 319`)
   - **Gap:** "John Smith" and "john smith" create separate entries but query as same user
2. **Location validation:**
   - Must be one of: "Neal Street", "WFH", "Client Office", "Holiday"
   - Legacy names auto-normalized: "Office"→"Neal Street", "Client"→"Client Office", "Off"/"PTO"→"Holiday" (BE: `schemas.py:17-26`)
   - Invalid location → 422 error (BE: `schemas.py:26`)
3. **Client requirement:**
   - Required when `location="Client Office"` (FE: `App.tsx:401-408`, BE: `schemas.py:31-32`)
   - Can be predefined client or "Other" (custom text) (FE: `App.tsx:355-365`)
   - Empty client → FE shows error, BE raises ValueError
4. **Date validation:**
   - Format: YYYY-MM-DD (string)
   - **No future/past date restrictions** - can submit for any date
   - **No weekday restriction** - can submit weekends (though UI only shows Mon-Fri)

**Process:**
1. Frontend generates 5 entries (Mon-Fri) from `weekStart` (FE: `App.tsx:68-84`)
2. User fills locations/clients/notes per day
3. Frontend validates: name present, clients required for "Client Office" (FE: `App.tsx:395-413`)
4. If existing entries detected (`existingEntriesCount > 0`), shows overwrite confirmation (FE: `App.tsx:423-426`)
5. Frontend sends `BulkUpsertRequest` to `/entries/bulk_upsert` (FE: `App.tsx:445-455`)
6. Backend deletes ALL existing entries for user in date range (case-insensitive) (BE: `app.py:64-80`)
7. Backend inserts new entries (BE: `app.py:82-96`)
8. Frontend shows success toast, switches to dashboard view (FE: `App.tsx:456-459`)

**Error States:**
- Validation error → Error message shown (FE: `App.tsx:418`), 400/422 returned (BE)
- Network error → Generic "Failed to save week" (FE: `App.tsx:471`)
- No specific handling for duplicate submission race conditions

**Gaps:**
- No idempotency key - retries create duplicates if network fails after delete but before insert
- No transaction rollback protection - partial failures leave data inconsistent
- No confirmation for future/backdated weeks

---

### 2. Edit Entry Flow

**Entry Points:**
- UI: "Edit my week" tab → search users → select user → loads their week → modify → "Update my week"
- API: Same `POST /entries/bulk_upsert` endpoint (no separate edit endpoint)

**Preconditions:**
- User must have existing entries for the week (to appear in edit list)
- Week selector must match week of entries

**Business Rules:**
1. **User discovery:**
   - "Edit my week" loads users who submitted entries for current week (`/summary/users?week_start=...`) (FE: `App.tsx:232`)
   - Falls back to all users (`/summary/all-users`) if week-specific query fails (FE: `App.tsx:236-238`)
   - **Security gap:** Any user can edit any other user's entries - no ownership check
2. **Loading existing data:**
   - Calls `/entries/check?user_name=...&week_start=...` (FE: `App.tsx:252`)
   - Backend returns entries with case-insensitive name match (BE: `app.py:319-321`)
   - Frontend populates form with existing values (FE: `App.tsx:258-272`)
3. **Save behavior:**
   - Identical to create flow - deletes all entries in range, inserts new (BE: `app.py:64-96`)
   - Shows "Week updated successfully!" message (FE: `App.tsx:456`)

**Conflict Handling:**
- **None** - Last write wins, no merge strategy
- Concurrent edits by same user → second save overwrites first completely
- Concurrent edits by different users → both succeed (different users, no collision)

**Gaps:**
- No "last modified" timestamp - cannot detect stale data
- No optimistic locking - concurrent edits cause data loss
- Edit flow exposes all user names to anyone

---

### 3. Delete Entry Flow

**Entry Points:**
- API: `DELETE /entries/{entry_id}` (BE: `app.py:207-230`)
- **No UI delete button** - deletion only via API or bulk replace

**Preconditions:**
- Entry ID must exist (404 if not found) (BE: `app.py:216-217`)

**Business Rules:**
1. **Hard delete** - permanently removes entry from database (BE: `app.py:219`)
2. **No ownership check** - anyone with entry ID can delete (no auth)
3. **No cascade** - standalone operation

**Error States:**
- 404 if entry_id not found
- 500 on database error

**Gaps:**
- No audit log of deletions
- No soft delete option
- Entry IDs exposed in API responses (could be enumerated)
- Single entry deletion not integrated into week workflow (must use bulk upsert to delete a day)

---

### 4. View/Filter/Export Flow

**Entry Points:**
- UI: "Who's where" tab → displays week summary
- API: `GET /summary/week?week_start=YYYY-MM-DD` (BE: `app.py:118-165`)
- API: `GET /entries?date_from=...&date_to=...` (optional filters) (BE: `app.py:168-204`)

**Preconditions:**
- Week start must be valid YYYY-MM-DD format

**Business Rules:**
1. **Week calculation:**
   - Week = Monday to Friday (5 days) (BE: `app.py:129`)
   - Query: `date >= week_start AND date <= week_start + 4 days` (BE: `app.py:134-136`)
   - Results ordered by date, then user_name (BE: `app.py:138`)
2. **Display grouping:**
   - Frontend groups by date → location → client (FE: `App.tsx:86-104, 515-984`)
   - "Client Office" entries further grouped by client name (FE: `App.tsx:924-960`)
   - Custom clients shown as "Other ({client})" (FE: `App.tsx:943`)
3. **Data visibility:**
   - **All entries visible to all users** - no filtering by viewer
   - User names, locations, clients, notes all exposed (BE: `app.py:144-152`)

**Filtering:**
- Date range via `date_from`/`date_to` query params (BE: `app.py:180-183`)
- No user filter - all users included
- No location filter - all locations included

**Export:**
- **No export functionality** - data only visible via dashboard UI
- Weekly report email exists (`/admin/send-weekly-report`) but not user-initiated

**Gaps:**
- No pagination - returns all entries for week (could be large)
- No user-level filtering - cannot view only own entries
- No CSV/Excel export option
- Dashboard shows everyone's data to everyone (privacy concern)

---

## D. Validation Matrix

| Field | Rule | Source (file:line) | Enforced Where | Error Message | Edge Cases |
|-------|------|-------------------|----------------|---------------|------------|
| `user_name` | Non-empty string | `App.tsx:396`, implicit in `BulkUpsertRequest` | FE + BE (Pydantic) | "Please enter your name" | Case sensitivity mismatch (stored case-sensitive, queried case-insensitive) |
| `date` | YYYY-MM-DD format | `app.py:158, 288` | BE (datetime.strptime) | "Invalid date format. Use YYYY-MM-DD" | No validation for future dates, past dates, weekends, or invalid dates (e.g., 2024-02-30) |
| `location` | Must be in enum: {"Neal Street", "WFH", "Client Office", "Holiday"} | `schemas.py:13-26`, `types.ts:30` | FE (dropdown) + BE (Pydantic) | "Location must be one of: {...}" | Legacy names auto-normalized ("Office"→"Neal Street") but inconsistency possible if backend not updated |
| `client` | Required when `location="Client Office"` | `schemas.py:31-32`, `App.tsx:401-408` | FE + BE | "Client name is required for {dayName}" | Empty string after trim → undefined (BE accepts), but FE validation catches before submit |
| `client` | Non-empty when `isCustomClient=true` | `App.tsx:403` | FE only | "Please enter a client name for {dayName}" | BE allows empty client if not "Client Office" |
| `notes` | Optional, free text | No validation | N/A | N/A | No length limit, no sanitization (XSS risk if rendered unsafely) |
| Entry count | At least one entry required | `app.py:56-57` | BE | "No entries provided" | Empty array allowed in request but rejected |

**Uniqueness Validation:**
- **NONE** - No check for duplicate (user_name, date) pairs
- Backend allows multiple entries per user per day
- Upsert behavior deletes ALL entries for user in date range, then inserts new (BE: `app.py:64-96`)
- **Gap:** Two simultaneous requests for same user/week can create duplicates if delete happens after other's insert

---

## E. Permission Matrix

| Action | Self | Manager | Admin | Anonymous | Notes |
|--------|------|---------|-------|------------|-------|
| Create own entries | ✅ | ✅ | ✅ | ✅ | **No authentication - anyone can create entries for any name** |
| Edit own entries | ✅ | ✅ | ✅ | ✅ | "Edit my week" allows selecting any user (FE: `App.tsx:280-285`) |
| Edit others' entries | ✅ | ✅ | ✅ | ✅ | **No ownership check - full access to all users' data** |
| Delete entry | ✅ | ✅ | ✅ | ✅ | API accepts entry_id, no auth check (BE: `app.py:207`) |
| View own entries | ✅ | ✅ | ✅ | ✅ | Dashboard shows all entries for all users |
| View others' entries | ✅ | ✅ | ✅ | ✅ | **No filtering - everyone sees everyone's data** |
| View user list | ✅ | ✅ | ✅ | ✅ | `/summary/all-users` and `/summary/users` expose all names |
| Admin endpoints | ❌ | ❌ | ❌ | ✅ | `/admin/migrate-locations`, `/admin/send-weekly-report`, `/admin/debug` - **all publicly accessible** |

**Key Finding:** **Zero authentication or authorization** - system is completely open. Any anonymous user can:
- Create/edit/delete entries for any employee name
- View all employee location data
- Call admin endpoints (migrate data, send emails, debug)

**Risk:** Malicious actors can:
1. Submit fake entries for executives/managers
2. Delete all entries for a user
3. Harvest employee names and work patterns
4. Trigger email spam via report endpoint

---

## F. Edge Cases & Conflict Resolution

### 1. Duplicate Same Day

**Scenario:** User submits two entries for same date (e.g., "John Smith", "2024-01-15")

**Expected Behavior:** Single entry per user per day

**Actual Behavior:** **ALLOWED** - Database has no uniqueness constraint. Multiple entries created. Query returns all duplicates (BE: `app.py:64-68` fetches all, no deduplication).

**Reference:** `models.py:6-13` (no `unique=True` on `user_name` or `date`), `app.py:64-96` (upsert deletes by date range, not by unique key)

**Mitigation:** Upsert deletes existing entries before insert (BE: `app.py:76-80`), but only within the submitted date range. If user submits partial week, old entries outside range remain.

---

### 2. Overlapping Entries

**Scenario:** User submits week Mon-Fri, then submits Wed-Fri again with different locations

**Expected Behavior:** Wednesday-Friday replaced, Monday-Tuesday preserved

**Actual Behavior:** **PARTIALLY CORRECT** - Upsert deletes entries in submitted date range (`min_date` to `max_date`) (BE: `app.py:59-80`). Monday-Tuesday outside range remain. **BUT:** If two requests overlap (e.g., both include Wednesday), last write wins with no merge.

**Reference:** `app.py:59-80`

**Gap:** No merge strategy - cannot update single day without affecting other days in range.

---

### 3. Future/Backdated Entries

**Scenario:** User submits entry for date 6 months in future or 1 year in past

**Expected Behavior:** Business rule unclear - system accepts any valid YYYY-MM-DD date

**Actual Behavior:** **ALLOWED** - No date validation beyond format check (BE: `app.py:158-162` only validates format, not range).

**Reference:** `app.py:118-165` (week summary), `app.py:168-204` (entries list) - no date bounds

**Gap:** Can create entries for historical dates (e.g., 2020-01-01) or far future (e.g., 2030-12-31), potentially polluting reports.

---

### 4. Leave + Work Same Day

**Scenario:** User submits both "Holiday" and "Neal Street" for same date

**Expected Behavior:** Single entry per day (should be prevented)

**Actual Behavior:** **ALLOWED** - Database permits multiple entries. Upsert deletes all entries for user in date range before inserting new batch (BE: `app.py:76-96`), so user can only have one entry per date **within a single submission**, but multiple submissions create duplicates.

**Reference:** `app.py:64-96` - no uniqueness constraint prevents duplicates across requests

---

### 5. Cross-Timezone Submission

**Scenario:** User in timezone UTC+10 submits entry at 11 PM local time (1 AM UTC next day)

**Expected Behavior:** Date should use user's local timezone or UTC consistently

**Actual Behavior:** **FRONTEND USES LOCAL DATE** - `formatDate()` uses `toISOString().split('T')[0]` which converts to local date (FE: `App.tsx:14-16`). If user selects date in their timezone, backend stores as-is (string, no timezone conversion). **Inconsistent:** Server `created_at` uses UTC (BE: `models.py:13`), but `date` field is timezone-agnostic string.

**Reference:** `App.tsx:14-16`, `models.py:13`

**Gap:** Users in different timezones can submit entries for different "days" for the same UTC moment, causing confusion.

---

### 6. Import Collisions

**Scenario:** CSV import with duplicate rows for same user/date

**Expected Behavior:** Deduplication or last-write-wins

**Actual Behavior:** **N/A** - No import functionality exists. If implemented, would need deduplication logic.

**Reference:** No import code found

---

### 7. Concurrent Edits

**Scenario:** User A and User B both edit "John Smith"'s week simultaneously

**Expected Behavior:** Last write wins or conflict detection

**Actual Behavior:** **LAST WRITE WINS** - No optimistic locking. Both requests delete existing entries, then insert new. Whichever commit happens last wins. Earlier commit's data is lost.

**Reference:** `app.py:76-96` - no version checking or transaction isolation documented

**Gap:** No `updated_at` or `version` field to detect conflicts. Users can overwrite each other's changes unknowingly.

---

### 8. Missing Employee Mapping

**Scenario:** User submits entry for employee name that doesn't exist in HRIS

**Expected Behavior:** Validation or warning

**Actual Behavior:** **ALLOWED** - `user_name` is free text, no validation against employee directory. Any string accepted.

**Reference:** `models.py:8` (no FK or enum), `schemas.py:37` (plain string)

**Gap:** Typos in names create separate "users" (e.g., "John Smith" vs "Jon Smith"). Case-insensitive queries help but don't prevent all variations.

---

### 9. Location Not in Enum

**Scenario:** Direct API call with `location="Remote"` (not in allowed set)

**Expected Behavior:** Rejection with clear error

**Actual Behavior:** **REJECTED** - Pydantic validator raises `ValueError` (BE: `schemas.py:26`), returns 422 status.

**Reference:** `schemas.py:13-26`, `test_api.py:70-84` (test case exists)

**Status:** ✅ **HANDLED CORRECTLY**

---

### 10. Empty State & Bulk Actions

**Scenario:** Dashboard with no entries for week

**Expected Behavior:** Clear empty state message

**Actual Behavior:** **HANDLED** - Frontend shows "No entries found for this week" (FE: `App.tsx:898-902`). API returns empty array (BE: `app.py:141`).

**Reference:** `App.tsx:898-902`, `app.py:141`

**Status:** ✅ **HANDLED CORRECTLY**

**Bulk Actions:**
- "All Office" preset fills entire week with "Neal Street" (FE: `App.tsx:373-393`)
- "All WFH" preset fills with "WFH"
- No bulk delete across weeks
- No bulk export

---

## G. Data Integrity & Idempotency

### Uniqueness Constraints

**Database Level:** **NONE**
- No `UNIQUE(user_name, date)` constraint (BE: `models.py:6-13` only has indexes, not unique constraints)
- Multiple entries per user per day allowed

**Application Level:**
- Upsert deletes existing entries for user in date range before insert (BE: `app.py:76-80`)
- Case-insensitive name matching (BE: `app.py:73, 309, 319`)
- **Gap:** Two concurrent upserts can both delete, then both insert, creating duplicates

**Recommendation:** Add database constraint:
```python
# In models.py (NOT implemented)
user_name: str = Field(index=True, unique=False)  # Current
date: str = Field(index=True, unique=False)  # Current
# Should be: UNIQUE(user_name, date) at DB level
```

---

### Upsert Behavior

**Pattern:** Delete-then-insert (BE: `app.py:76-96`)

**Process:**
1. Fetch all entries in date range (BE: `app.py:64-68`)
2. Filter by case-insensitive user_name match (BE: `app.py:71-74`)
3. Delete matching entries (BE: `app.py:78-80`)
4. Commit deletions (BE: `app.py:80`)
5. Insert new entries (BE: `app.py:82-96`)
6. Commit inserts (BE: `app.py:96`)

**Idempotency:** **PARTIAL**
- Same request submitted twice → second request finds no existing entries (deleted by first), inserts duplicates
- **Not idempotent** - requires idempotency key or "insert or update" pattern

**Transaction Safety:** **RISKY**
- Separate commits for delete and insert (BE: `app.py:80, 96`)
- If insert fails after delete commits, data is lost (no rollback)
- If delete fails, old entries remain alongside new (duplicates)

---

### Soft vs Hard Deletes

**Current:** **HARD DELETE ONLY**
- `DELETE /entries/{entry_id}` permanently removes entry (BE: `app.py:219`)
- Upsert delete permanently removes entries (BE: `app.py:78-79`)
- No `deleted_at` or `is_deleted` flag

**Audit Fields:**
- `created_at` exists (BE: `models.py:13`) - UTC timestamp auto-generated
- **NO `updated_at`** - cannot track modifications
- **NO `created_by` or `updated_by`** - cannot attribute changes (no auth system)

**Gap:** No way to recover accidentally deleted entries or track who made changes.

---

### Audit Fields

**Present:**
- `created_at: datetime` (UTC, auto-set on insert) (BE: `models.py:13`)

**Missing:**
- `updated_at: datetime` - no tracking of modifications
- `updated_by: str` - no attribution (no user system)
- `deleted_at: datetime` - no soft delete support
- `version: int` - no optimistic locking

**Logging:**
- Application logs record actions with user_name (BE: `app.py:51, 95, 124, 175, 210, etc.`)
- No structured audit log table
- Logs may not persist long-term (depending on hosting)

---

## H. Privacy & Compliance

### Data Minimization

**Fields Collected:**
- `user_name` (required) - employee identifier
- `date` (required) - work date
- `location` (required) - work location enum
- `client` (conditional) - client name when location="Client Office"
- `notes` (optional) - free text notes

**Fields vs Needed:**
- All fields appear necessary for core function (tracking work locations)
- `notes` field may contain PII or sensitive info (no validation/length limit)
- `client` field may expose business relationships

**Gap:** No data retention policy - entries persist indefinitely with no archival or deletion workflow.

---

### Location Sensitivity Handling

**Location Types:**
- "Neal Street" - office address (not sensitive)
- "WFH" - work from home (sensitive - reveals home address if precise)
- "Client Office" - client name + location (sensitive - business relationships)
- "Holiday" - personal time off (sensitive - health/leave status)

**Current Handling:**
- **ALL locations visible to ALL users** via dashboard (BE: `app.py:118-165`, FE: `App.tsx:890-989`)
- No role-based filtering
- No anonymization for sensitive locations

**Risk:** Employees can see:
- Who is on holiday (health/leave privacy)
- Client assignments (competitive information)
- Home work patterns (security risk if home addresses inferred)

---

### Role-Based Visibility

**Current:** **NONE**
- All entries visible to all users (BE: `app.py:144-152` returns all entries, no filtering)
- Dashboard shows full employee list and locations (FE: `App.tsx:890-989`)
- `/summary/all-users` exposes all employee names (BE: `app.py:233-253`)

**Gap:** No "view own entries only" mode or manager-only views.

---

### Retention/Erasure Paths

**Retention:** **NO POLICY**
- Entries stored indefinitely (no `deleted_at` or archival)
- No automated cleanup of old data
- No GDPR-style "right to be forgotten" workflow

**Erasure:**
- Manual deletion via API (`DELETE /entries/{entry_id}`) (BE: `app.py:207-230`)
- Bulk deletion via upsert (delete entries in range) (BE: `app.py:76-80`)
- **No audit trail of deletions** - cannot verify data removal

**Gap:** Cannot comply with data retention regulations or user deletion requests with audit proof.

---

### Export/Download Safeguards

**Export Functionality:** **NONE**
- No CSV/Excel export in UI
- Weekly report email (`/admin/send-weekly-report`) sends HTML table (BE: `report.py:42-110`)
- Report includes all users' data (BE: `report.py:26-39`)

**Safeguards:**
- **NONE** - report endpoint publicly accessible (no auth)
- Email recipients configurable via env var or query param (BE: `app.py:396`)
- No access logging for exports

**Risk:** Malicious actor can trigger email spam with employee data to arbitrary recipients.

---

## I. Telemetry & Observability

### Events Logged

**Application Logs (Python logging):**
- Bulk upsert requests: `logger.info(f"Bulk upsert request for user: {request.user_name}")` (BE: `app.py:51`)
- Successful saves: `logger.info(f"Successfully upserted {len(new_entries)} entries...")` (BE: `app.py:106-109`)
- Entry deletions: `logger.info(f"Deleting {len(entries_to_delete)} existing entries...")` (BE: `app.py:77`)
- Week summary requests: `logger.info(f"Week summary request for week starting: {week_start}")` (BE: `app.py:124`)
- Entry list requests: `logger.info(f"Entries request - from: {date_from}, to: {date_to}")` (BE: `app.py:175`)
- Delete requests: `logger.info(f"Delete entry request for ID: {entry_id}")` (BE: `app.py:210`)
- User list requests: `logger.info("All users request")` (BE: `app.py:238`)
- Check entries: `logger.info(f"Check entries request for user: {user_name}, week: {week_start}")` (BE: `app.py:304`)
- Errors: `logger.error(...)` for exceptions (throughout)

**PII Exposure in Logs:**
- ✅ **User names logged** (BE: `app.py:51, 95, etc.`) - PII
- ✅ **Dates logged** - not PII but sensitive
- ❌ **Client names not logged** (only in error messages if validation fails)
- ❌ **Notes not logged** (only in error messages)

**Frontend Logging:** **NONE** - No client-side event logging or error tracking service.

---

### Traceability

**Request → Backend → DB:**
- Request logs include user_name and parameters (BE: `app.py:51, 124, 175, etc.`)
- Database stores `created_at` timestamp (BE: `models.py:13`)
- **Gap:** No request ID or correlation ID - cannot trace request through logs
- **Gap:** No `updated_at` - cannot see when entry was last modified

**Attribution:**
- **IMPOSSIBLE** - No authentication, so cannot attribute actions to specific user/IP
- Logs show `user_name` from request (could be spoofed)
- No IP address logging (could be added via FastAPI request object, but not implemented)

---

### Gaps in Auditability

1. **No user authentication** - cannot prove who made changes
2. **No request IDs** - cannot correlate logs across services
3. **No `updated_at`** - cannot see modification history
4. **No soft deletes** - deletions are permanent, no audit trail
5. **No change history** - overwrites lose previous values
6. **Frontend actions not logged** - only API calls logged
7. **No export audit** - weekly reports sent without logging recipient list

---

## J. Risk Register

| ID | Risk | Severity | Likelihood | Evidence | Suggested Mitigation |
|----|------|----------|------------|----------|---------------------|
| R1 | No authentication - anyone can modify any user's data | H | H | `app.py:36-43` (CORS allows all), no auth middleware | Implement authentication (OAuth2, API keys, or session-based) |
| R2 | No uniqueness constraint - duplicate entries per user/day | H | M | `models.py:6-13` (no unique constraint), `app.py:64-96` (upsert race condition) | Add `UNIQUE(user_name, date)` constraint at database level |
| R3 | Case-sensitive name storage with case-insensitive queries causes duplicates | H | M | `app.py:73, 309, 319` (case-insensitive queries), `models.py:8` (case-sensitive storage) | Normalize `user_name` to lowercase on insert, or add case-insensitive unique constraint |
| R4 | All employee data visible to everyone | M | H | `app.py:118-165` (no filtering), `App.tsx:890-989` (dashboard shows all) | Implement role-based access control, filter dashboard by viewer |
| R5 | No audit trail - cannot track who made changes | M | H | `models.py:6-13` (no `updated_at`/`updated_by`), no auth system | Add audit fields and require authentication for writes |
| R6 | Concurrent edits cause data loss (last write wins) | M | M | `app.py:76-96` (no optimistic locking), no `version` field | Add optimistic locking with version field or ETags |
| R7 | Admin endpoints publicly accessible | M | H | `app.py:345, 394, 439` (no auth check) | Require authentication/authorization for `/admin/*` endpoints |
| R8 | Transaction safety - separate commits for delete/insert risk data loss | M | M | `app.py:80, 96` (two commits) | Use single transaction with rollback on error |
| R9 | No idempotency - retries create duplicates | M | L | `app.py:46-115` (no idempotency key) | Add idempotency key to requests, or use insert-or-update pattern |
| R10 | XSS risk in notes field (if rendered unsafely) | L | L | `models.py:12` (no sanitization), FE rendering not reviewed | Sanitize `notes` on input/output, use React's automatic escaping |
| R11 | No date validation - future/past dates allowed | L | M | `app.py:158-162` (only format check) | Add business rule validation (e.g., no dates > 1 year future) |
| R12 | Timezone inconsistencies between `date` (string) and `created_at` (UTC) | L | L | `App.tsx:14-16` (local date), `models.py:13` (UTC timestamp) | Standardize on UTC for all date fields or document timezone behavior |
| R13 | No data retention policy - entries persist indefinitely | L | H | No archival/cleanup code found | Implement archival policy (e.g., archive entries > 2 years old) |
| R14 | Weekly report endpoint can be abused for email spam | L | M | `app.py:394-436` (no auth), recipients via query param | Require authentication and rate limiting for report endpoint |

---

## K. Checklist Verdicts

| Checklist Item | Verdict | Notes |
|---------------|---------|-------|
| Minimal viable fields enforced? | ✅ Y | `user_name`, `date`, `location` required; `client` required conditionally |
| Clear error messages aligned with rules? | ⚠️ PARTIAL | Frontend messages clear (FE: `App.tsx:397, 404, 407`), but backend returns generic Pydantic errors (422) |
| Duplicate-day prevention? | ❌ N | No uniqueness constraint, duplicates allowed across concurrent requests |
| Consistent enums for location? | ✅ Y | Enum validated in BE (`schemas.py:24`), dropdown in FE (`App.tsx:808-812`), legacy names normalized |
| Role/permission contradictions? | ❌ N | **No roles exist** - system is completely open |
| Privacy red flags? | ❌ N | All data visible to all users, no filtering, sensitive locations exposed |
| Reliable exports without leaking PII? | ⚠️ N/A | No export functionality (except admin email report, which has no access control) |

---

## Appendix: File Reference Index

**Backend Core:**
- `backend/models.py` - Entry SQLModel definition
- `backend/schemas.py` - Pydantic validation schemas
- `backend/app.py` - FastAPI endpoints and business logic
- `backend/db.py` - Database connection and session management

**Frontend Core:**
- `frontend/src/App.tsx` - Main React component with all user flows
- `frontend/src/types.ts` - TypeScript type definitions
- `frontend/src/api.ts` - API client functions

**Tests:**
- `backend/tests/test_api.py` - API endpoint tests

**Configuration:**
- `backend/requirements.txt` - Python dependencies
- `render.yaml` - Deployment configuration

---

**Report End**

