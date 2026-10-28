-- ==============================================================
-- MULTI-TENANCY & ACTIVE KIOSKS DATABASE MIGRATION
-- Copy and run this script in your Supabase SQL Editor:
-- (Supabase Dashboard -> Project -> SQL Editor -> New Query -> Run)
-- ==============================================================

-- 1. Add user_id (Tenant ID) to employees table
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_employees_user_id ON public.employees(user_id);

-- 2. Add user_id (Tenant ID) to attendance_logs table
ALTER TABLE public.attendance_logs 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON public.attendance_logs(user_id);

-- 3. Create Kiosks table for tracking active Android & Web terminals
CREATE TABLE IF NOT EXISTS public.kiosks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT DEFAULT 'Android',
    is_active BOOLEAN DEFAULT TRUE,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_tenant_kiosk UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_kiosks_user_id ON public.kiosks(user_id);
CREATE INDEX IF NOT EXISTS idx_kiosks_active ON public.kiosks(is_active);

-- 4. Enable Realtime Replication for Kiosks table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'kiosks'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.kiosks;
    END IF;
END $$;

-- 5. Row Level Security (RLS) Configuration
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolate employees" ON public.employees;
DROP POLICY IF EXISTS "Tenant isolate attendance_logs" ON public.attendance_logs;
DROP POLICY IF EXISTS "Tenant isolate kiosks" ON public.kiosks;
DROP POLICY IF EXISTS "Allow public all access to attendance_logs" ON public.attendance_logs;
DROP POLICY IF EXISTS "Allow public insert/update to employees" ON public.employees;
DROP POLICY IF EXISTS "Allow public read access to employees" ON public.employees;
DROP POLICY IF EXISTS "Allow public delete attendance_logs" ON public.attendance_logs;
DROP POLICY IF EXISTS "Allow public delete employees" ON public.employees;

CREATE POLICY "Tenant isolate employees" ON public.employees
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Tenant isolate attendance_logs" ON public.attendance_logs
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Tenant isolate kiosks" ON public.kiosks
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
