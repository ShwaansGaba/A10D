-- ==============================================================
-- A10D: Employee Management Table & Payroll Upgrade
-- Run this in Supabase Dashboard -> SQL Editor -> Run
-- ==============================================================

-- 1. Ensure phone column exists on employees
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2. Add salary column on employees for payroll management
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS salary NUMERIC DEFAULT 0;

-- 3. Ensure user_id (Tenant ID) column exists on employees and attendance_logs
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE public.attendance_logs 
ADD COLUMN IF NOT EXISTS user_id UUID;

-- 4. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_employees_department ON public.employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_employee_code ON public.employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON public.employees(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_user_id ON public.attendance_logs(user_id);

-- Complete!
