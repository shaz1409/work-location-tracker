# ⚙️ Check Your Vercel Settings

Before the build succeeds, please verify these Vercel settings:

## ✅ Settings → General

1. Go to **Settings** tab in your Vercel project
2. Click **"General"** section
3. Scroll down to **"Root Directory"**
4. **Make sure it says**: `frontend`
5. If it's empty or says `/`, **change it** to `frontend`
6. Click **"Save"**

## ✅ Settings → Environment Variables

1. Go to **Settings** tab
2. Click **"Environment Variables"**
3. Verify you have this variable:
   - **Key**: `VITE_API_BASE`
   - **Value**: `https://work-location-tracker.onrender.com`
   - **Environment**: Production, Preview, Development
4. If missing, **add it now**

---

## 📊 After Settings are Correct

1. Go to **"Deployments"** tab
2. You should see a new deployment building
3. Wait 2-3 minutes
4. Your app will be live! 🎉

---

## 🎯 Why These Settings Matter

- **Root Directory (`frontend`)**: Tells Vercel to build from the `frontend` folder, not the repo root
- **Environment Variable (`VITE_API_BASE`)**: Connects your frontend to your backend API

Without these, the build will fail!

