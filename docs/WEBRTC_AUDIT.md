# WebRTC and production-readiness audit

## Working before this change

- Supabase anonymous authentication supplied the authoritative `auth.uid()` identity.
- Match proposals used row locks and `FOR UPDATE SKIP LOCKED` rather than a client-side select/update claim.
- Matchmaking used real heartbeats and never synthesized a fallback user.
- Local media used `getUserMedia()`, `addTrack()`, trickle ICE, queued early ICE candidates, and `ontrack`.
- Text messages were validated, moderated, rate limited, persisted, and streamed with Realtime.
- Voice and video existed only as in-memory WebRTC tracks; no media table, recorder, upload, or storage path existed.

## Broken

1. The initiator created its offer immediately after its own channel subscription. Supabase Broadcast does not replay messages to a peer that has not subscribed yet. If the receiver enabled media second, the receiver's later ready event could not recover the call because the initiator was already stuck in `have-local-offer`.
2. The private Realtime policies queried `room_members` and `online_users` directly. Those tables had RLS enabled, no authenticated select grant/policy, and had been explicitly revoked. The membership subqueries could therefore reject private room Broadcast and queue Presence authorization.
3. The UI called a call “connected” when only the local stream existed. It did not wait for ICE/DTLS `connectionState === "connected"`.
4. Voice/video and text hooks could create duplicate Supabase channels with the same private room topic.
5. Static TURN credentials were configured as `NEXT_PUBLIC_*`, which bundled long-lived credentials into browser JavaScript.

## Missing or risky

- No repeated peer-ready handshake, connection timeout, bounded ICE restart, relay-only test switch, remote autoplay recovery, or packet diagnostics.
- Signaling payloads did not carry/validate room IDs, timestamps, or nonces.
- Room rows were active before media connected, room teardown was not room-scoped, and the database lacked an active-membership uniqueness constraint.
- Voice rooms had no remote media element, so a received audio track could never be heard.
- Media rooms disabled the text hook to avoid a duplicate private-topic subscription, leaving no side chat during a call.
- Text history was durable but not loaded when a room was restored.
- Anti-bot protection was rate-limit-only and the age statement was not an explicit gate.

## Repairs applied

- Signaling now subscribes before permissions, repeats media-ready until both peers are present, and lets only the deterministic initiator create an offer after both peers are ready.
- One `PeerManager` owns each call. It adds validated local tracks before the offer, queues ICE until remote SDP is set, aggregates remote tracks, restarts ICE at most twice, gathers stats, and cleans up idempotently.
- Private Realtime RLS now calls narrow security-definer membership helpers; base membership and session tables remain unreadable to anonymous clients.
- Voice/video rooms start as `connecting` and become `active` only after the real peer connection reaches `connected`.
- Active `room_members` are unique per user. Ending a room atomically deactivates both memberships, clears current-room pointers, and records the reason.
- Signaling envelopes are room-bound, sender-bound, nonce-deduplicated, and time-bounded. Old room events cannot affect a new room.
- TURN configuration is served only to an authorized active room member. Managed short-lived credentials are preferred; server-only static coturn credentials remain an explicit fallback.
- Optional Cloudflare Turnstile verification and a required 18+ gate were added to session creation.
- Voice and video now attach remote tracks to an unmuted, full-volume media element and expose a user-gesture playback fallback. Mute changes the outgoing audio track's `enabled` state without renegotiation.
- Media rooms use a separate authorized `room:<uuid>:chat` topic for room-scoped messages and typing, so chat UI updates do not replace or replay the peer media stream.
- Matchmaking ranks an eligible opposite-gender candidate first and falls back atomically to another eligible same-mode candidate when none is waiting.
