import React, { useState, useEffect, useRef } from 'react'
import { WeekEntry, WorkLocation, SummaryRow } from './types'
import { saveWeek, getWeekSummary, checkExistingEntries, getUserEntriesForWeek, getUsersForWeek } from './api'
// Load team and client lists from public at runtime (no imports from root)

type ViewMode = 'fill' | 'dashboard' | 'edit'

function getMondayOfWeek(date: Date): Date {
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
  return new Date(date.setDate(diff))
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function getDayName(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    dates.push(d)
  }
  return dates
}

function generateWeekEntries(weekStart: Date): WeekEntry[] {
  const entries: WeekEntry[] = []
  // Only generate Monday-Friday (5 days)
  for (let i = 0; i < 5; i++) {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + i)
      entries.push({
        date: formatDate(date),
        dayName: getDayName(date),
        location: 'Neal Street' as WorkLocation,
        client: '',
        notes: '',
        isCustomClient: false,
      })
  }
  return entries
}

function groupEntriesByDateAndLocation(entries: SummaryRow[]): {
  [date: string]: {
    [location: string]: SummaryRow[]
  }
} {
  return entries.reduce(
    (groups, entry) => {
      if (!groups[entry.date]) {
        groups[entry.date] = {}
      }
      if (!groups[entry.date][entry.location]) {
        groups[entry.date][entry.location] = []
      }
      groups[entry.date][entry.location].push(entry)
      return groups
    },
    {} as { [date: string]: { [location: string]: SummaryRow[] } }
  )
}

// Unused but kept for future use
// function groupEntriesByDate(entries: SummaryRow[]): {
//   [date: string]: SummaryRow[]
// } {
//   return entries.reduce(
//     (groups, entry) => {
//       if (!groups[entry.date]) {
//         groups[entry.date] = []
//       }
//       groups[entry.date].push(entry)
//       return groups
//     },
//     {} as { [date: string]: SummaryRow[] }
//   )
// }

