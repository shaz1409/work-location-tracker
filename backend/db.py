import os
from sqlmodel import Session, SQLModel, create_engine

# Get database URL from environment, default to SQLite for local dev
# Use persistent storage path if running in container with volume mount
db_path = os.getenv("DATABASE_PATH", "./worktracker.db")
if os.getenv("DATABASE_URL"):
    DATABASE_URL = os.getenv("DATABASE_URL")
else:
    DATABASE_URL = f"sqlite:///{db_path}"

# PostgreSQL uses postgresql:// but Render provides postgres://
# SQLModel/SQLAlchemy need postgresql:// so we need to convert
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Create engine
engine = create_engine(DATABASE_URL, echo=False)


def create_db_and_tables():
    """Create database and tables if they don't exist.
    This is safe to call multiple times - it won't wipe existing data.
    """
    SQLModel.metadata.create_all(engine)


def get_session():
    """Get database session."""
    with Session(engine) as session:
        yield session
