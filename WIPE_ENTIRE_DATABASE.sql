-- ====================================================================
-- A10D: COMPLETE DATABASE & AUTH PURGE (FRESH START)
-- Run this in your Supabase Dashboard:
-- Supabase -> Project -> SQL Editor -> New Query -> Run
-- ====================================================================

-- 1. Wipe all attendance records, employees, and kiosks
TRUNCATE TABLE public.attendance_logs CASCADE;
TRUNCATE TABLE public.employees CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kiosks') THEN
    TRUNCATE TABLE public.kiosks CASCADE;
  END IF;
END $$;

-- 2. Wipe all registered accounts, identities, and sessions from Supabase Auth
DELETE FROM auth.identities;
DELETE FROM auth.sessions;
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.mfa_factors;
DELETE FROM auth.users;

-- 3. Install permanent self-delete function
-- Allows users who delete their account from the dashboard to be permanently
-- removed from auth.users (freeing their email to re-register anytime).
CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NOT NULL THEN
    -- Delete all operational records
    BEGIN
      DELETE FROM public.attendance_logs;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      DELETE FROM public.employees;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      DELETE FROM public.kiosks;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    -- Permanently delete the user from Supabase Auth
    DELETE FROM auth.users WHERE id = current_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user() TO anon;
