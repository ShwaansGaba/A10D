# FaceID Attendance Web Client

A realtime management web dashboard for the **Face Scanner Attendance Tracking System**, powered by **Supabase**.

## Features

- **Live Attendance Ticker**: Automatically streams punch-in and punch-out events in real-time as employees scan their face on the Android kiosk.
- **Realtime Metrics**: Instant counts for Present Today, Currently Out, Total Enrolled, and Total Punches.
- **Employee Directory**: Manage staff records, view multi-angle biometric status, and add/remove employees.
- **History & Filtering**: Search by employee name or filter by punch type (IN / OUT).
- **Export to CSV**: Download complete attendance audit reports with a single click.

---

## Supabase Database Setup

1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** -> **New Query**.
3. Open and copy all contents from [`web-client/schema.sql`](./schema.sql).
4. Click **Run**. This creates:
   - `employees` table (stores employee info & biometric feature vectors).
   - `attendance_logs` table (stores real-time punch events).
   - Realtime replication configuration for instant live updates.

---

## Connecting the Dashboard

1. Open [`index.html`](./index.html) in any browser (Chrome, Edge, etc.).
2. Click **Configure Supabase** in the top right.
3. Paste your **Project URL** and **Anon / Publishable Key**.
4. Click **Save & Connect**.
