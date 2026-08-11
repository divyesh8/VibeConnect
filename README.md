# VibeConnect

VibeConnect is an anonymous, safety-focused stranger communication platform for text, voice, and video conversations. It uses temporary identities, transactional matching, durable moderated chat, Supabase Realtime signaling, and peer-to-peer WebRTC media.

## Product surfaces

- `/` — product landing page
- `/start` — temporary profile and communication preferences
- `/matching` — live matching queue
- `/chat/[room]` — text, voice, or video room
- `/profile` — temporary session profile
- `/admin` — protected trust and safety console

## Stack

Next.js App Router, React, TypeScript, Tailwind CSS, Framer Motion, shadcn-style UI primitives, Supabase PostgreSQL + Realtime, WebRTC, and OpenAI moderation.

## Local setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Supabase configuration is required for sessions, matching, rooms, messages, presence, and admin data. The app supports the current Vercel Marketplace names (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_URL`) as well as the legacy anon/service-role names. When live infrastructure is unavailable, the application shows an error and never creates a simulated user, conversation, or match.

## Vercel deployment

The default scripts use native Next.js 15, so Vercel can detect and deploy the App Router directly. Import the repository with:

- Framework Preset: **Next.js**
- Root Directory: repository root
- Build Command: `npm run build` (or leave the detected default)
- Output Directory: leave blank; do not set `dist` or `.next`

Add the variables from [`.env.example`](.env.example), then redeploy. If the Vercel project previously had an overridden build or output directory, remove those overrides before redeploying.

## Production data setup

Run [`supabase/schema.sql`](supabase/schema.sql) in a new Supabase project. For an existing project, apply [`supabase/migrations/002_real_human_only_matching.sql`](supabase/migrations/002_real_human_only_matching.sql) and then [`supabase/migrations/003_webrtc_room_hardening.sql`](supabase/migrations/003_webrtc_room_hardening.sql). Configure the values from [`.env.example`](.env.example), and follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The system design and audit are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/WEBRTC_AUDIT.md`](docs/WEBRTC_AUDIT.md).

The optional `npm run build:sites` command preserves the existing Cloudflare/Sites package path; it is not the Vercel build command.

## Privacy guarantees

VibeConnect stores text messages and safety records in Supabase. It never records or stores camera frames, video, microphone audio, or call recordings. Voice and video media exist only in browser memory during an active peer-to-peer session.
