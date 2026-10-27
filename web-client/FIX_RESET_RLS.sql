-- ==============================================================
-- FIX FOR ATTENDANCE RESET NOT PERSISTING ON SUPABASE SERVER
-- Run this in your Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ==============================================================

-- Disable Row Level Security (RLS) so both the Web Dashboard and 
-- Android Kiosk can freely insert, select, update, and DELETE records:
ALTER TABLE public.attendance_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;

-- If you prefer keeping RLS active, you can instead run these explicit policies:
-- DROP POLICY IF EXISTS "Allow public delete attendance_logs" ON public.attendance_logs;
-- DROP POLICY IF EXISTS "Allow public delete employees" ON public.employees;
-- CREATE POLICY "Allow public delete attendance_logs" ON public.attendance_logs FOR DELETE USING (true);
-- CREATE POLICY "Allow public delete employees" ON public.employees FOR DELETE USING (true);
