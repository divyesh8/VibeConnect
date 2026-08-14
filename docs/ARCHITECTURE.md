# VibeConnect architecture

## System overview

VibeConnect is a Next.js App Router application with a deliberately thin server boundary. The browser owns temporary presentation state and media streams. Next.js route handlers validate every mutation, enforce rate limits, authenticate the anonymous session through an HTTP-only cookie, and use a Supabase service-role client. Supabase PostgreSQL is the durable source of truth for presence, rooms, messages, safety actions, and enforcement history.

No signup screen or PII is requested. The browser invisibly creates a Supabase Anonymous Auth session and receives a real authenticated UUID. Starting a session binds the temporary profile to that UUID and issues a high-entropy HTTP-only application cookie for server-route isolation. A single client provider stores and restores the non-secret profile from `sessionStorage` under `vibeconnect_guest_profile`; room, media, Realtime, and queue cleanup never clear it. Only the explicit Exit / Reset Profile action removes it. Display names preserve Unicode, spaces, punctuation, symbols, and case, while the client, API, and database consistently reject blank, controlled, untrimmed, or over-30-character values.

## Database design

- `online_users`: temporary identity, matching preferences, queue state, ten-second heartbeat, and warning count.
- `match_proposals`: two-person acceptance handshake with a short expiration window.
- `chat_rooms` + `room_members`: room lifecycle and membership authorization.
- `messages`: durable text history with delivery/seen timestamps.
- `blocks`: symmetric matching exclusion, checked in both directions.
- `reports`: structured moderation queue.
- `banned_users`: temporary enforcement window.
- `moderation_events`: provider, flagged categories, and scores without duplicating message content.
- `rate_limit_buckets`: hashed distributed fixed-window limits.

All application tables use RLS. Direct table writes are revoked; validated server routes write with the service role. Native Supabase Auth access tokens authorize private Presence and Broadcast topics through RLS.

## Matching algorithm

`propose_real_match` locks the requester and scans same-mode searching users with `FOR UPDATE SKIP LOCKED`, excluding active bans, blocks, stale heartbeats, and active-room memberships. Male and female sessions rank the opposite gender first; recent partners are ranked behind fresh candidates instead of being excluded, so a genuinely live two-person queue can reconnect. If nobody eligible is live, the requester remains in the queue indefinitely. The browser also joins a private Supabase Realtime Presence topic for its communication mode, deduplicates presence metas by authenticated user ID, and refreshes `last_seen` every ten seconds.

A candidate creates only a time-limited `match_proposals` row and moves both users into `confirming`. Each browser must call `accept_real_match`; only when both live sessions accept does PostgreSQL atomically create the room, add both memberships, and mark both users connected. A decline, timeout, cancellation, lost heartbeat, or closed browser returns any remaining live user to searching. There is no generated identity or automated conversation path.

During a live call, **Another Vibe** creates a replacement proposal with the requester already accepted while leaving the current room and media connection active. If nobody eligible is waiting, or the candidate declines or times out, the proposal changes no room state and the original call continues. Only after the replacement accepts does one transaction end the old room, deactivate its memberships, create the new room, and move both accepted users into it.

## Realtime chat

Text writes pass through `/api/messages`, where active membership, room scope, length, normalization, rate limiting, and moderation are checked before insertion. Local high-risk moderation runs first; provider moderation has a strict latency bound and falls back to the local guard if unavailable. After persistence, the sender broadcasts only a message ID on the private room-chat topic. The receiver fetches that exact persisted row through the membership-authorized API before rendering it. Supabase Postgres Changes remains a deduplicated fallback, so a delayed replication event cannot delay the normal delivery path and a forged client Broadcast cannot inject unmoderated text. Text, voice, and video rooms all use the same chat panel and room-scoped history. Typing status uses ephemeral Realtime Broadcast and is never written to the database.

## WebRTC flow

After both people explicitly accept the video match, each room requests camera and microphone permission on arrival and retains a retry button for denied or interrupted requests. Both browsers first subscribe to the private signaling topic and repeat a media-ready event until both sides are ready. Only the deterministic initiator creates the offer. Each peer adds its validated in-memory `MediaStream`, including a live audio track, to exactly one `RTCPeerConnection` before SDP creation. Offer, answer, and queued trickle-ICE payloads travel as ephemeral Broadcast events through the signaling topic; they are never inserted into PostgreSQL. A separate private room chat topic avoids duplicate-channel collisions without changing room authorization. Remote tracks are attached to an audible media element in both voice and video modes, with an explicit user-gesture fallback when browser autoplay policy blocks playback. The room remains `connecting` until the browser reports a genuinely connected peer state. Audio and video tracks flow peer-to-peer over SRTP and are never sent to Supabase, the application server, database, or object storage. ICE configuration comes from a room-authorized server endpoint so TURN secrets are not bundled into JavaScript.

## Safety and operations

Messages use the OpenAI `omni-moderation-latest` endpoint when `OPENAI_API_KEY` is configured, with a deterministic emergency filter if the moderation service is unavailable. Flagged content is rejected before storage, increments the sender warning count, and produces a temporary 24-hour ban after repeated violations. Session creation is distributed-rate-limited and optionally requires a server-verified Cloudflare Turnstile token. The hidden admin route requires `ADMIN_ACCESS_TOKEN` and displays only current database counts and reports.

## Scaling notes

Stateless app instances can scale horizontally on Vercel. Matching concurrency and rate limits live in PostgreSQL, Realtime fans out presence, chat, and signaling events, and WebRTC keeps media bandwidth off the application. Match queries reject heartbeats older than 25 seconds and release expired proposals transactionally. A scheduled cleanup should also mark stale sessions offline, end orphaned rooms, remove expired rate-limit buckets, and delete anonymous presence according to the product retention policy.
