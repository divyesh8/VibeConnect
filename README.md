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

The interface runs in preview mode without credentials. Live matching, persistent messages, private Realtime channels, and admin data require Supabase configuration.

## Vercel deployment

The default scripts use native Next.js 15, so Vercel can detect and deploy the App Router directly. Import the repository with:

- Framework Preset: **Next.js**
- Root Directory: repository root
- Build Command: `npm run build` (or leave the detected default)
- Output Directory: leave blank; do not set `dist` or `.next`

Add the variables from [`.env.example`](.env.example), then redeploy. If the Vercel project previously had an overridden build or output directory, remove those overrides before redeploying.

## Production data setup

Run [`supabase/schema.sql`](supabase/schema.sql) in a new Supabase project, configure the values from [`.env.example`](.env.example), and follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The system design and security boundaries are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

The optional `npm run build:sites` command preserves the existing Cloudflare/Sites package path; it is not the Vercel build command.

## Privacy guarantees

VibeConnect stores text messages and safety records in Supabase. It never records or stores camera frames, video, microphone audio, or call recordings. Voice and video media exist only in browser memory during an active peer-to-peer session.
