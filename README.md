# Work Location Tracker

A beautiful web application to track where your team members are working (Office, WFH, Client, PTO, Off) throughout the week.

## 🌟 Features

- 📊 **Beautiful black-themed UI** - modern and professional
- 📅 **Week view dashboard** - see everyone's locations by day
- 👥 **Grouped by location** - Office, WFH, Client, PTO, Off
- 🔄 **Real-time updates** - instant save and refresh
- 📱 **Mobile responsive** - works on all devices
- 🆓 **100% free to use** - no costs, no accounts needed

## 🚀 Quick Start

### Local Development

```bash
# Start backend
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --port 8002

# Start frontend (in new terminal)
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173

### Using PM2 (Continuous Running)

```bash
# Start both services
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs

# Stop services
pm2 stop all
```

## 🌐 Free Hosting

See [docs/HOSTING_GUIDE.md](docs/deployment/HOSTING_GUIDE.md) for detailed instructions on deploying to:
- **Frontend**: Vercel (free forever)
- **Backend**: Render (free tier)

## 📖 Usage

1. **Fill your week**: Enter your name and select work locations for each day
2. **Save**: Click "Save my week" to store your entries
3. **View dashboard**: Switch to "Who's where" to see everyone's locations grouped by day and location type
4. **Change weeks**: Use the week selector to navigate between different weeks

## 🛠️ Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLModel, SQLite
- **Frontend**: React, TypeScript, Vite
- **Styling**: CSS with glassmorphism effects
- **Deployment**: Vercel + Render (free hosting)

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
