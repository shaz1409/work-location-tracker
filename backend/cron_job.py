"""Simple script to trigger weekly report - can be run as a cron job."""
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlmodel import Session

from db import engine
from report import generate_and_send_weekly_report

if __name__ == "__main__":
    # Get recipients from environment
    recipients_str = os.getenv("REPORT_EMAILS", "")
    recipients = [e.strip() for e in recipients_str.split(",") if e.strip()]
    
    if not recipients:
        print("ERROR: REPORT_EMAILS environment variable not set")
        sys.exit(1)
    
    # Generate and send report
    with Session(engine) as session:
        result = generate_and_send_weekly_report(session, recipients=recipients)
        
        if result["success"]:
            print(f"SUCCESS: Report sent to {result['recipients']}")
            print(f"Week: {result['week_start']} to {result['week_end']}")
            print(f"Users reported: {result['users_reported']}")
            sys.exit(0)
        else:
            print(f"ERROR: {result.get('error')}")
            sys.exit(1)

