import React, { useState, useEffect } from 'react'
import { WeekEntry, WorkLocation, SummaryRow } from './types'
import { saveWeek, getWeekSummary } from './api'

type ViewMode = 'fill' | 'dashboard'

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

function generateWeekEntries(weekStart: Date): WeekEntry[] {
  const entries: WeekEntry[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + i)
    entries.push({
      date: formatDate(date),
      dayName: getDayName(date),
      location: 'Office' as Location,
      client: '',
      notes: '',
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

function groupEntriesByDate(entries: SummaryRow[]): {
  [date: string]: SummaryRow[]
} {
  return entries.reduce(
    (groups, entry) => {
      if (!groups[entry.date]) {
        groups[entry.date] = []
      }
      groups[entry.date].push(entry)
      return groups
    },
    {} as { [date: string]: SummaryRow[] }
  )
}

function getLocationBadgeClass(location: string): string {
  switch (location.toLowerCase()) {
    case 'office':
      return 'location-office'
    case 'wfh':
      return 'location-wfh'
    case 'client':
      return 'location-client'
    case 'pto':
      return 'location-pto'
    case 'off':
      return 'location-off'
    default:
      return ''
  }
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('fill')
  const [weekStart, setWeekStart] = useState<Date>(getMondayOfWeek(new Date()))
  const [userName, setUserName] = useState('')
  const [weekEntries, setWeekEntries] = useState<WeekEntry[]>([])
  const [summaryEntries, setSummaryEntries] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  // Initialize week entries when week start changes
  useEffect(() => {
    setWeekEntries(generateWeekEntries(weekStart))
  }, [weekStart])

  // Load summary when switching to dashboard view
  useEffect(() => {
    if (viewMode === 'dashboard') {
      loadWeekSummary()
    }
  }, [viewMode, weekStart])

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

  const handleLocationChange = (index: number, location: WorkLocation) => {
    const newEntries = [...weekEntries]
    newEntries[index].location = location
    if (location !== 'Client') {
      newEntries[index].client = ''
    }
    setWeekEntries(newEntries)
  }

  const handleClientChange = (index: number, client: string) => {
    const newEntries = [...weekEntries]
    newEntries[index].client = client
    setWeekEntries(newEntries)
  }

  const handleNotesChange = (index: number, notes: string) => {
    const newEntries = [...weekEntries]
    newEntries[index].notes = notes
    setWeekEntries(newEntries)
  }

  const validateEntries = (): string | null => {
    if (!userName.trim()) {
      return 'Please enter your name'
    }

    for (const entry of weekEntries) {
      if (entry.location === 'Client' && !entry.client.trim()) {
        return `Client name is required for ${entry.dayName}`
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

    try {
      setLoading(true)
      setError('')

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
      setToast('Week saved successfully!')
      setTimeout(() => setToast(''), 3000)
      setViewMode('dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save week')
    } finally {
      setLoading(false)
    }
  }

  const groupedEntries = groupEntriesByDateAndLocation(summaryEntries)

  // Define location order for consistent display
  const locationOrder = ['Office', 'WFH', 'Client', 'PTO', 'Off']

  return (
    <div className="container">
      <div className="header">
        <h1>Work Location Tracker</h1>
        <p>Track where your team will work each day of the week</p>
      </div>

      <div className="toggle-buttons">
        <button
          className={`toggle-btn ${viewMode === 'fill' ? 'active' : ''}`}
          onClick={() => setViewMode('fill')}
        >
          Fill my week
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
        <input
          id="week-start"
          type="date"
          value={formatDate(weekStart)}
          onChange={handleWeekStartChange}
        />
      </div>

      {error && <div className="error-message">{error}</div>}

      {toast && <div className="toast">{toast}</div>}

      {viewMode === 'fill' && (
        <div className="form-section">
          <div className="form-group">
            <label htmlFor="user-name">Your name:</label>
            <input
              id="user-name"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              required
            />
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
                      <option value="Office">Office</option>
                      <option value="WFH">WFH</option>
                      <option value="Client">Client</option>
                      <option value="PTO">PTO</option>
                      <option value="Off">Off</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="client-input"
                      type="text"
                      value={entry.client}
                      onChange={(e) =>
                        handleClientChange(index, e.target.value)
                      }
                      placeholder="Client name"
                      disabled={entry.location !== 'Client'}
                    />
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
            {loading ? 'Saving...' : 'Save my week'}
          </button>
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
            Object.keys(groupedEntries)
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

                    return (
                      <div key={location} className="location-group">
                        <h4 className="location-group-title">
                          <span className={`location-badge ${getLocationBadgeClass(location)}`}>
                            {location}
                          </span>
                          <span className="location-count">
                            ({entriesForLocation.length} {entriesForLocation.length === 1 ? 'person' : 'people'})
                          </span>
                        </h4>
                        
                        <div className="people-list">
                          {entriesForLocation.map((entry, index) => (
                            <div key={`${entry.user_name}-${index}`} className="person-card">
                              <div className="person-name">{entry.user_name}</div>
                              {entry.client && (
                                <div className="person-client">Client: {entry.client}</div>
                              )}
                              {entry.notes && (
                                <div className="person-notes">Notes: {entry.notes}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}

export default App
