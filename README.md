# Work Location Tracker

A web application for tracking where team members will work each day of the week.

## Quick Start (Local without Docker)

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Quick Start (Docker)

```bash
docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

## Week Logic

The application automatically snaps any selected date to the Monday of that week. When you change the week date, both the 7-day form and dashboard summary are regenerated.

## Environment Configuration

- Backend: No environment variables required for local development
- Frontend: Copy `.env.example` to `.env` and adjust `VITE_API_BASE` if needed

## Development Commands

### Backend
```bash
# Format and lint
ruff check . && black .

# Run tests
pytest -q
```

### Frontend
```bash
# Format and lint
npm run lint && npm run format
```

## Deployment Notes

- **Backend**: Deploy to Render, Railway, or similar. Set CORS origins for production domain.
- **Frontend**: Deploy to Vercel, Netlify, or similar. Set `VITE_API_BASE` to your production API URL.

## Features

- Submit work location for entire week at once
- View team dashboard showing where everyone is each day
- Support for Office, WFH, Client, PTO, and Off locations
- Client name required when "Client" location is selected
- Optional notes field for each day
- Responsive design with accessible form controls
