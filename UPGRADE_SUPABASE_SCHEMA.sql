-- ==============================================================
-- A10D: Schema Synchronization & Kiosks Table Setup
-- Run this in Supabase Dashboard -> SQL Editor -> Run
-- ==============================================================

-- 1. Ensure user_id (Tenant ID) column exists on employees
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS idx_employees_user_id ON public.employees(user_id);

-- 2. Ensure user_id (Tenant ID) column exists on attendance_logs
ALTER TABLE public.attendance_logs 
ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON public.attendance_logs(user_id);

-- 3. Create kiosks table for tracking active Android terminals & presence
CREATE TABLE IF NOT EXISTS public.kiosks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT DEFAULT 'Android Phone',
    is_active BOOLEAN DEFAULT TRUE,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosks_user_id ON public.kiosks(user_id);
CREATE INDEX IF NOT EXISTS idx_kiosks_active ON public.kiosks(is_active);

-- 4. Enable Realtime Replication for instant live sync across Web & Mobile
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
  EXCEPTION WHEN OTHERS THEN END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_logs;
  EXCEPTION WHEN OTHERS THEN END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.kiosks;
  EXCEPTION WHEN OTHERS THEN END;
END $$;
