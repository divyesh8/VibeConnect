# Deployment

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor. For an existing database, run `supabase/migrations/002_real_human_only_matching.sql` first.
2. Copy `.env.example` to `.env.local` and fill the Supabase URL, publishable key, secret key, JWT secret, a long random admin token, and optionally an OpenAI API key. Legacy anon and service-role key names remain supported.
3. Confirm Realtime is enabled for `public.messages`. The schema adds it to the publication and creates private channel policies.
4. Import the repository into Vercel. Select the **Next.js** framework preset, use the repository root, and leave Output Directory blank. The committed `vercel.json` and native `next build` script prevent the project from being treated as a static `dist` deployment.
5. Add the same environment variables in Project Settings. The Vercel Supabase Marketplace integration can synchronize them automatically when connected without a custom prefix. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS origin, then redeploy.
6. Add a TURN provider and replace the default STUN-only configuration in `webrtc/peer-manager.ts` before broad production use.
7. Add a scheduled job for stale presence and expired-bucket cleanup, then configure abuse monitoring and retention policies for your jurisdiction.

Run `npm run build` before deployment. No R2, S3, or media storage is required or expected.
