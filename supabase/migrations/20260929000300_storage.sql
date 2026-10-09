-- ForgeLab V0.1 storage: project thumbnails and profile avatars.
--
-- Images never go into Postgres. Both buckets are public-read so discover pages can load
-- thumbnails without a signed URL per card; object paths start with the owner's user id
-- and a random component, so a private project's thumbnail is only reachable by someone
-- who already has its exact URL. Writes are restricted to the owner's own folder, to image
-- types, and to a size limit enforced by the bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('thumbnails', 'thumbnails', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']),
  ('avatars', 'avatars', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "users upload images into their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('thumbnails', 'avatars')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "users replace images in their own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('thumbnails', 'avatars')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id in ('thumbnails', 'avatars')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "users delete images in their own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('thumbnails', 'avatars')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "users list their own images" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('thumbnails', 'avatars')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
