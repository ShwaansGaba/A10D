-- ====================================================================
-- A10D: Enable Client-Side Complete User Purge (auth.users)
-- Run this ONCE in your Supabase Dashboard -> SQL Editor -> Run
-- ====================================================================
--
-- Why this is needed:
-- By default, Supabase's client-side anon key cannot delete rows from 
-- auth.users for security reasons. 
--
-- This function runs with SECURITY DEFINER privileges (as database owner),
-- allowing an authenticated user to completely delete their OWN user record 
-- from auth.users (auth.uid()), which permanently frees their email address 
-- so they can sign up again anytime.
-- ====================================================================

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
    -- 1. Delete all attendance logs associated with employees
    DELETE FROM public.attendance_logs 
    WHERE employee_id IN (SELECT id FROM public.employees);

    -- 2. Delete all enrolled employees
    DELETE FROM public.employees;

    -- 3. Delete from kiosks if table exists
    BEGIN
      DELETE FROM public.kiosks WHERE user_id = current_user_id;
    EXCEPTION WHEN OTHERS THEN
      -- table might not exist in schema, ignore safely
    END;

    -- 4. PERMANENTLY PURGE the user record from auth.users
    -- This frees up the email address so the user can immediately re-register
    DELETE FROM auth.users WHERE id = current_user_id;
  END IF;
END;
$$;

-- Grant execution permission to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;
