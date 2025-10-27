from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


class Entry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_name: str = Field(index=True)
    date: str = Field(index=True)  # YYYY-MM-DD format
    location: str = Field(index=True)  # "Office", "WFH", "Client", "PTO", "Off"
    client: str | None = Field(default=None)
    notes: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Config:
        # Ensure unique constraint on (user_name, date)
        __table_args__ = {"sqlite_autoincrement": True}
