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
