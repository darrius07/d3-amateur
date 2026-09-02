BEGIN;

REVOKE INSERT, UPDATE, DELETE ON public.user_profiles FROM authenticated;
GRANT UPDATE (display_name) ON public.user_profiles TO authenticated;

DROP POLICY IF EXISTS "user_profiles_insert_own" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update_own" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_admin_full" ON public.user_profiles;

CREATE POLICY "user_profiles_update_display_name_own"
ON public.user_profiles FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

CREATE OR REPLACE FUNCTION public.is_d3_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles AS profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.d3_admin_role IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_d3_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_d3_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_d3_admin() TO authenticated, service_role;

COMMIT;
