# Deployment

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor. For an existing database, apply the numbered migrations in order through `006_permissive_display_names.sql`.
2. Copy `.env.example` to `.env.local` and fill the Supabase URL, publishable key, secret key, a long random admin token, and optionally an OpenAI API key. Legacy anon and service-role key names remain supported. `SUPABASE_JWT_SECRET` is needed only by the legacy custom Realtime-token endpoints.
3. Confirm Realtime is enabled for `public.messages`. The schema adds it to the publication and creates private channel policies.
4. Import the repository into Vercel. Select the **Next.js** framework preset, use the repository root, and leave Output Directory blank. The committed `vercel.json` and native `next build` script prevent the project from being treated as a static `dist` deployment.
5. Add the same environment variables in Project Settings. The Vercel Supabase Marketplace integration can synchronize them automatically when connected without a custom prefix. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS origin, then redeploy.
6. Configure `TURN_CREDENTIALS_URL` for a provider that returns short-lived `iceServers`, or set the server-only `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` coturn fallback. Do not restore `NEXT_PUBLIC_TURN_*`. Set `WEBRTC_FORCE_RELAY=true` only in development to run a relay-only test.
7. Create a Cloudflare Turnstile widget and configure both `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Leaving both blank disables the optional challenge; never configure only the secret.
8. Add a scheduled job for stale presence and expired-bucket cleanup, then configure abuse monitoring and retention policies for your jurisdiction.

Run `npm run build` before deployment. No R2, S3, or media storage is required or expected.
