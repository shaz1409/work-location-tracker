# 📧 Weekly Report Setup Guide

## Overview

The system can automatically generate and email a weekly report showing:
- **Days each person was NOT working from home** (excluding holidays)
- Sent every **Monday morning** for the **previous week** (Mon-Fri)

## What the Report Shows

- **Team Member Name**
- **Days in Office/Client Site** (count of Neal Street + Client Office days)
- **Excludes**: WFH days and Holidays

## Setup Instructions

### Step 1: Configure Email Settings

In your **Render dashboard** → **API service** → **Environment Variables**, add:

```
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
FROM_EMAIL=your-email@gmail.com
REPORT_EMAILS=recipient1@company.com,recipient2@company.com
```

**For Gmail:**
1. Enable 2-Factor Authentication
2. Generate an "App Password": https://myaccount.google.com/apppasswords
3. Use that App Password (not your regular password)

**For Other Email Providers:**
- **Outlook/Office 365**: `smtp.office365.com`, port `587`
- **SendGrid**: `smtp.sendgrid.net`, port `587`, username `apikey`, password = your API key
- **Custom SMTP**: Use your company's SMTP settings

### Step 2: Set Up Cron Job

**Option A: Using Render Cron Job (Recommended)**

1. Go to **Render Dashboard** → **New** → **Cron Job**
2. Configure:
   - **Name**: `weekly-report`
   - **Repository**: Your GitHub repo (same as API)
   - **Root Directory**: `backend`
   - **Schedule**: `0 8 * * 1` (Every Monday at 8 AM UTC)
   - **Command**: `python cron_job.py`
   - **Environment Variables**: 
     - Copy all SMTP settings from your API service
     - Copy DATABASE_URL from your API service
     - Set `REPORT_EMAILS` (same as in API service)
   - **Plan**: Free

**Option B: Using HTTP Endpoint + External Cron Service**

Call the API endpoint via external service:

1. Use **cron-job.org** (free) or similar:
   - URL: `https://your-api-url.onrender.com/admin/send-weekly-report`
   - Method: `POST`
   - Schedule: Every Monday at 8 AM UTC
   - No authentication needed (or add API key header if you secure the endpoint)

Other options:
- **EasyCron** (free tier)
- **Zapier** (paid)
- Any service that can make HTTP POST requests on a schedule

### Step 3: Test the Report

**Manual Test (without waiting for Monday):**

```bash
curl -X POST "https://your-api-url.onrender.com/admin/send-weekly-report?recipients=test@example.com"
```

Or visit in browser (GET will work too for testing):
```
https://your-api-url.onrender.com/admin/send-weekly-report?recipients=test@example.com
```

## Schedule Format

The cron schedule `0 8 * * 1` means:
- `0` = minute 0
- `8` = hour 8 (8 AM)
- `*` = every day of month
- `*` = every month
- `1` = Monday

**Adjust timezone:**
- Render cron jobs use UTC
- To send at 8 AM your local time, adjust:
  - **9 AM UK** (BST) = `0 7 * * 1` (7 AM UTC)
  - **8 AM EST** = `0 13 * * 1` (1 PM UTC)
  - **8 AM PST** = `0 16 * * 1` (4 PM UTC)

## Report Format

The email includes:
- **HTML table** with team members and their office/client days
- **Professional styling** (black/white theme matching your app)
- **Date range** for the reported week
- **Generated timestamp**

## Troubleshooting

**Report not sending:**
1. Check Render logs for errors
2. Verify SMTP credentials are correct
3. Test manually with curl command above
4. Check spam folder

**Report shows wrong data:**
- Report uses **previous week** (last Monday-Friday)
- Make sure people are entering data correctly
- Check database directly if needed

**Cron job not running:**
- Verify cron job is active in Render dashboard
- Check cron job logs
- Ensure API URL is correct in cron command
- Consider using external cron service if Render cron isn't working

## Security Notes

- The endpoint is currently **unprotected** (anyone can call it)
- For production, add authentication:
  - API key header check
  - Render cron jobs can set a secret header
  - Or use Render's built-in auth features

## Example Environment Variables Summary

```bash
# Email Settings
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@company.com
SMTP_PASSWORD=your-app-password-here
FROM_EMAIL=noreply@company.com

# Report Recipients (comma-separated)
REPORT_EMAILS=manager1@company.com,manager2@company.com,hr@company.com

# Database (auto-set by Render)
DATABASE_URL=postgresql://...
```

---

**That's it!** Once configured, reports will automatically send every Monday morning. 🎉

