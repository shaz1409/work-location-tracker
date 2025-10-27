from sqlmodel import Session, SQLModel, create_engine

# Database file path
DATABASE_URL = "sqlite:///./worktracker.db"

# Create engine
engine = create_engine(DATABASE_URL, echo=False)


def create_db_and_tables():
    """Create database and tables."""
    SQLModel.metadata.create_all(engine)


def get_session():
    """Get database session."""
    with Session(engine) as session:
        yield session
