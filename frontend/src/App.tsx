import React, { useState, useEffect, useRef } from 'react'
import { WeekEntry, WorkLocation, SummaryRow, Entry, ExistingEntry } from './types'
import { saveWeek, getWeekSummary, checkExistingEntries, getUserEntriesForWeek, getUsersForWeek, getAllUsers } from './api'
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


function formatWeekRangeLabel(weekStart: Date): string {
  const start = new Date(weekStart)
  const end = new Date(weekStart)
  end.setDate(start.getDate() + 4)
  const startStr = start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const endStr = end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${startStr} → ${endStr}`
}

// Location normalization helpers to be compatible with both old and new APIs
function normalizeLocationFromApi(location: string): WorkLocation {
  switch (location) {
    case 'Office':
      return 'Neal Street'
    case 'Client':
      return 'Client Office'
    case 'Off':
    case 'PTO':
      return 'Holiday'
    case 'WFH':
      return 'WFH'
    case 'Neal Street':
    case 'Client Office':
    case 'Holiday':
    case 'Working From Abroad':
    case 'Other':
      return location as WorkLocation
    default:
      return location as WorkLocation
  }
}

function generateWeekEntries(weekStart: Date, isSplit: boolean = false): WeekEntry[] {
  const entries: WeekEntry[] = []
  // Only generate Monday-Friday (5 days)
  for (let i = 0; i < 5; i++) {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + i)
    const baseEntry: WeekEntry = {
      date: formatDate(date),
      dayName: getDayName(date),
      location: 'Neal Street' as WorkLocation,
      client: '',
      notes: '',
      isCustomClient: false,
    }
    if (isSplit) {
      baseEntry.morningLocation = 'Neal Street' as WorkLocation
      baseEntry.afternoonLocation = 'Neal Street' as WorkLocation
      baseEntry.morningClient = ''
      baseEntry.afternoonClient = ''
      baseEntry.morningNotes = ''
      baseEntry.afternoonNotes = ''
      baseEntry.morningIsCustomClient = false
      baseEntry.afternoonIsCustomClient = false
    }
    entries.push(baseEntry)
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
      // Create location key with time period if present
      const locationKey = entry.time_period 
        ? `${entry.location} (${entry.time_period})`
        : entry.location
      if (!groups[entry.date][locationKey]) {
        groups[entry.date][locationKey] = []
      }
      groups[entry.date][locationKey].push(entry)
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
    case 'working from abroad':
      return 'location-abroad'
    case 'holiday':
      return 'location-off'
    case 'other':
      return 'location-other'
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
  const [editSearchTerm, setEditSearchTerm] = useState('')
  
  // Split working mode (morning/afternoon) - per day (set of dates that are split)
  const [splitDays, setSplitDays] = useState<Set<string>>(new Set())
  
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
    setWeekEntries(generateWeekEntries(weekStart, false))
    // Reset split days when week changes
    setSplitDays(new Set())
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
      // Fallback: try all users across all time
      try {
        const all = await getAllUsers()
        setUserList(all.users)
        // do not surface an error if fallback worked
      } catch (e) {
        setError('Failed to load user list')
        setUserList([])
      }
    } finally {
      setLoading(false)
    }
  }

  const loadExistingEntries = async (user: string, week: string) => {
    try {
      setLoading(true)
      const existingEntries = await getUserEntriesForWeek(user, week)
      
      // Group entries by date and time_period
      const entriesByDate = new Map<string, { morning?: ExistingEntry, afternoon?: ExistingEntry, full?: ExistingEntry }>()
      
      for (const entry of existingEntries) {
        const date = entry.date
        if (!entriesByDate.has(date)) {
          entriesByDate.set(date, {})
        }
        const dayEntries = entriesByDate.get(date)!
        if (entry.time_period === 'Morning') {
          dayEntries.morning = entry
        } else if (entry.time_period === 'Afternoon') {
          dayEntries.afternoon = entry
        } else {
          dayEntries.full = entry
        }
      }
      
      // Update week entries with existing data
      const updatedEntries = weekEntries.map(entry => {
        const dayEntries = entriesByDate.get(entry.date)
        if (!dayEntries) return entry
        
        // If we have full day entry and no split entries, use it
        if (dayEntries.full && !dayEntries.morning && !dayEntries.afternoon) {
          const normalizedLocation = normalizeLocationFromApi(dayEntries.full.location) as WorkLocation
          let isCustomClient = false
          if (normalizedLocation === 'Client Office') {
            isCustomClient = !clientOptions.includes(dayEntries.full.client || '')
          } else if (normalizedLocation === 'Other') {
            isCustomClient = true
          }
          return {
            ...entry,
            location: normalizedLocation,
            client: dayEntries.full.client || '',
            notes: dayEntries.full.notes || '',
            isCustomClient: isCustomClient
          }
        }
        
        // If we have morning/afternoon entries, mark this day as split
        if (dayEntries.morning || dayEntries.afternoon) {
          setSplitDays(prev => new Set(prev).add(entry.date))
          const result = { ...entry }
          
          if (dayEntries.morning) {
            const normalizedLocation = normalizeLocationFromApi(dayEntries.morning.location) as WorkLocation
            result.morningLocation = normalizedLocation
            result.morningClient = dayEntries.morning.client || ''
            result.morningNotes = dayEntries.morning.notes || ''
            if (normalizedLocation === 'Client Office') {
              result.morningIsCustomClient = !clientOptions.includes(dayEntries.morning.client || '')
            } else if (normalizedLocation === 'Other') {
              result.morningIsCustomClient = true
            } else {
              result.morningIsCustomClient = false
            }
          } else {
            // Initialize morning fields if afternoon exists but morning doesn't
            result.morningLocation = 'Neal Street' as WorkLocation
            result.morningClient = ''
            result.morningNotes = ''
            result.morningIsCustomClient = false
          }
          
          if (dayEntries.afternoon) {
            const normalizedLocation = normalizeLocationFromApi(dayEntries.afternoon.location) as WorkLocation
            result.afternoonLocation = normalizedLocation
            result.afternoonClient = dayEntries.afternoon.client || ''
            result.afternoonNotes = dayEntries.afternoon.notes || ''
            if (normalizedLocation === 'Client Office') {
              result.afternoonIsCustomClient = !clientOptions.includes(dayEntries.afternoon.client || '')
            } else if (normalizedLocation === 'Other') {
              result.afternoonIsCustomClient = true
            } else {
              result.afternoonIsCustomClient = false
            }
          } else {
            // Initialize afternoon fields if morning exists but afternoon doesn't
            result.afternoonLocation = 'Neal Street' as WorkLocation
            result.afternoonClient = ''
            result.afternoonNotes = ''
            result.afternoonIsCustomClient = false
          }
          
          return result
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
      // Normalize any legacy location names coming from API
      const normalized = response.entries.map(e => ({
        ...e,
        location: normalizeLocationFromApi(e.location),
      }))
      setSummaryEntries(normalized)
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

  const dateInputRef = useRef<HTMLInputElement | null>(null)

  const openNativeDatePicker = () => {
    const el = dateInputRef.current
    if (!el) return
    const anyEl = el as any
    if (typeof anyEl.showPicker === 'function') {
      anyEl.showPicker()
    } else {
      el.focus()
      el.click()
    }
  }

  const handleLocationChange = (index: number, location: WorkLocation, period?: 'morning' | 'afternoon') => {
    const newEntries = [...weekEntries]
    const entry = newEntries[index]
    const isSplit = splitDays.has(entry.date)
    
    if (isSplit && period) {
      if (period === 'morning') {
        newEntries[index].morningLocation = location
        if (location !== 'Client Office' && location !== 'Other') {
          newEntries[index].morningClient = ''
          newEntries[index].morningIsCustomClient = false
        } else if (location === 'Other') {
          newEntries[index].morningIsCustomClient = true
          if (!newEntries[index].morningClient) {
            newEntries[index].morningClient = ''
          }
        }
      } else {
        newEntries[index].afternoonLocation = location
        if (location !== 'Client Office' && location !== 'Other') {
          newEntries[index].afternoonClient = ''
          newEntries[index].afternoonIsCustomClient = false
        } else if (location === 'Other') {
          newEntries[index].afternoonIsCustomClient = true
          if (!newEntries[index].afternoonClient) {
            newEntries[index].afternoonClient = ''
          }
        }
      }
    } else {
      newEntries[index].location = location
      if (location !== 'Client Office' && location !== 'Other') {
        newEntries[index].client = ''
        newEntries[index].isCustomClient = false
      } else if (location === 'Other') {
        // For "Other", always show custom input
        newEntries[index].isCustomClient = true
        if (!newEntries[index].client) {
          newEntries[index].client = ''
        }
      }
    }
    setWeekEntries(newEntries)
  }

  const handleClientChange = (index: number, client: string, period?: 'morning' | 'afternoon') => {
    const newEntries = [...weekEntries]
    const entry = newEntries[index]
    const isSplit = splitDays.has(entry.date)
    
    if (isSplit && period) {
      if (period === 'morning') {
        newEntries[index].morningClient = client
      } else {
        newEntries[index].afternoonClient = client
      }
    } else {
      newEntries[index].client = client
    }
    setWeekEntries(newEntries)
  }

  const handleClientTypeChange = (index: number, clientType: string, period?: 'morning' | 'afternoon') => {
    const newEntries = [...weekEntries]
    const entry = newEntries[index]
    const isSplit = splitDays.has(entry.date)
    
    if (isSplit && period) {
      if (period === 'morning') {
        if (clientType === 'Other') {
          newEntries[index].morningIsCustomClient = true
          newEntries[index].morningClient = ''
        } else {
          newEntries[index].morningIsCustomClient = false
          newEntries[index].morningClient = clientType
        }
      } else {
        if (clientType === 'Other') {
          newEntries[index].afternoonIsCustomClient = true
          newEntries[index].afternoonClient = ''
        } else {
          newEntries[index].afternoonIsCustomClient = false
          newEntries[index].afternoonClient = clientType
        }
      }
    } else {
      if (clientType === 'Other') {
        newEntries[index].isCustomClient = true
        newEntries[index].client = ''
      } else {
        newEntries[index].isCustomClient = false
        newEntries[index].client = clientType
      }
    }
    setWeekEntries(newEntries)
  }

  const handleNotesChange = (index: number, notes: string, period?: 'morning' | 'afternoon') => {
    const newEntries = [...weekEntries]
    const entry = newEntries[index]
    const isSplit = splitDays.has(entry.date)
    
    if (isSplit && period) {
      if (period === 'morning') {
        newEntries[index].morningNotes = notes
      } else {
        newEntries[index].afternoonNotes = notes
      }
    } else {
      newEntries[index].notes = notes
    }
    setWeekEntries(newEntries)
  }

  const applyPreset = (presetType: 'all-office' | 'all-wfh') => {
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
      const isSplit = splitDays.has(entry.date)
      
      if (isSplit) {
        // Validate morning entry if location is set
        if (entry.morningLocation) {
          if (entry.morningLocation === 'Client Office') {
            if (entry.morningIsCustomClient && !entry.morningClient?.trim()) {
              return `Please enter a client name for ${entry.dayName} (Morning)`
            }
            if (!entry.morningIsCustomClient && !entry.morningClient?.trim()) {
              return `Client name is required for ${entry.dayName} (Morning)`
            }
          }
          if (entry.morningLocation === 'Other') {
            if (!entry.morningClient?.trim()) {
              return `Please enter a location description for ${entry.dayName} (Morning)`
            }
          }
        }
        // Validate afternoon entry if location is set
        if (entry.afternoonLocation) {
          if (entry.afternoonLocation === 'Client Office') {
            if (entry.afternoonIsCustomClient && !entry.afternoonClient?.trim()) {
              return `Please enter a client name for ${entry.dayName} (Afternoon)`
            }
            if (!entry.afternoonIsCustomClient && !entry.afternoonClient?.trim()) {
              return `Client name is required for ${entry.dayName} (Afternoon)`
            }
          }
          if (entry.afternoonLocation === 'Other') {
            if (!entry.afternoonClient?.trim()) {
              return `Please enter a location description for ${entry.dayName} (Afternoon)`
            }
          }
        }
      } else {
        // Validate full day entry
        if (entry.location === 'Client Office') {
          // If "Other" was selected, isCustomClient=true and client must be non-empty
          if (entry.isCustomClient && !entry.client.trim()) {
            return `Please enter a client name for ${entry.dayName}`
          }
          if (!entry.isCustomClient && !entry.client.trim()) {
            return `Client name is required for ${entry.dayName}`
          }
        }
        if (entry.location === 'Other') {
          if (!entry.client.trim()) {
            return `Please enter a location description for ${entry.dayName}`
          }
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

      // Build entries array - either split or full day entries
      const entries: Entry[] = []
      
      for (const entry of weekEntries) {
        const isSplit = splitDays.has(entry.date)
        
        if (isSplit && (entry.morningLocation || entry.afternoonLocation)) {
          // Add morning entry if location is set
          if (entry.morningLocation) {
            entries.push({
              date: entry.date,
              location: entry.morningLocation,
              time_period: 'Morning',
              client: (entry.morningLocation === 'Client Office' || entry.morningLocation === 'Other') && entry.morningClient?.trim()
                ? entry.morningClient.trim()
                : undefined,
              notes: entry.morningNotes?.trim() || undefined,
            })
          }
          // Add afternoon entry if location is set
          if (entry.afternoonLocation) {
            entries.push({
              date: entry.date,
              location: entry.afternoonLocation,
              time_period: 'Afternoon',
              client: (entry.afternoonLocation === 'Client Office' || entry.afternoonLocation === 'Other') && entry.afternoonClient?.trim()
                ? entry.afternoonClient.trim()
                : undefined,
              notes: entry.afternoonNotes?.trim() || undefined,
            })
          }
        } else {
          // Full day entry
          entries.push({
            date: entry.date,
            location: entry.location,
            time_period: null,
            client: (entry.location === 'Client Office' || entry.location === 'Other') && entry.client.trim()
              ? entry.client.trim()
              : undefined,
            notes: entry.notes.trim() || undefined,
          })
        }
      }

      const request = {
        user_name: userName.trim(),
        entries: entries,
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
  const locationOrder = ['Neal Street', 'WFH', 'Client Office', 'Working From Abroad', 'Holiday', 'Other']

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="preset-btn" type="button" onClick={goToPrevWeek}>{'<'} Prev</button>

          {/* Hidden native input for calendar; themed launcher button opens it */}
          <input
            ref={dateInputRef}
            id="week-start"
            type="date"
            value={formatDate(weekStart)}
            onChange={handleWeekStartChange}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            aria-hidden="true"
            tabIndex={-1}
          />

          <button
            type="button"
            onClick={openNativeDatePicker}
            style={{
              padding: '12px 16px',
              border: '2px solid #ffffff',
              background: '#000000',
              color: '#ffffff',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 700,
              letterSpacing: 1,
              boxShadow: '0 0 15px rgba(255,255,255,0.2)'
            }}
            aria-label="Open calendar to select week"
          >
            📅 Select week: {formatWeekRangeLabel(weekStart)}
          </button>

          <button className="preset-btn" type="button" onClick={goToNextWeek}>Next {'>'}</button>
        </div>

      </div>

      {error && <div className="error-message">{error}</div>}

      {toast && <div className="toast">{toast}</div>}

      {viewMode === 'edit' && (
        <div className="form-section">
          <h2>Select your name to edit:</h2>
          <div className="form-group">
            <input
              type="text"
              value={editSearchTerm}
              onChange={(e) => setEditSearchTerm(e.target.value)}
              placeholder="Search people who have filled this week"
            />
          </div>
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
              {userList
                .filter((u) =>
                  u.toLowerCase().includes(editSearchTerm.toLowerCase())
                )
                .map((user, index) => (
                <button
                  key={index}
                  className="user-card"
                  onClick={() => handleUserSelect(user)}
                  type="button"
                >
                  {user}
                </button>
              ))}
              {userList.filter((u) => u.toLowerCase().includes(editSearchTerm.toLowerCase())).length === 0 && (
                <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                  <h3>No matches</h3>
                </div>
              )}
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
          </div>

          <table className="week-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Location</th>
                <th>Client</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {weekEntries.map((entry, index) => {
                const isSplit = splitDays.has(entry.date)
                
                const toggleSplit = () => {
                  setSplitDays(prev => {
                    const newSet = new Set(prev)
                    if (newSet.has(entry.date)) {
                      newSet.delete(entry.date)
                      // Clear split fields when unsplitting
                      const newEntries = [...weekEntries]
                      newEntries[index] = {
                        ...newEntries[index],
                        morningLocation: undefined,
                        afternoonLocation: undefined,
                        morningClient: undefined,
                        afternoonClient: undefined,
                        morningNotes: undefined,
                        afternoonNotes: undefined,
                        morningIsCustomClient: undefined,
                        afternoonIsCustomClient: undefined,
                      }
                      setWeekEntries(newEntries)
                    } else {
                      newSet.add(entry.date)
                      // Initialize split fields when splitting
                      const newEntries = [...weekEntries]
                      const current = newEntries[index]
                      newEntries[index] = {
                        ...current,
                        morningLocation: current.location || 'Neal Street' as WorkLocation,
                        afternoonLocation: current.location || 'Neal Street' as WorkLocation,
                        morningClient: current.client || '',
                        afternoonClient: current.client || '',
                        morningNotes: current.notes || '',
                        afternoonNotes: current.notes || '',
                        morningIsCustomClient: current.isCustomClient || false,
                        afternoonIsCustomClient: current.isCustomClient || false,
                      }
                      setWeekEntries(newEntries)
                    }
                    return newSet
                  })
                }
                const renderLocationSelect = (location: WorkLocation | undefined, onChange: (loc: WorkLocation) => void) => (
                  <select
                    value={location || 'Neal Street'}
                    onChange={(e) => onChange(e.target.value as WorkLocation)}
                  >
                    <option value="Neal Street">Neal Street</option>
                    <option value="WFH">WFH</option>
                    <option value="Client Office">Client Office</option>
                    <option value="Working From Abroad">Working From Abroad</option>
                    <option value="Holiday">Holiday</option>
                    <option value="Other">Other</option>
                  </select>
                )
                
                const renderClientInput = (
                  location: WorkLocation | undefined,
                  client: string | undefined,
                  isCustom: boolean | undefined,
                  onChange: (client: string) => void,
                  onClientTypeChange: (clientType: string) => void
                ) => {
                  if (!location) return <span style={{ color: '#666', fontStyle: 'italic' }}>N/A</span>
                  if (location === 'Client Office') {
                    return isCustom ? (
                      <input
                        className="client-input"
                        type="text"
                        value={client || ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Enter client name"
                        style={{ marginTop: '4px' }}
                      />
                    ) : (
                      <div>
                        <select
                          value={client || ''}
                          onChange={(e) => onClientTypeChange(e.target.value)}
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
                          {clientOptions.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    )
                  } else if (location === 'Other') {
                    return (
                      <input
                        className="client-input"
                        type="text"
                        value={client || ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Enter location description"
                        style={{ marginTop: '4px' }}
                      />
                    )
                  }
                  return <span style={{ color: '#666', fontStyle: 'italic' }}>N/A</span>
                }
                
                if (isSplit) {
                  return (
                    <React.Fragment key={entry.date}>
                      <tr>
                        <td rowSpan={2} style={{ verticalAlign: 'top', paddingTop: '16px' }}>{entry.date}</td>
                        <td rowSpan={2} style={{ verticalAlign: 'top', paddingTop: '16px' }}>{entry.dayName}</td>
                        <td>
                          <div style={{ fontWeight: '700', marginBottom: '4px', color: '#ffff00', fontSize: '12px' }}>Morning</div>
                          {renderLocationSelect(entry.morningLocation, (loc) => handleLocationChange(index, loc, 'morning'))}
                        </td>
                        <td>
                          {renderClientInput(
                            entry.morningLocation,
                            entry.morningClient,
                            entry.morningIsCustomClient,
                            (client) => handleClientChange(index, client, 'morning'),
                            (clientType) => handleClientTypeChange(index, clientType, 'morning')
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            value={entry.morningNotes || ''}
                            onChange={(e) => handleNotesChange(index, e.target.value, 'morning')}
                            placeholder="Optional notes"
                            style={{ width: '100%' }}
                          />
                        </td>
                        <td rowSpan={2} style={{ verticalAlign: 'top', paddingTop: '16px' }}>
                          <button
                            className="preset-btn"
                            onClick={toggleSplit}
                            type="button"
                            style={{
                              fontSize: '11px',
                              padding: '6px 10px',
                              borderColor: '#00ff00',
                              backgroundColor: '#003300',
                            }}
                          >
                            Unsplit
                          </button>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <div style={{ fontWeight: '700', marginBottom: '4px', color: '#ffff00', fontSize: '12px' }}>Afternoon</div>
                          {renderLocationSelect(entry.afternoonLocation, (loc) => handleLocationChange(index, loc, 'afternoon'))}
                        </td>
                        <td>
                          {renderClientInput(
                            entry.afternoonLocation,
                            entry.afternoonClient,
                            entry.afternoonIsCustomClient,
                            (client) => handleClientChange(index, client, 'afternoon'),
                            (clientType) => handleClientTypeChange(index, clientType, 'afternoon')
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            value={entry.afternoonNotes || ''}
                            onChange={(e) => handleNotesChange(index, e.target.value, 'afternoon')}
                            placeholder="Optional notes"
                            style={{ width: '100%' }}
                          />
                        </td>
                      </tr>
                    </React.Fragment>
                  )
                }
                
                return (
                  <tr key={entry.date}>
                    <td>{entry.date}</td>
                    <td>{entry.dayName}</td>
                    <td>
                      {renderLocationSelect(entry.location, (loc) => handleLocationChange(index, loc))}
                    </td>
                    <td>
                      {renderClientInput(
                        entry.location,
                        entry.client,
                        entry.isCustomClient,
                        (client) => handleClientChange(index, client),
                        (clientType) => handleClientTypeChange(index, clientType)
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
                    <td>
                      <button
                        className="preset-btn"
                        onClick={toggleSplit}
                        type="button"
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                        }}
                      >
                        <span style={{ fontSize: '14px', marginRight: '4px' }}>⏰</span> Split
                      </button>
                    </td>
                  </tr>
                )
              })}
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

                    {(() => {
                      // Get all location keys (including those with time_period suffixes)
                      const allLocationKeys = Object.keys(groupedEntries[date] || {})
                      
                      // Group by base location (without time_period)
                      const locationGroups: { [baseLoc: string]: { [key: string]: SummaryRow[] } } = {}
                      for (const key of allLocationKeys) {
                        // Extract base location (remove "(Morning)" or "(Afternoon)" suffix)
                        const baseLoc = key.replace(/\s*\(Morning\)$/, '').replace(/\s*\(Afternoon\)$/, '')
                        if (!locationGroups[baseLoc]) {
                          locationGroups[baseLoc] = {}
                        }
                        locationGroups[baseLoc][key] = groupedEntries[date][key] || []
                      }
                      
                      // Render each location group
                      return locationOrder.map((baseLocation) => {
                        const locationVariants = locationGroups[baseLocation]
                        if (!locationVariants || Object.keys(locationVariants).length === 0) return null
                        
                        // Get all entries for this base location (across all time periods)
                        const allEntriesForLocation: SummaryRow[] = []
                        for (const variantKey of Object.keys(locationVariants)) {
                          allEntriesForLocation.push(...locationVariants[variantKey])
                        }
                        
                        if (allEntriesForLocation.length === 0) return null

                        // If location is Client Office or Other, group by client/description AND time_period
                        if (baseLocation === 'Client Office' || baseLocation === 'Other') {
                          // Group by description and time_period
                          const entriesByDescriptionAndPeriod = allEntriesForLocation.reduce((acc, entry) => {
                            const description = entry.client || (baseLocation === 'Other' ? 'No description' : 'No Client')
                            const periodLabel = entry.time_period ? ` (${entry.time_period})` : ''
                            const key = `${description}${periodLabel}`
                            if (!acc[key]) {
                              acc[key] = []
                            }
                            acc[key].push(entry)
                            return acc
                          }, {} as { [key: string]: SummaryRow[] })

                          return (
                            <div key={baseLocation} className="location-group">
                              <div className="location-group-title">
                                <span className={`location-badge ${getLocationBadgeClass(baseLocation)}`}>
                                  {baseLocation}
                                </span>
                              </div>
                              {Object.keys(entriesByDescriptionAndPeriod).sort().map((key) => {
                                const entries = entriesByDescriptionAndPeriod[key]
                                // For Client Office, check if it's a custom client
                                const description = key.replace(/\s*\(Morning\)$/, '').replace(/\s*\(Afternoon\)$/, '')
                                const isCustomClient = baseLocation === 'Client Office' && !clientOptions.includes(description)
                                const heading = baseLocation === 'Other' 
                                  ? key 
                                  : isCustomClient 
                                    ? `Other${key.includes('(') ? '' : ' (' + description + ')'}` 
                                    : key
                                
                                return (
                                  <div key={key} style={{ marginTop: '10px', paddingLeft: '20px' }}>
                                    <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '5px', color: '#ffff00' }}>
                                      📊 {heading}
                                    </div>
                                    <div className="location-people">
                                      {entries.map((entry, index) => (
                                        <span key={`${entry.user_name}-${index}`} className="person-name-inline">
                                          {entry.user_name}
                                          {index < entries.length - 1 && ', '}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        }

                        // Regular display for other locations - group by time_period
                        // Group entries by time_period
                        const entriesByPeriod = allEntriesForLocation.reduce((acc, entry) => {
                          const periodKey = entry.time_period || 'Full Day'
                          if (!acc[periodKey]) {
                            acc[periodKey] = []
                          }
                          acc[periodKey].push(entry)
                          return acc
                        }, {} as { [period: string]: SummaryRow[] })
                        
                        // Render each time period variant
                        return (
                          <div key={baseLocation} className="location-group">
                            {Object.keys(entriesByPeriod).sort().map((periodKey) => {
                              const entries = entriesByPeriod[periodKey]
                              const locationLabel = periodKey === 'Full Day' 
                                ? baseLocation 
                                : `${baseLocation} (${periodKey})`
                              
                              return (
                                <div key={periodKey} style={{ marginBottom: periodKey !== 'Full Day' ? '8px' : '0' }}>
                                  <div className="location-group-title">
                                    <span className={`location-badge ${getLocationBadgeClass(baseLocation)}`}>
                                      {locationLabel}
                                    </span>
                                    <span className="location-people">
                                      {entries.map((entry, index) => (
                                        <span key={`${entry.user_name}-${index}`} className="person-name-inline">
                                          {entry.user_name}
                                          {(entry.client && (baseLocation === 'Client Office' || baseLocation === 'Other')) && ` (${entry.client})`}
                                          {index < entries.length - 1 && ', '}
                                        </span>
                                      ))}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })
                    })()}

                    {/* Show people who haven't entered */}
                    {(() => {
                      // Get all people who have entered for this date
                      const enteredUsers = new Set(
                        (groupedEntries[date] ? Object.values(groupedEntries[date]).flat() : []).map(e => e.user_name)
                      )
                      
                      // Get people from team-members.json who haven't entered, sorted alphabetically
                      const notEntered = allUsers
                        .filter(user => !enteredUsers.has(user))
                        .sort()
                      
                      if (notEntered.length === 0) return null
                      
                      return (
                        <div className="location-group" style={{ marginTop: '16px' }}>
                          <div className="location-group-title">
                            <span className="location-badge" style={{ 
                              background: '#444', 
                              border: '2px solid #888',
                              color: '#ccc'
                            }}>
                              Not Entered
                            </span>
                            <span className="location-people">
                              {notEntered.map((name, index) => (
                                <span key={`missing-${name}-${index}`} className="person-name-inline" style={{ color: '#999' }}>
                                  {name}
                                  {index < notEntered.length - 1 && ', '}
                                </span>
                              ))}
                            </span>
                          </div>
                        </div>
                      )
                    })()}
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
