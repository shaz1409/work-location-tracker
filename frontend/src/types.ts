export interface Entry {
  date: string
  location: string
  client?: string
  notes?: string
}

export interface BulkUpsertRequest {
  user_name: string
  entries: Entry[]
}

export interface BulkUpsertResponse {
  ok: boolean
  count: number
}

export interface SummaryRow {
  user_name: string
  date: string
  location: string
  client?: string
  notes?: string
}

export interface WeekSummaryResponse {
  entries: SummaryRow[]
}

export type WorkLocation = 'Neal Street' | 'WFH' | 'Client Office' | 'Holiday' | 'Working From Abroad' | 'Other'

export interface WeekEntry {
  date: string
  dayName: string
  location: WorkLocation
  client: string
  notes: string
  isCustomClient: boolean
}

export type ClientOption = 'FT' | 'Other'

export interface ExistingEntry {
  date: string
  location: string
  client?: string
  notes?: string
}
