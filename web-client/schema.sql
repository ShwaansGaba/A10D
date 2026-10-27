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

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- 5. Open Read/Write Policies for Public Anon API Access (Internal Kiosk & Dashboard)
CREATE POLICY "Allow public read access to employees"
    ON public.employees FOR SELECT
    USING (true);

CREATE POLICY "Allow public insert/update to employees"
    ON public.employees FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow public all access to attendance_logs"
    ON public.attendance_logs FOR ALL
    USING (true)
    WITH CHECK (true);

-- 6. Enable Realtime Replication for Live Dashboard Updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;

-- ==============================================================
-- Schema setup complete!
-- ==============================================================
