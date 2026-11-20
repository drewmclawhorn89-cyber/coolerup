# Security Specification — Coolerup Online Status (`user_presence`)

## Phase 0: Data Invariants

1. **Identity Ownership**: Every `user_presence` document MUST have `uid == request.auth.uid`, and `uid` is immutable after creation (`incoming().uid == existing().uid`).
2. **Temporal Integrity**: Both `createdAt` (on create) and `lastActive` (on create and update) MUST equal `request.time`. `createdAt` MUST remain immutable after creation.
3. **Privacy Consistency**: When `showOnline == false`, `isOnline` MUST be `false`, and non-owners are barred from reading (`get` or `list`) the document.
4. **No PII & No Location**: Only `uid`, `handle`, `isOnline`, `lastActive`, `showOnline`, and `createdAt` are permitted (`keys().hasOnly(...)`). Any shadow/extra keys (e.g., `location`, `lat`, `lng`, `email`, `phone`, `isAdmin`) are rejected.
5. **Path & Value Boundaries**: Document IDs (`presenceId`) and `uid` MUST match `^[a-zA-Z0-9_\-]+$` (1–128 chars). `handle` MUST match `^[a-z0-9._]+$` (1–40 chars).

## The "Dirty Dozen" Attack Payloads

1. **Unauthenticated Write**: `request.auth == null` attempting `create` or `update` on `/user_presence/alice`. Expected: `PERMISSION_DENIED`.
2. **Identity Spoofing on Create**: User `attacker_uid` creates `/user_presence/alice` with `uid: "victim_uid"`. Expected: `PERMISSION_DENIED`.
3. **Hostile Takeover on Update**: User `attacker_uid` updates `/user_presence/alice` owned by `alice_uid` to set `isOnline: false`. Expected: `PERMISSION_DENIED`.
4. **UID Mutation**: Owner tries to change `uid` during update (`incoming.uid != existing.uid`). Expected: `PERMISSION_DENIED`.
5. **Shadow Key / PII Injection**: Owner sends extra field `location: "123 Main St"` or `isAdmin: true`. Expected: `PERMISSION_DENIED`.
6. **Spoofed Past/Future Timestamp**: Owner sets `lastActive` to a forged client timestamp instead of `request.time`. Expected: `PERMISSION_DENIED`.
7. **CreatedAt Tampering**: Owner tries to modify `createdAt` on update. Expected: `PERMISSION_DENIED`.
8. **Privacy Paradox Write**: Owner sets `showOnline: false` while leaving `isOnline: true`. Expected: `PERMISSION_DENIED`.
9. **ID Poisoning**: Attacker targets `/user_presence/invalid.dot.or.1500byte_id...` violating `isValidId`. Expected: `PERMISSION_DENIED`.
10. **Invalid Handle Type / Overflow**: Owner sends `handle: 12345` or a 100-char string (`> 40`). Expected: `PERMISSION_DENIED`.
11. **Hidden Presence Scraping (`get`)**: Authenticated peer tries `get` on `/user_presence/hidden_user` where `showOnline == false`. Expected: `PERMISSION_DENIED`.
12. **Hidden Presence Scraping (`list`)**: Authenticated peer runs unfiltered `collection('user_presence')` query without `showOnline == true`. Expected: `PERMISSION_DENIED`.
