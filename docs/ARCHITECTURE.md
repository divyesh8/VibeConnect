# VibeConnect architecture

## System overview

VibeConnect is a Next.js App Router application with a deliberately thin server boundary. The browser owns temporary presentation state and media streams. Next.js route handlers validate every mutation, enforce rate limits, authenticate the anonymous session through an HTTP-only cookie, and use a Supabase service-role client. Supabase PostgreSQL is the durable source of truth for presence, rooms, messages, safety actions, and enforcement history.

No account is created. Starting a session generates a user UUID, public session UUID, and a high-entropy secret kept only in an HTTP-only, same-site cookie. Only its SHA-256 hash is stored. The browser stores the non-secret temporary profile in `sessionStorage` for navigation continuity; it is not authoritative.

## Database design

- `users_online`: temporary identity, matching preferences, queue state, heartbeat, and warning count.
- `chat_rooms` + `room_members`: room lifecycle and membership authorization.
- `messages`: durable text history with delivery/seen timestamps.
- `blocks`: symmetric matching exclusion, checked in both directions.
- `reports`: structured moderation queue.
- `banned_users`: temporary enforcement window.
- `moderation_events`: provider, flagged categories, and scores without duplicating message content.
- `rate_limit_buckets`: hashed distributed fixed-window limits.

All application tables use RLS. Anonymous and regular authenticated database writes are revoked; server routes write with the service role. Custom, short-lived JWTs grant room members read access to only their room's message stream and private Realtime broadcast topic.

## Matching algorithm

`match_anonymous_user` runs in one PostgreSQL transaction. It locks the requester, scans compatible waiting users with `FOR UPDATE SKIP LOCKED`, and excludes active bans, blocks, stale heartbeats, and pairs seen in the previous 24 hours. Candidates rank by preferred gender pairing, number of shared interests, optional age group, and queue wait time. Room creation, membership creation, and both presence updates happen atomically, preventing double matches under load.

## Realtime chat

Text writes pass through `/api/messages`, where membership, length, normalization, rate limiting, and moderation are checked before insertion. Supabase Realtime streams inserted messages to authorized room members. Typing status uses ephemeral Realtime Broadcast and is never written to the database.

## WebRTC flow

Voice and video permissions are requested only after a user gesture. Each peer adds the in-memory `MediaStream` to an `RTCPeerConnection`. Offer, answer, and ICE candidate payloads travel through the room's private Supabase Realtime channel. Audio and video tracks flow peer-to-peer over SRTP; they are never sent to the application server, database, or object storage. Production deployments should configure a TURN service in addition to STUN for restrictive networks.

## Safety and operations

Messages use the OpenAI `omni-moderation-latest` endpoint when `OPENAI_API_KEY` is configured, with a deterministic emergency filter as a fallback. Flagged content is rejected before storage, increments the sender warning count, and produces a temporary 24-hour ban after repeated violations. The hidden admin route requires `ADMIN_ACCESS_TOKEN`; the local UI accepts `preview` only for non-live sample data.

## Scaling notes

Stateless app instances can scale horizontally on Vercel. Matching concurrency and rate limits live in PostgreSQL, Realtime fans out chat and signaling events, and WebRTC keeps media bandwidth off the application. A scheduled cleanup should mark heartbeats older than 90 seconds offline, end orphaned rooms, remove expired rate-limit buckets, and delete anonymous presence according to the product retention policy.
