#!/bin/bash

# Work Location Tracker Startup Script

echo "🚀 Starting Work Location Tracker..."

# Stop any existing processes
pm2 stop work-tracker-api work-tracker-frontend 2>/dev/null || true
pm2 delete work-tracker-api work-tracker-frontend 2>/dev/null || true

# Start the applications
pm2 start ecosystem.config.js

# Save the configuration
pm2 save

# Show status
pm2 status

echo "✅ Work Location Tracker is now running!"
echo "📱 Frontend: http://localhost:5173"
echo "🔧 Backend API: http://localhost:8001"
echo "📚 API Docs: http://localhost:8001/docs"
echo ""
echo "To stop: pm2 stop all"
echo "To restart: pm2 restart all"
echo "To view logs: pm2 logs"
