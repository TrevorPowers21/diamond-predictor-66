-- Step 1a — Add 'superadmin' to the app_role enum.
--
-- Superadmins are NewtForce-level users (Peyton, Trevor, etc.) with cross-team
-- access. Team-level roles (team_admin, general_user) live in the new
-- public.user_team_access table, not here.
--
-- Note: ALTER TYPE ... ADD VALUE is permitted inside a transaction in
-- Postgres 12+, but the new value cannot be referenced in the same
-- transaction. This migration only adds the value; superadmin INSERTs
-- happen later in the bootstrap SQL.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'superadmin';
