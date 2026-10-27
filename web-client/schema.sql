-- ==============================================================
-- Face Attendance Tracking System - Supabase SQL Schema
-- Copy and run this script in the Supabase SQL Editor:
-- (Supabase Dashboard -> Project -> SQL Editor -> New Query)
-- ==============================================================

-- 1. Create Employees Table
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    employee_code TEXT UNIQUE,
    department TEXT DEFAULT 'General',
    photo_url TEXT,
    embeddings JSONB, -- Stores the multi-angle biometric feature vectors
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Attendance Logs Table
CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    employee_name TEXT NOT NULL,
    punch_type TEXT NOT NULL CHECK (punch_type IN ('IN', 'OUT')),
    confidence NUMERIC DEFAULT 1.0,
    photo_url TEXT,
    device_id TEXT DEFAULT 'Android-Kiosk',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Indexes for High Performance Querying
CREATE INDEX IF NOT EXISTS idx_attendance_created_at ON public.attendance_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON public.attendance_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON public.employees(name);

-- 4. Row Level Security (RLS) Configuration
-- For an internal kiosk attendance system, disabling RLS ensures both the Android Kiosk 
-- and Web Client can freely insert punches, read logs, and perform resets without permission bottlenecks:
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs DISABLE ROW LEVEL SECURITY;

-- (Optional) If you require RLS enabled, ensure full ALL (SELECT, INSERT, UPDATE, DELETE) access is permitted:
-- ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "Allow public all access to employees" ON public.employees;
-- CREATE POLICY "Allow public all access to employees" ON public.employees FOR ALL USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "Allow public all access to attendance_logs" ON public.attendance_logs;
-- CREATE POLICY "Allow public all access to attendance_logs" ON public.attendance_logs FOR ALL USING (true) WITH CHECK (true);

-- 6. Enable Realtime Replication for Live Dashboard Updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;

-- ==============================================================
-- Schema setup complete!
-- ==============================================================
