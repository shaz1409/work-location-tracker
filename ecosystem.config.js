module.exports = {
  apps: [
    {
      name: "work-tracker-api",
      script: "python3",
      args: ["-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"],
      cwd: "/Users/shazahmed/Documents/python_repos/work_tracker/backend",
      env: {
        PYTHONPATH: "/Users/shazahmed/Documents/python_repos/work_tracker/backend"
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "/Users/shazahmed/Documents/python_repos/work_tracker/logs/api-error.log",
      out_file: "/Users/shazahmed/Documents/python_repos/work_tracker/logs/api-out.log",
      log_file: "/Users/shazahmed/Documents/python_repos/work_tracker/logs/api-combined.log"
    },
    {
      name: "work-tracker-frontend",
      script: "npm",
      args: ["run", "dev"],
      cwd: "/Users/shazahmed/Documents/python_repos/work_tracker/frontend",
      env: {
        VITE_API_BASE: "http://localhost:8002"
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "/Users/shazahmed/Documents/python_repos/work_tracker/logs/frontend-error.log",
      out_file: "/Users/shazahmed/Documents/python_repos/work_tracker/logs/frontend-out.log",
      log_file: "/Users/shazahmed/Documents/python_repos/work_tracker/logs/frontend-combined.log"
    }
  ]
}
