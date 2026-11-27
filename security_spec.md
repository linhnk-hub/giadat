# M1.1.2 D1 Unified Authorization Security Specification (Deny-by-Default)

## 1. Core D1 Security Invariants
1. **Single Source of Truth**: Admin privileges exist ONLY when `/admins/{request.auth.uid}` exists with `uid == request.auth.uid`, `role == "admin"`, and `active == true`. No Custom Claims, no `ADMIN_UIDS`, no `ADMIN_EMAILS`, and no permanent email backdoor in `isAdmin()`.
2. **Global Default Deny**: Any unmatched path (`/datasets`, `/dossiers`, `/users`, `/test/connection`, etc.) returns `PERMISSION_DENIED` for all reads and writes.
3. **No Self-Read Recursion**: On `/admins/{adminUid}` `allow get`, `request.auth.uid == adminUid` short-circuits BEFORE `isAdmin()`, requiring 0 `get()`/`exists()` calls when verifying the caller's own Admin record via Firestore REST API.
4. **One-Time Atomic Self-Closing Bootstrap**:
   - Only verified `linhnk2013@gmail.com` (`email_verified == true`) can execute Bootstrap.
   - Bootstrap MUST atomically create BOTH `/admins/{request.auth.uid}` AND `/adminSystem/bootstrap` in the same batch (`existsAfter` + `getAfter` mutual enforcement).
   - Once `/adminSystem/bootstrap` exists, it is immutable (`allow update, delete: if false`) and `isBootstrapNotInitialized()` permanently becomes `false`, closing Bootstrap forever.
   - Bootstrap can ONLY create `/admins/{request.auth.uid}` (cannot create a 2nd admin, cannot overwrite an existing document).
5. **No Self-Tampering & No Last-Admin Self-Deletion**:
   - Existing Admins can ONLY create, update, or delete OTHER admins (`adminUid != request.auth.uid`).
   - An Admin can NEVER modify their own `uid`, `role`, or `active` status, and can NEVER delete their own `/admins/{uid}` record (preventing accidental self-deletion of the last active Admin).
6. **Strict Schema, Immutability & Server Timestamps**: Every create/update enforces `hasAll`, `hasOnly`, `affectedKeys().hasOnly`, `isValidId`, `.size()` limits, immutable `uid`/`role`/`createdAt`, and `request.time`.

## 2. Adversarial Payloads ("Dirty Dozen") — All MUST Return PERMISSION_DENIED
1. **Unauthenticated read/write** to `/admins/anyUid` or `/adminSystem/bootstrap` -> DENIED.
2. **Normal Google user self-escalation**: `create /admins/{myUid}` with `role: "admin", active: true` -> DENIED (not Bootstrap owner, not `isAdmin()`).
3. **Normal Google user reading another admin's PII**: `get /admins/{otherAdminUid}` -> DENIED.
4. **Collection enumeration**: `list /admins`, `list /adminSystem`, `list /adminConfig` -> DENIED (`allow list: if false`).
5. **Unverified Bootstrap email spoof**: `email: "linhnk2013@gmail.com"`, `email_verified: false` -> DENIED.
6. **Partial Bootstrap without lock**: Bootstrap owner creating `/admins/{myUid}` WITHOUT creating `/adminSystem/bootstrap` in the same atomic batch -> DENIED (`existsAfter` fails).
7. **Second Bootstrap attempt**: Bootstrap owner attempting to create a 2nd admin or re-run Bootstrap after `/adminSystem/bootstrap` exists -> DENIED (`!exists(/adminSystem/bootstrap)` fails + `adminUid == request.auth.uid` fails).
8. **Deleting or tampering with Bootstrap lock**: ANY user (including Admin) attempting `update` or `delete` on `/adminSystem/bootstrap` -> DENIED (`if false`).
9. **Admin self-tampering**: Active Admin attempting `update /admins/{myUid}` to alter `uid`, `role`, or `active` -> DENIED (`adminUid != request.auth.uid`).
10. **Admin self-deletion (last-admin protection)**: Active Admin attempting `delete /admins/{myUid}` -> DENIED (`adminUid != request.auth.uid`).
11. **Shadow field / value poisoning / UID mismatch**: Creating/updating `/admins/{otherUid}` with extra key `{ superAdmin: true }`, wrong `role: "owner"`, `uid != otherUid`, or string > max length -> DENIED.
12. **Client timestamp forgery / immutable field overwrite**: Setting `createdAt` or `updatedAt` != `request.time`, or altering `createdAt` on update -> DENIED.
