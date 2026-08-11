-- Display names are presentation data, not security identities. Preserve normal
-- Unicode, spaces, punctuation, symbols, and case while rejecting blank,
-- untrimmed, controlled, or excessively long values.
begin;

alter table public.online_users drop constraint if exists online_users_username_check;
alter table public.online_users add constraint online_users_username_check check (
  char_length(username) between 1 and 30
  and username = btrim(username)
  and username ~ '[^[:space:]]'
  and username !~ '[[:cntrl:]]'
);

commit;