function getLocationBadgeClass(location: string): string {
  switch (location.toLowerCase()) {
    case 'neal street':
      return 'location-office'
    case 'wfh':
      return 'location-wfh'
    case 'client office':
      return 'location-client'
    case 'holiday':
      return 'location-off'
    default:
      return ''
  }
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('fill')
  const [weekStart, setWeekStart] = useState<Date>(getMondayOfWeek(new Date()))
  const [userName, setUserName] = useState(() => {
    // Load from localStorage on mount
    return localStorage.getItem('workTrackerUserName') || ''
  })
  const [weekEntries, setWeekEntries] = useState<WeekEntry[]>([])
  const [summaryEntries, setSummaryEntries] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [existingEntriesCount, setExistingEntriesCount] = useState(0)
  const [isEditMode, setIsEditMode] = useState(false)
  const [userList, setUserList] = useState<string[]>([])
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [userSearchTerm, setUserSearchTerm] = useState('')
  
  // Overwrite confirmation + undo
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)
  const [isOverwriteConfirmed, setIsOverwriteConfirmed] = useState(false)
  const [backupBeforeSave, setBackupBeforeSave] = useState<Array<{date: string; location: string; client?: string; notes?: string}>>([])
  const [showUndoBar, setShowUndoBar] = useState(false)
  
  // Runtime-loaded config
  const [allUsers, setAllUsers] = useState<string[]>([])
  const [clientOptions, setClientOptions] = useState<string[]>([])

  // Save user name to localStorage whenever it changes
  useEffect(() => {
    if (userName.trim()) {
      localStorage.setItem('workTrackerUserName', userName.trim())
    }
  }, [userName])

  // Initialize week entries when week start changes
  useEffect(() => {
    setWeekEntries(generateWeekEntries(weekStart))
  }, [weekStart])

  // Load client and team lists from public at runtime
  useEffect(() => {
    const loadConfigs = async () => {
      try {
        const [clientsResp, teamResp] = await Promise.all([
          fetch('/clients.json'),
          fetch('/team-members.json'),
        ])
        const clientsJson = await clientsResp.json()
        const teamJson = await teamResp.json()
        setClientOptions(Array.isArray(clientsJson?.clients) ? clientsJson.clients : [])
        setAllUsers(Array.isArray(teamJson?.teamMembers) ? teamJson.teamMembers : [])
      } catch (e) {
        setClientOptions([])
        setAllUsers([])
      }
    }
    loadConfigs()
  }, [])

  // Load summary when switching to dashboard view
  useEffect(() => {
    if (viewMode === 'dashboard') {
      loadWeekSummary()
    }
  }, [viewMode, weekStart])

  // Check for existing entries when user name or week changes
  useEffect(() => {
    const checkForExisting = async () => {
      if (userName.trim()) {
        try {
          const result = await checkExistingEntries(userName.trim(), formatDate(weekStart))
          setExistingEntriesCount(result.exists ? result.count : 0)
        } catch (err) {
          setExistingEntriesCount(0)
        }
      } else {
        setExistingEntriesCount(0)
      }
    }
    checkForExisting()
  }, [userName, weekStart])

  // Load user list when in edit mode
  useEffect(() => {
    if (viewMode === 'edit') {
      loadUserList()
    }
  }, [viewMode, weekStart])

  const loadUserList = async () => {
    try {
      setLoading(true)
      const result = await getUsersForWeek(formatDate(weekStart))
      setUserList(result.users)
    } catch (err) {
      setError('Failed to load user list')
      setUserList([])
    } finally {
      setLoading(false)
    }
  }

  const loadExistingEntries = async (user: string, week: string) => {
    try {
      setLoading(true)
      const existingEntries = await getUserEntriesForWeek(user, week)
      
      // Create a map of existing entries by date
      const entriesMap = new Map(existingEntries.map(entry => [entry.date, entry]))
      
      // Update week entries with existing data
      const updatedEntries = weekEntries.map(entry => {
        const existing = entriesMap.get(entry.date)
        if (existing) {
          return {
            ...entry,
            location: existing.location as WorkLocation,
            client: existing.client || '',
            notes: existing.notes || '',
            isCustomClient: !clientOptions.includes(existing.client || '')
          }
        }
        return entry
      })
      
      setWeekEntries(updatedEntries)
    } catch (err) {
      setError('Failed to load existing entries')
    } finally {
      setLoading(false)
    }
  }

  const handleUserSelect = async (selectedUser: string) => {
    setUserName(selectedUser)
    setIsEditMode(true)
    setViewMode('fill')
    await loadExistingEntries(selectedUser, formatDate(weekStart))
  }

  const loadWeekSummary = async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getWeekSummary(formatDate(weekStart))
      setSummaryEntries(response.entries)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load week summary'
      )
    } finally {
      setLoading(false)
    }
  }

  const handleWeekStartChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedDate = new Date(event.target.value)
    const monday = getMondayOfWeek(selectedDate)
    setWeekStart(monday)
  }

  const goToPrevWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    setWeekStart(getMondayOfWeek(d))
  }

  const goToNextWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    setWeekStart(getMondayOfWeek(d))
  }

  const openNativeDatePicker = () => {
    const el = dateInputRef.current
    if (!el) return
    // @ts-expect-error: showPicker not in all TS lib dom types
    if (typeof el.showPicker === 'function') {
      // @ts-ignore
      el.showPicker()
    } else {
      el.focus()
      el.click()
    }
  }

  const handleLocationChange = (index: number, location: WorkLocation) => {
    const newEntries = [...weekEntries]
    newEntries[index].location = location
    if (location !== 'Client Office') {
      newEntries[index].client = ''
      newEntries[index].isCustomClient = false
    }
    setWeekEntries(newEntries)
  }

  const handleClientChange = (index: number, client: string) => {
    const newEntries = [...weekEntries]
    newEntries[index].client = client
    setWeekEntries(newEntries)
  }

  const handleClientTypeChange = (index: number, clientType: string) => {
    const newEntries = [...weekEntries]
    if (clientType === 'Other') {
      newEntries[index].isCustomClient = true
      newEntries[index].client = ''
    } else {
      newEntries[index].isCustomClient = false
      newEntries[index].client = clientType
    }
    setWeekEntries(newEntries)
  }

  const handleNotesChange = (index: number, notes: string) => {
    const newEntries = [...weekEntries]
    newEntries[index].notes = notes
    setWeekEntries(newEntries)
  }

  const applyPreset = (presetType: 'all-office' | 'all-wfh' | 'hybrid') => {
    const newEntries = [...weekEntries]
    
    if (presetType === 'all-office') {
      newEntries.forEach(entry => {
        entry.location = 'Neal Street'
        entry.client = ''
        entry.notes = ''
      })
    } else if (presetType === 'all-wfh') {
      newEntries.forEach(entry => {
        entry.location = 'WFH'
        entry.client = ''
        entry.notes = ''
      })
    } else if (presetType === 'hybrid') {
      // 3 days office, 2 days WFH
      newEntries.forEach((entry, index) => {
        if (index < 3) {
          entry.location = 'Neal Street'
          entry.client = ''
        } else {
          entry.location = 'WFH'
          entry.client = ''
        }
        entry.notes = ''
      })
    }
    
    setWeekEntries(newEntries)
    setToast('Preset applied!')
    setTimeout(() => setToast(''), 2000)
  }

  const validateEntries = (): string | null => {
    if (!userName.trim()) {
      return 'Please enter your name'
    }

    for (const entry of weekEntries) {
      if (entry.location === 'Client Office') {
        // If "Other" was selected, isCustomClient=true and client must be non-empty
        if (entry.isCustomClient && !entry.client.trim()) {
          return `Please enter a client name for ${entry.dayName}`
        }
        if (!entry.isCustomClient && !entry.client.trim()) {
          return `Client name is required for ${entry.dayName}`
        }
      }
    }

    return null
  }

  const handleSaveWeek = async () => {
    const validationError = validateEntries()
    if (validationError) {
      setError(validationError)
      return
    }

    // Require explicit confirmation if overwriting
    if (existingEntriesCount > 0 && !isOverwriteConfirmed) {
      setShowOverwriteConfirm(true)
      return
    }

    try {
      setLoading(true)
      setError('')

      // Backup current entries from DB (for undo) if we are overwriting
      let backup: Array<{date: string; location: string; client?: string; notes?: string}> = []
      if (existingEntriesCount > 0) {
        try {
          const current = await getUserEntriesForWeek(userName.trim(), formatDate(weekStart))
          backup = current.map(e => ({ date: e.date, location: e.location, client: e.client, notes: e.notes }))
          setBackupBeforeSave(backup)
        } catch {
          // if backup fails, proceed without undo
          setBackupBeforeSave([])
        }
      }

      const request = {
        user_name: userName.trim(),
        entries: weekEntries.map((entry) => ({
          date: entry.date,
          location: entry.location,
          client: entry.client.trim() || undefined,
          notes: entry.notes.trim() || undefined,
        })),
      }

      await saveWeek(request)
      setToast(isEditMode ? 'Week updated successfully!' : 'Week saved successfully!')
      setTimeout(() => setToast(''), 3000)
      setIsEditMode(false)
      setViewMode('dashboard')

      if (existingEntriesCount > 0 && backup.length > 0) {
        setShowUndoBar(true)
        // auto-hide undo after 15s
        setTimeout(() => setShowUndoBar(false), 15000)
      }

      // reset confirmation state
      setShowOverwriteConfirm(false)
      setIsOverwriteConfirmed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save week')
    } finally {
      setLoading(false)
    }
  }

  const confirmOverwriteAndSave = async () => {
    setIsOverwriteConfirmed(true)
    setShowOverwriteConfirm(false)
    await handleSaveWeek()
  }

  const cancelOverwrite = () => {
    setShowOverwriteConfirm(false)
    setIsOverwriteConfirmed(false)
  }

  const handleUndo = async () => {
    if (!backupBeforeSave.length) {
      setShowUndoBar(false)
      return
    }
    try {
      setLoading(true)
      const request = {
        user_name: userName.trim(),
        entries: backupBeforeSave.map(e => ({
          date: e.date,
          location: e.location as any,
          client: e.client || undefined,
          notes: e.notes || undefined,
        })),
      }
      await saveWeek(request)
      setToast('Reverted previous entries')
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setError('Failed to undo changes')
    } finally {
      setShowUndoBar(false)
      setLoading(false)
    }
  }

  const groupedEntries = groupEntriesByDateAndLocation(summaryEntries)

  // Define location order for consistent display
  const locationOrder = ['Neal Street', 'WFH', 'Client Office', 'Holiday']

  const dateInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="container">
      <div className="header">
        <div className="header-content">
          <img src="/logo.jpg" alt="Logo" className="logo" />
          <div className="header-text">
            <h1>Work Location Tracker</h1>
            <p>Track where your team will work each day of the week</p>
          </div>
        </div>
      </div>

      <div className="toggle-buttons">
        <button
          className={`toggle-btn ${viewMode === 'fill' ? 'active' : ''}`}
          onClick={() => {
            setViewMode('fill')
            setIsEditMode(false)
          }}
        >
          Fill my week
        </button>
        <button
          className={`toggle-btn ${viewMode === 'edit' ? 'active' : ''}`}
          onClick={() => {
            setViewMode('edit')
            setIsEditMode(false)
          }}
        >
          Edit my week
        </button>
        <button
          className={`toggle-btn ${viewMode === 'dashboard' ? 'active' : ''}`}
          onClick={() => setViewMode('dashboard')}
        >
          Who's where
        </button>
      </div>

      <div className="week-selector">
        <label htmlFor="week-start">Week starting:</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="preset-btn" type="button" onClick={goToPrevWeek}>{'<'} Prev</button>
          <input
            ref={dateInputRef}
            id="week-start"
            type="date"
            value={formatDate(weekStart)}
            onChange={handleWeekStartChange}
          />
          <button className="preset-btn" type="button" onClick={goToNextWeek}>Next {'>'}</button>
          <button className="preset-btn" type="button" onClick={openNativeDatePicker}>
            Open calendar
          </button>
        </div>

        {/* Week strip highlighting Mon–Fri */}
        <div style={{ marginTop: 12 }}>
          <div style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap'
          }}>
            {getWeekDates(weekStart).map((d, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  // Allow selecting any day; snap to Monday of that day
                  const monday = getMondayOfWeek(new Date(d))
                  setWeekStart(new Date(monday))
                }}
                title={d.toDateString()}
                style={{
                  padding: '8px 10px',
                  border: '2px solid #ffffff',
                  background: '#000000',
                  color: '#ffffff',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: 1,
                }}
              >
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
                {' '}
                {d.getDate()}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 6, color: '#cccccc', fontSize: 12 }}>
            Select any day; we’ll highlight the whole week.
          </div>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {toast && <div className="toast">{toast}</div>}

      {viewMode === 'edit' && (
        <div className="form-section">
          <h2>Select your name to edit:</h2>
          {loading ? (
            <div className="empty-state">
              <h3>Loading...</h3>
            </div>
          ) : userList.length === 0 ? (
            <div className="empty-state">
              <h3>No entries found for this week</h3>
              <p>No one has submitted their work locations yet.</p>
            </div>
          ) : (
            <div className="user-list">
              {userList.map((user, index) => (
                <button
                  key={index}
                  className="user-card"
                  onClick={() => handleUserSelect(user)}
                  type="button"
                >
                  {user}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {viewMode === 'fill' && (
        <div className="form-section">
          {/* Overwrite confirmation bar */}
          {showOverwriteConfirm && (
            <div style={{
              marginBottom: '12px',
              padding: '12px 16px',
              background: '#1a1a00',
              border: '2px solid #ffff00',
              borderRadius: '8px',
              color: '#ffffcc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px'
            }}>
              <div style={{ fontWeight: 700 }}>
                Update week for {userName.trim()}? This replaces previous entries.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="preset-btn" onClick={cancelOverwrite} type="button">Cancel</button>
                <button className="preset-btn" onClick={confirmOverwriteAndSave} type="button" style={{ borderColor: '#00ff00' }}>Confirm update</button>
              </div>
            </div>
          )}
          <div className="form-group" style={{ position: 'relative' }}>
            <label htmlFor="user-name">Your name:</label>
            <div style={{ position: 'relative' }}>
              <input
                id="user-name"
                type="text"
                value={userName}
                onChange={(e) => {
                  setUserName(e.target.value)
                  setUserSearchTerm(e.target.value)
                  setShowUserDropdown(true)
                }}
                onFocus={() => setShowUserDropdown(true)}
                onBlur={() => setTimeout(() => setShowUserDropdown(false), 200)}
                placeholder="Search or enter your name"
                required
              />
              {showUserDropdown && (
                <div 
                  className="user-dropdown"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    marginTop: '4px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                  }}
                >
            {allUsers
                    .filter(user => 
                      user.toLowerCase().includes(userSearchTerm.toLowerCase())
                    )
                    .slice(0, 10)
                    .map((user, index) => (
                      <div
                        key={index}
                        onClick={() => {
                          setUserName(user)
                          setUserSearchTerm('')
                          setShowUserDropdown(false)
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                        style={{
                          padding: '12px 16px',
                          cursor: 'pointer',
                          borderBottom: index < 9 ? '1px solid #333' : 'none',
                          backgroundColor: user === userName ? '#2a2a2a' : 'transparent',
                          transition: 'background-color 0.2s',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#2a2a2a'
                        }}
                        onMouseLeave={(e) => {
                          if (user !== userName) {
                            e.currentTarget.style.backgroundColor = 'transparent'
                          }
                        }}
                      >
                        {user}
                      </div>
                    ))}
                  {allUsers.filter(user => 
                    user.toLowerCase().includes(userSearchTerm.toLowerCase())
                  ).length === 0 && (
                    <div style={{ padding: '12px 16px', color: '#888', fontStyle: 'italic' }}>
                      No matches found
                    </div>
                  )}
                </div>
              )}
            </div>
            {existingEntriesCount > 0 && (
              <div className="update-warning">
                ℹ️ You already have {existingEntriesCount} entry/entries for this week. 
                Submitting will replace them.
              </div>
            )}
          </div>

          <div className="preset-buttons">
            <span className="preset-label">Quick fill:</span>
            <button
              className="preset-btn"
              onClick={() => applyPreset('all-office')}
              type="button"
            >
              <span style={{ fontSize: '18px', marginRight: '6px' }}>🏢</span> All Office
            </button>
            <button
              className="preset-btn"
              onClick={() => applyPreset('all-wfh')}
              type="button"
            >
              <span style={{ fontSize: '18px', marginRight: '6px' }}>🏠</span> All WFH
            </button>
            <button
              className="preset-btn"
              onClick={() => applyPreset('hybrid')}
              type="button"
            >
              <span style={{ fontSize: '18px', marginRight: '6px' }}>🔄</span> Hybrid (3+2)
            </button>
          </div>

          <table className="week-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Location</th>
                <th>Client</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {weekEntries.map((entry, index) => (
                <tr key={entry.date}>
                  <td>{entry.date}</td>
                  <td>{entry.dayName}</td>
                  <td>
                    <select
                      value={entry.location}
                      onChange={(e) =>
                        handleLocationChange(
                          index,
                          e.target.value as WorkLocation
                        )
                      }
                    >
                      <option value="Neal Street">Neal Street</option>
                      <option value="WFH">WFH</option>
                      <option value="Client Office">Client Office</option>
                      <option value="Holiday">Holiday</option>
                    </select>
                  </td>
                  <td>
                    {entry.location === 'Client Office' ? (
                      entry.isCustomClient ? (
                        <input
                          className="client-input"
                          type="text"
                          value={entry.client}
                          onChange={(e) =>
                            handleClientChange(index, e.target.value)
                          }
                          placeholder="Enter client name"
                          style={{ marginTop: '4px' }}
                        />
                      ) : (
                        <div>
                          <select
                            value={entry.client || ''}
                            onChange={(e) =>
                              handleClientTypeChange(index, e.target.value)
                            }
                            style={{
                              width: '100%',
                              padding: '8px',
                              border: '2px solid #ffffff',
                              borderRadius: '6px',
                              fontSize: '14px',
                              background: '#000000',
                              color: '#ffffff',
                              fontWeight: '600',
                              marginBottom: '4px',
                            }}
                          >
                            <option value="">Select client</option>
                            {clientOptions.map((client) => (
                              <option key={client} value={client}>
                                {client}
                              </option>
                            ))}
                            <option value="Other">Other</option>
                          </select>
                        </div>
                      )
                    ) : (
                      <span style={{ color: '#666', fontStyle: 'italic' }}>N/A</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      value={entry.notes}
                      onChange={(e) => handleNotesChange(index, e.target.value)}
                      placeholder="Optional notes"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            className="save-btn"
            onClick={handleSaveWeek}
            disabled={loading}
          >
            {loading ? 'Saving...' : isEditMode ? 'Update my week' : 'Save my week'}
          </button>
        </div>
      )}

      {/* Undo bar after save */}
      {showUndoBar && (
        <div className="toast" style={{ position: 'fixed', bottom: 20, left: 20, right: 'auto', background: '#000', color: '#00ff00', borderColor: '#00ff00' }}>
          Updated. <button className="preset-btn" onClick={handleUndo} type="button" style={{ marginLeft: 8 }}>Undo</button>
        </div>
      )}

      {viewMode === 'dashboard' && (
        <div className="dashboard">
          <h2>Team Dashboard - Week of {formatDate(weekStart)}</h2>

          {loading ? (
            <div className="empty-state">
              <h3>Loading...</h3>
            </div>
          ) : Object.keys(groupedEntries).length === 0 ? (
            <div className="empty-state">
              <h3>No entries found for this week</h3>
              <p>Team members haven't submitted their work locations yet.</p>
            </div>
          ) : (
            <>
              {/* Regular by location view */}
              {Object.keys(groupedEntries)
                .sort()
                .map((date) => (
                  <div key={date} className="day-section">
                    <h3>
                      {new Date(date).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </h3>

                    {locationOrder.map((location) => {
                      const entriesForLocation = groupedEntries[date][location] || []
                      if (entriesForLocation.length === 0) return null

                      // If location is Client Office, group by client
                      if (location === 'Client Office') {
                        const entriesByClient = entriesForLocation.reduce((acc, entry) => {
                          const client = entry.client || 'No Client'
                          if (!acc[client]) {
                            acc[client] = []
                          }
                          acc[client].push(entry)
                          return acc
                        }, {} as { [client: string]: SummaryRow[] })

                        return (
                          <div key={location} className="location-group">
                            <div className="location-group-title">
                              <span className={`location-badge ${getLocationBadgeClass(location)}`}>
                                {location}
                              </span>
                            </div>
                            {Object.keys(entriesByClient).sort().map((client) => {
                              const isCustomClient = !clientOptions.includes(client)
                              const clientHeading = isCustomClient ? `Other (${client})` : client
                              
                              return (
                                <div key={client} style={{ marginTop: '10px', paddingLeft: '20px' }}>
                                  <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '5px', color: '#ffff00' }}>
                                    📊 {clientHeading}
                                  </div>
                                  <div className="location-people">
                                    {entriesByClient[client].map((entry, index) => (
                                      <span key={`${entry.user_name}-${index}`} className="person-name-inline">
                                        {entry.user_name}
                                        {index < entriesByClient[client].length - 1 && ', '}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      }

                      // Regular display for other locations
                      return (
                        <div key={location} className="location-group">
                          <div className="location-group-title">
                            <span className={`location-badge ${getLocationBadgeClass(location)}`}>
                              {location}
                            </span>
                            <span className="location-people">
                              {entriesForLocation.map((entry, index) => (
                                <span key={`${entry.user_name}-${index}`} className="person-name-inline">
                                  {entry.user_name}
                                  {entry.client && ` (${entry.client})`}
                                  {index < entriesForLocation.length - 1 && ', '}
                                </span>
                              ))}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App
