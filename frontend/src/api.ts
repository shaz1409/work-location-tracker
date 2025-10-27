import {
  BulkUpsertRequest,
  BulkUpsertResponse,
  WeekSummaryResponse,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8002'

interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

async function apiCall<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API Error: ${response.status} ${errorText}`)
  }

  return response.json()
}

export async function saveWeek(
  request: BulkUpsertRequest
): Promise<BulkUpsertResponse> {
  return apiCall<BulkUpsertResponse>('/entries/bulk_upsert', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function getWeekSummary(
  weekStart: string
): Promise<WeekSummaryResponse> {
  return apiCall<WeekSummaryResponse>(`/summary/week?week_start=${weekStart}`)
}

export async function checkExistingEntries(
  userName: string,
  weekStart: string
): Promise<{ exists: boolean; count: number; entries: any[] }> {
  return apiCall<{ exists: boolean; count: number; entries: any[] }>(
    `/entries/check?user_name=${encodeURIComponent(userName)}&week_start=${weekStart}`
  )
}

export async function getUserEntriesForWeek(
  userName: string,
  weekStart: string
): Promise<any[]> {
  const result = await checkExistingEntries(userName, weekStart)
  return result.entries || []
}

export async function getUsersForWeek(
  weekStart: string
): Promise<{ users: string[] }> {
  return apiCall<{ users: string[] }>(`/summary/users?week_start=${weekStart}`)
}

export async function getAllUsers(): Promise<{ users: string[] }> {
  return apiCall<{ users: string[] }>('/summary/all-users')
}
