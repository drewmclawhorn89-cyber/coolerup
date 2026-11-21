# Security Specification — Coolerup Online Status & Watch History

## Phase 0: Data Invariants

### Online Status (`user_presence`)
1. **Identity Ownership**: Every `user_presence` document MUST have `uid == request.auth.uid`, and `uid` is immutable after creation.
2. **Temporal Integrity**: Both `createdAt` and `lastActive` MUST equal `request.time`.
3. **Privacy Consistency**: When `showOnline == false`, `isOnline` MUST be `false`, and non-owners cannot read (`get` or `list`) the document.
4. **No PII & No Location**: Only `uid`, `handle`, `isOnline`, `lastActive`, `showOnline`, and `createdAt` are permitted.

### Watch History (`watch_history`, `watch_history_settings`)
1. **Strict Owner-Only Access**: Watch History belongs strictly to the authenticated user (`uid == request.auth.uid`). No peer may `get`, `list`, `create`, `update`, or `delete` another user's watch history or settings.
2. **Temporal Integrity**: `watchedAt` and `createdAt` (and `updatedAt` on settings) MUST equal `request.time`; `createdAt` and `uid` remain immutable on update.
3. **Bounded Payloads**: `source` is strictly allowlisted (`foryou`, `videos`, `youtube`, `tiktok`, `instagram`); strings have explicit `size()` caps matching `firebase-blueprint.json`.

## The "Dirty Dozen" Attack Payloads

1. **Unauthenticated Write**: `request.auth == null` attempting `create` or `update` on `/user_presence/alice` or `/watch_history/wh_1`. Expected: `PERMISSION_DENIED`.
2. **Identity Spoofing on Create**: User `attacker_uid` creates doc with `uid: "victim_uid"`. Expected: `PERMISSION_DENIED`.
3. **Hostile Takeover on Update**: User `attacker_uid` updates `/user_presence/alice` or `/watch_history/alice_item` owned by `alice_uid`. Expected: `PERMISSION_DENIED`.
4. **UID Mutation**: Owner tries to change `uid` during update. Expected: `PERMISSION_DENIED`.
5. **Shadow Key / PII Injection**: Owner sends extra field `location: "123 Main St"` or `isAdmin: true`. Expected: `PERMISSION_DENIED`.
6. **Spoofed Past/Future Timestamp**: Owner sets `lastActive` or `watchedAt` to a forged client timestamp instead of `request.time`. Expected: `PERMISSION_DENIED`.
7. **CreatedAt Tampering**: Owner tries to modify `createdAt` on update. Expected: `PERMISSION_DENIED`.
8. **Privacy Paradox Write**: Owner sets `showOnline: false` while leaving `isOnline: true`. Expected: `PERMISSION_DENIED`.
9. **ID Poisoning**: Attacker targets `/user_presence/invalid.dot...` or `/watch_history/invalid.id`. Expected: `PERMISSION_DENIED`.
10. **Invalid Source / Overflow**: Watch History write with `source: "arbitrary"` or `title` > 300 chars. Expected: `PERMISSION_DENIED`.
11. **Peer Watch History Read (`get` / `list`)**: Authenticated peer tries to read or query `watch_history` owned by another `uid`. Expected: `PERMISSION_DENIED`.
12. **Cross-User Settings Read/Write**: Authenticated peer tries to read or flip another user's `/watch_history_settings/{victimUid}`. Expected: `PERMISSION_DENIED`.
