from sqlmodel import Session, select

from db import engine
from models import Entry


def seed_database():
    """Seed the database with sample data."""
    with Session(engine) as session:
        # Check if data already exists
        existing = session.exec(select(Entry)).first()
        if existing:
            print("Database already has data, skipping seed.")
            return

        # Sample data
        sample_entries = [
            Entry(
                user_key="alice johnson",
                user_name="Alice Johnson",
                date="2024-01-15",  # Monday
                location="Office",
                notes="Team meeting day",
            ),
            Entry(
                user_key="alice johnson",
                user_name="Alice Johnson",
                date="2024-01-16",  # Tuesday
                location="WFH",
                notes="Focus day",
            ),
            Entry(
                user_key="alice johnson",
                user_name="Alice Johnson",
                date="2024-01-17",  # Wednesday
                location="Client",
                client="Acme Corp",
                notes="Client presentation",
            ),
            Entry(
                user_key="bob smith",
                user_name="Bob Smith",
                date="2024-01-15",  # Monday
                location="Office",
                notes="Sprint planning",
            ),
            Entry(
                user_key="bob smith",
                user_name="Bob Smith",
                date="2024-01-16",  # Tuesday
                location="Office",
                notes="Code review day",
            ),
            Entry(
                user_key="bob smith",
                user_name="Bob Smith",
                date="2024-01-17",  # Wednesday
                location="WFH",
                notes="Deep work",
            ),
            Entry(
                user_key="carol davis",
                user_name="Carol Davis",
                date="2024-01-15",  # Monday
                location="PTO",
                notes="Vacation",
            ),
            Entry(
                user_key="carol davis",
                user_name="Carol Davis",
                date="2024-01-16",  # Tuesday
                location="PTO",
                notes="Vacation",
            ),
            Entry(
                user_key="carol davis",
                user_name="Carol Davis",
                date="2024-01-17",  # Wednesday
                location="Office",
                notes="Back from vacation",
            ),
        ]

        session.add_all(sample_entries)
        session.commit()
        print(f"Seeded database with {len(sample_entries)} sample entries.")


if __name__ == "__main__":
    from db import create_db_and_tables

    create_db_and_tables()
    seed_database()
