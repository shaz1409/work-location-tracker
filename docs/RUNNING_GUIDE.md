# Work Location Tracker - Always Running Setup

## 🚀 Current Status
Your Work Location Tracker is now running with PM2! Both services are online and will automatically restart if they crash.

## 📱 Access Points
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8001
- **API Documentation**: http://localhost:8001/docs

## 🛠️ PM2 Commands

### Basic Management
```bash
# View status
pm2 status

# View logs
pm2 logs

# Restart all services
pm2 restart all

# Stop all services
pm2 stop all

# Start all services
pm2 start all
```

### Individual Service Management
```bash
# Restart just the API
pm2 restart work-tracker-api

# Restart just the frontend
pm2 restart work-tracker-frontend

# View logs for specific service
pm2 logs work-tracker-api
pm2 logs work-tracker-frontend
```

## 🔄 Auto-Start on Boot (Optional)

To make the services start automatically when your Mac boots up, run:

```bash
sudo env PATH=$PATH:/opt/homebrew/Cellar/node/24.10.0/bin /opt/homebrew/lib/node_modules/pm2/bin/pm2 startup launchd -u shazahmed --hp /Users/shazahmed
```

Then save the current configuration:
```bash
pm2 save
```

## 📁 Log Files
All logs are saved to:
- `/Users/shazahmed/Documents/python_repos/work_tracker/logs/`

## 🛑 Stopping Everything
```bash
pm2 stop all
pm2 delete all
```

## 🔧 Troubleshooting

### If services won't start:
```bash
# Check logs
pm2 logs

# Restart everything
pm2 restart all

# Or use the startup script
cd /Users/shazahmed/Documents/python_repos/work_tracker
./start.sh
```

### If you need to update the code:
The services will automatically restart when you make changes to the code (hot reload is enabled).

## 📊 Monitoring
```bash
# Real-time monitoring
pm2 monit

# View detailed status
pm2 show work-tracker-api
pm2 show work-tracker-frontend
```

## 🎯 Summary
Your Work Location Tracker is now running continuously! It will:
- ✅ Start automatically when you run `./start.sh`
- ✅ Restart automatically if it crashes
- ✅ Run in the background
- ✅ Log all activity
- ✅ Be accessible at http://localhost:5173

The application will keep running until you explicitly stop it with `pm2 stop all`.
