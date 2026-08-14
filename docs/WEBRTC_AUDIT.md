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

## Low-latency pass (2026-08-15)

### Current media path

```text
getUserMedia (live microphone + 720p camera constraints)
  -> MediaStreamTrack
  -> RTCPeerConnection.addTrack before the initial offer
  -> browser encoder / SRTP
  -> selected direct or TURN ICE candidate pair
  -> RTCPeerConnection.ontrack
  -> the received MediaStream
  -> video.srcObject
  -> requestVideoFrameCallback first-display measurement
```

There is no `MediaRecorder`, Blob, base64, canvas, `MediaSource`, `SourceBuffer`, storage upload, API upload, database insert, or Supabase Broadcast path for media. Supabase Broadcast carries only readiness, SDP, ICE, restart, and room-end control messages.

### Code-level startup-latency defect found

The signaling channel was ephemeral but the result returned by `RealtimeChannel.send()` was ignored. An offer or answer returning `timed out` or `error` therefore looked successful to the WebRTC state machine. The initiator then remained in `have-local-offer`, with `offerStartedRef` preventing another offer, until the 20-second connection failure/retry path. Repeated failure or a manual retry could turn that single missed control message into a tens-of-seconds startup stall.

Signaling Broadcast now requests acknowledgements and treats every non-`ok` result as a failure. While an initial offer is pending, the existing peer-ready heartbeat re-sends the same local SDP. The receiver handles the duplicate idempotently and re-sends its existing answer. This is signaling recovery only: it does not create another offer, renegotiate media, or create another `RTCPeerConnection`.

### Media changes

- Camera and microphone tracks are still added before `createOffer()`; video mode now asserts that both sender kinds exist.
- Capture starts at an adaptive real-time target of 1280x720, 24 fps ideal and 30 fps maximum, with echo cancellation, noise suppression, and automatic gain control.
- The video sender uses a 1.5 Mbps ceiling, a 30 fps ceiling, and `maintain-framerate` where supported. Failure is non-fatal so browser congestion control remains authoritative.
- Camera and microphone buttons only change `MediaStreamTrack.enabled`. Camera switching uses `replaceTrack()` and stops only the superseded camera track.
- The pending ICE queue and signaling messages are processed serially. Trickle ICE remains immediate; SDP is not held for ICE gathering completion.
- Async media setup is lifecycle-guarded so React cleanup, Next, or End cannot resurrect an old stream or peer connection.

### Development measurements

The development-only performance panel samples `getStats()` once per second and reports:

- connection, ICE, and signaling state;
- P2P versus TURN, local and remote candidate types, UDP/TCP relay protocol;
- RTT, available outgoing bitrate, measured incoming/outgoing bitrate;
- packet loss, jitter, and average jitter-buffer delay;
- send/receive dimensions and fps, encoded/decoded/dropped frames, quality limitation, and codec;
- match, media-ready, signaling, SDP, first ICE, ICE-connected, peer-connected, first inbound packet, first decoded frame, and first displayed frame timestamps.

`requestVideoFrameCallback()` records the actual first displayed remote video frame. Stats remain in browser memory and are not persisted.

### Benchmark status

No before/after network numbers are claimed from this code-only environment: it has no active Supabase deployment credentials, two live matched sessions, camera devices, or cross-network TURN path. Use the panel on two real devices and record the following for normal ICE and forced-relay development tests:

| Test | Peer connected | First remote frame | RTT | Jitter | Jitter buffer | Loss | Route |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Before (historical capture required) | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| Normal ICE / Wi-Fi to Wi-Fi | pending device test | pending | pending | pending | pending | pending | pending |
| Normal ICE / Wi-Fi to mobile | pending device test | pending | pending | pending | pending | pending | pending |
| Forced TURN / development only | pending device test | pending | pending | pending | pending | pending | pending |

If first packet, decode, and display timestamps are close but RTT or jitter-buffer delay is large, the remaining cause is the selected network/TURN path. If peer connection is fast but the first packet is late, inspect sender encoding and outbound bandwidth. If packets arrive immediately but decode/display is late, inspect receiver CPU and codec behavior with `chrome://webrtc-internals`.

## In-call text latency pass (2026-08-15)

The previous text path was:

```text
send -> unbounded external moderation -> database insert
     -> Postgres replication -> remote browser
```

The external moderation fetch had no timeout, so a slow provider request blocked insertion for 15–20 seconds. After insertion, delivery still depended entirely on Postgres Changes replication.

The repaired path is:

```text
send -> immediate local high-risk guard
     -> provider moderation (1.5 second maximum, then local fallback)
     -> database insert
     -> private Broadcast containing only the persisted message ID
     -> receiver fetches that ID through the authorized API
     -> render

Postgres Changes remains an automatic deduplicated fallback.
```

The fast notification never contains message text. A client cannot use it to bypass moderation: the receiver displays only the row returned by the room-membership-authorized API after persistence. Development logs report API persistence time, notification success, verification time, approximate end-to-end time, and Postgres fallback latency without saving metrics.
