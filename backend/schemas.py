from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator
from sqlmodel import SQLModel


class EntryCreate(BaseModel):
    date: str  # YYYY-MM-DD format
    location: str
    client: str | None = None
    notes: str | None = None

    @field_validator("location")
    @classmethod
    def validate_location(cls, v):
        valid_locations = {"Neal Street", "WFH", "Client Office", "Holiday"}
        if v not in valid_locations:
            raise ValueError(f"Location must be one of: {valid_locations}")
        return v

    @model_validator(mode="after")
    def validate_client(self):
        if self.location == "Client Office" and not self.client:
            raise ValueError("Client name is required when location is 'Client Office'")
        return self


class BulkUpsertRequest(BaseModel):
    user_name: str
    entries: list[EntryCreate]


class BulkUpsertResponse(BaseModel):
    ok: bool
    count: int


class SummaryRow(BaseModel):
    user_name: str
    date: str
    location: str
    client: str | None = None
    notes: str | None = None


class WeekSummaryResponse(BaseModel):
    entries: list[SummaryRow]


class EntryResponse(SQLModel):
    id: int
    user_name: str
    date: str
    location: str
    client: str | None = None
    notes: str | None = None
    created_at: datetime
