from datetime import UTC, datetime

from sqlmodel import Field, SQLModel, UniqueConstraint


class Entry(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_key", "date", name="uniq_entries_userkey_date"),)
    
    id: int | None = Field(default=None, primary_key=True)
    user_key: str = Field(index=True)  # Normalized: lower(trim(user_name))
    user_name: str = Field(index=True)  # Display name (preserves casing)
    date: str = Field(index=True)  # YYYY-MM-DD format
    location: str = Field(index=True)
    client: str | None = Field(default=None)
    notes: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = Field(default=None)
