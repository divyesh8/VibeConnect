# VibeConnect architecture

## System overview

VibeConnect is a Next.js App Router application with a deliberately thin server boundary. The browser owns temporary presentation state and media streams. Next.js route handlers validate every mutation, enforce rate limits, authenticate the anonymous session through an HTTP-only cookie, and use a Supabase service-role client. Supabase PostgreSQL is the durable source of truth for presence, rooms, messages, safety actions, and enforcement history.

No account is created. Starting a session generates a user UUID, public session UUID, and a high-entropy secret kept only in an HTTP-only, same-site cookie. Only its SHA-256 hash is stored. The browser stores the non-secret temporary profile in `sessionStorage` for navigation continuity; it is not authoritative.

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

All application tables use RLS. Anonymous and regular authenticated database writes are revoked; server routes write with the service role. Custom, short-lived JWTs grant room members read access to only their room's message stream and private Realtime broadcast topic.

## Matching algorithm

`propose_real_match` locks the requester, scans same-mode searching users with `FOR UPDATE SKIP LOCKED`, and excludes active bans, blocks, stale heartbeats, and pairs seen in the previous 24 hours. If nobody eligible is live, the requester remains in the queue indefinitely. The browser also joins a private Supabase Realtime Presence topic for its communication mode and refreshes `last_seen` every ten seconds.

A candidate creates only a time-limited `match_proposals` row and moves both users into `confirming`. Each browser must call `accept_real_match`; only when both live sessions accept does PostgreSQL atomically create the room, add both memberships, and mark both users connected. A decline, timeout, cancellation, lost heartbeat, or closed browser returns any remaining live user to searching. There is no generated identity or automated conversation path.

## Realtime chat

Text writes pass through `/api/messages`, where membership, length, normalization, rate limiting, and moderation are checked before insertion. Supabase Realtime streams inserted messages to authorized room members. Typing status uses ephemeral Realtime Broadcast and is never written to the database.

## WebRTC flow

Voice and video permissions are requested only after a user gesture. Each peer adds the in-memory `MediaStream` to an `RTCPeerConnection`. Offer, answer, and ICE candidate payloads travel through the room's private Supabase Realtime channel. Audio and video tracks flow peer-to-peer over SRTP; they are never sent to the application server, database, or object storage. Production deployments should configure a TURN service in addition to STUN for restrictive networks.

## Safety and operations

Messages use the OpenAI `omni-moderation-latest` endpoint when `OPENAI_API_KEY` is configured, with a deterministic emergency filter if the moderation service is unavailable. Flagged content is rejected before storage, increments the sender warning count, and produces a temporary 24-hour ban after repeated violations. The hidden admin route requires `ADMIN_ACCESS_TOKEN` and displays only current database counts and reports.

## Scaling notes

Stateless app instances can scale horizontally on Vercel. Matching concurrency and rate limits live in PostgreSQL, Realtime fans out presence, chat, and signaling events, and WebRTC keeps media bandwidth off the application. Match queries reject heartbeats older than 25 seconds and release expired proposals transactionally. A scheduled cleanup should also mark stale sessions offline, end orphaned rooms, remove expired rate-limit buckets, and delete anonymous presence according to the product retention policy.
