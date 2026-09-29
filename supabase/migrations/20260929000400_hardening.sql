-- Least privilege for trigger functions. Postgres refuses to call a trigger function
-- outside a trigger, so these were never exploitable, but nothing a client does needs
-- EXECUTE on them and the API should not advertise them.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.stamp_published_at() from public, anon, authenticated;
