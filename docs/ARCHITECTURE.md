# GidaListing API — Backend Reinvention Breakdown

This document is the detailed plan for replacing `realtor-clone`'s Firebase backend
(Auth + Firestore + Storage, all called directly from the browser) with a real
service: **NestJS + PostgreSQL**. It covers what exists today, why it's being
replaced, the new architecture, the data model, the API surface, cross-cutting
concerns, and a phased migration plan that doesn't require a big-bang rewrite of
the frontend.

---

## 1. What exists today

The current app has no backend in the conventional sense — the React client talks
directly to three Firebase products:

| Concern | Today | Where |
|---|---|---|
| Auth | Firebase Auth (email/password + Google OAuth popup) | `src/firebase.js`, `OAuth.jsx`, `SignIn/SignUp.jsx` |
| Data | Firestore, two collections: `users`, `listings` | every page does its own `getDocs`/`addDoc`/`updateDoc` |
| Files | Firebase Storage, uploaded directly from the browser | `CreateListing.jsx`, `EditListing.jsx` |
| Authorization | Firestore security rules (not in this repo) + a client-side `listing.userRef !== auth.currentUser.uid` check | `EditListing.jsx` |
| "Server logic" | None. Every query, every validation rule (`discountedPrice < regularPrice`, image count ≤ 6), and every ownership check runs in the browser. | scattered across pages |

### Concrete problems this creates

1. **No real authorization boundary.** The only thing stopping a user from
   editing someone else's listing is a `toast.error` in a `useEffect` — a
   client that skips the React app entirely (`curl`, a modified Firestore SDK
   call) is only stopped by Firestore security rules, which aren't versioned
   or tested in this repo and are easy to get wrong.
2. **No validation boundary.** `discountedPrice >= regularPrice` and the
   6-image cap are enforced in `onSubmit` handlers — trivially bypassed.
3. **Schema drift already happened.** `CreateListing.jsx` writes `bedroom` /
   `bathroom` (singular); `Listing.jsx` and `ListingItem.jsx` read
   `listing.bedrooms` / `listing.bathrooms` (plural). Every listing in
   production currently displays "1 Bed / 1 Bath" regardless of the real
   value, because there's no schema to catch the mismatch — Firestore is
   schemaless, so this shipped silently. A typed backend makes this class of
   bug a compile error.
4. **No real geo capability.** Every listing on the map renders at the same
   hard-coded coordinate (`[9.0616, 7.4217]`) — there's no geocoding step and
   no spatial index, so "listings near me" or "listings within 5km" isn't
   buildable on top of Firestore without a separate geo service anyway.
5. **Vendor lock-in and cost surface.** Every list/detail page is billed per
   document read; a "search by price range and bedroom count" feature either
   needs a composite Firestore index per filter combination or a move to a
   search service (Algolia/Typesense) layered on top — complexity Firestore
   pushes onto the client either way.
6. **No server-side image processing.** Uploaded images are stored as-is;
   there's no thumbnailing, so the listing grid downloads full-resolution
   originals.

None of this is a criticism of the original build — it's a fast, honest way to
ship a Firebase-tutorial-shaped app. It's just not a foundation for a real
marketplace with money and legal exposure (leases, sale prices) attached to
its data.

---

## 2. Target architecture

```
                                   ┌─────────────────────┐
                                   │   React frontend      │
                                   │  (existing CRA app)   │
                                   └──────────┬───────────┘
                                              │ HTTPS / JSON (REST)
                                              │ Bearer JWT
                                   ┌──────────▼───────────┐
                                   │   NestJS API           │
                                   │  ───────────────────  │
                                   │  Auth   Listings        │
                                   │  Users  Uploads          │
                                   │  Messages  Health         │
                                   └──┬────────┬──────────┬──┘
                                      │        │          │
                        ┌─────────────▼──┐ ┌───▼────┐ ┌───▼─────────┐
                        │ PostgreSQL 16    │ │ Redis  │ │ Cloudflare R2│
                        │ + PostGIS        │ │(cache, │ │ (S3-compat.  │
                        │ (Prisma ORM)     │ │ rate-  │ │  object store,│
                        │                  │ │ limit) │ │  images)     │
                        └──────────────────┘ └────────┘ └──────────────┘
```

**Stack decisions and why:**

| Layer | Choice | Why |
|---|---|---|
| Framework | **NestJS** (TypeScript) | Modular DI architecture maps cleanly onto Auth/Listings/Uploads/Messages as separate modules; first-class Guards/Pipes/Interceptors give us the authorization and validation boundary Firestore never had; matches your existing NestJS experience. |
| Database | **PostgreSQL 16 + PostGIS** | Relational integrity (a listing *must* belong to a real user — enforced by a foreign key, not convention); PostGIS gives real "listings within N km" queries instead of a hard-coded map pin. |
| ORM | **Prisma** | Schema-first, generates fully-typed queries, and `prisma migrate` gives versioned, reviewable schema history — the `bedroom`/`bedrooms` drift becomes impossible because the client is generated from one schema. |
| Auth | **Passport (JWT + Google OAuth2 strategies)**, access + refresh tokens, `argon2` password hashing | Drop-in replacement for Firebase Auth's two flows (email/password, Google) without the vendor lock-in; refresh-token rotation is something Firebase Auth also does under the hood, so behavior parity is straightforward. |
| File storage | **Cloudflare R2** (S3-compatible) via presigned upload URLs, using a generic `@aws-sdk/client-s3` client so local dev can point at MinIO instead | Same "browser uploads directly, server never proxies the bytes" shape you have today with Firebase Storage — just not locked to Firebase. R2 specifically: no egress fees on the images this app serves, and its S3-compatible API means zero custom SDK code — only `.env` differs between local MinIO and production R2. |
| Cache / rate limiting | **Redis** | Session/refresh-token denylist, `@nestjs/throttler` storage, hot-listing query cache. |
| Image processing | **sharp**, run as a background step after upload confirmation | Generates a thumbnail + a display-size variant so the listing grid stops shipping full-resolution originals. |

---

## 3. Data model

Prisma schema (also see `prisma/schema.prisma` in this scaffold for the literal,
compilable version):

```
User
 ├─ id            uuid, pk
 ├─ email          unique
 ├─ passwordHash   nullable (null for Google-only accounts)
 ├─ name
 ├─ googleId       nullable, unique
 ├─ createdAt / updatedAt
 └─ listings[]     (one-to-many)

Listing
 ├─ id                 uuid, pk
 ├─ ownerId            fk → User.id  (was: loose string userRef, unenforced)
 ├─ type                enum: RENT | SALE
 ├─ status              enum: AVAILABLE | PENDING | SOLD          (new — didn't exist before)
 ├─ name
 ├─ description
 ├─ bedrooms            int          (one canonical name — fixes the bedroom/bedrooms bug)
 ├─ bathrooms           int
 ├─ parking             boolean
 ├─ furnished           boolean
 ├─ address
 ├─ location            geography(Point, 4326)  — PostGIS, replaces hard-coded lat/lng
 ├─ regularPrice        int  (cents, to avoid float rounding on money)
 ├─ discountedPrice     int nullable
 ├─ isOffer             boolean
 ├─ createdAt / updatedAt
 ├─ images[]            (one-to-many, ordered)
 └─ messages[]          (one-to-many)

ListingImage
 ├─ id           uuid, pk
 ├─ listingId    fk → Listing.id
 ├─ url          the CDN/object-store URL
 ├─ position     int (0 = cover image — replaces "first item in imgUrls[]" convention)
 └─ createdAt

Message                                                             (new — replaces the
 ├─ id           uuid, pk                                            mailto: link)
 ├─ listingId    fk → Listing.id
 ├─ senderId     fk → User.id
 ├─ body
 └─ createdAt
```

Notable, deliberate changes from the Firestore shape:

- **`bedroom`/`bathroom` → `bedrooms`/`bathrooms`, one name, everywhere.** The
  Prisma-generated client makes the old drift a TypeScript compile error, not
  a silent runtime display bug.
- **Money in integer cents**, not floating-point dollars — `regularPrice` /
  `discountedPrice` as `int`. The `discountedPrice < regularPrice` rule moves
  from a client-side `if` into a Prisma `@@check` / a service-layer validator
  that runs on every write path, not just the form.
- **`location` is a real PostGIS point**, not two loose `latitude`/`longitude`
  numbers nobody populates — `ST_DWithin` powers "listings within N km",
  which is not buildable at all on the current schema.
- **`status` (AVAILABLE/PENDING/SOLD)** is new. It doesn't exist in the
  current app (every listing is implicitly "available" forever) but is cheap
  to add now and is exactly what the frontend redesign's status-seal system
  (see `DESIGN.md` in the frontend repo) was already designed to display.
- **`images` is its own table**, not an `imgUrls: string[]` array field —
  ordering is explicit (`position`), and each image can carry its own
  metadata (size, processed-thumbnail URL) later without a schema migration.
- **`Message` is a real row**, replacing the current `mailto:` link — this is
  what makes an in-app inbox possible later; it's additive, not required for
  parity (the API can still expose a "get the owner's email" endpoint if you
  want to keep the mailto behavior initially).

---

## 4. API surface (REST)

All endpoints return JSON; all mutating endpoints require `Authorization: Bearer <accessToken>` except where noted.

```
POST   /auth/register              { email, password, name } → { user, accessToken, refreshToken }
POST   /auth/login                 { email, password }        → { user, accessToken, refreshToken }
POST   /auth/google                { idToken }                 → { user, accessToken, refreshToken }
POST   /auth/refresh               { refreshToken }             → { accessToken, refreshToken }
POST   /auth/logout                                             → 204
POST   /auth/forgot-password       { email }                    → 202 (sends reset email)
POST   /auth/reset-password        { token, newPassword }       → 204

GET    /users/me                                                → current user profile
PATCH  /users/me                   { name }                     → updated profile

GET    /listings                   ?type=&status=&offer=&near=lat,lng&radiusKm=&cursor=&limit=   → paginated list  [public]
GET    /listings/:id                                             → listing detail   [public]
POST   /listings                   CreateListingDto              → created listing  [auth]
PATCH  /listings/:id               UpdateListingDto               → updated listing  [auth, owner-only]
DELETE /listings/:id                                              → 204              [auth, owner-only]

POST   /uploads/presign            { listingId, filename, contentType } → { uploadUrl, publicUrl }  [auth, owner-only]
POST   /uploads/confirm            { listingId, url, position }          → attaches image row, queues thumbnailing

POST   /listings/:id/messages      { body }                       → sends a message to the owner  [auth]
GET    /listings/:id/messages                                     → thread (owner or sender only)  [auth]

GET    /health                                                    → liveness/readiness probe
```

Notes:

- **Cursor pagination**, not `limit`+`startAfter(lastDoc)` — replaces the
  `lastFetchedListing` document-snapshot pattern in `Category.jsx`/`Offers.jsx`
  with an opaque cursor string, which works the same way from the client's
  point of view but doesn't require holding a live Firestore document
  reference in React state.
- **`near`/`radiusKm` on `GET /listings`** is the PostGIS-backed query that
  replaces the fixed map pin — the frontend's "Parcel Diagram" panel can
  eventually geocode the listing's address server-side (on create) and this
  endpoint becomes real.
- **Upload is still two calls, browser does the heavy lifting** — `presign`
  returns a short-lived signed PUT URL, the browser uploads the file bytes
  directly to R2 (same shape as today's `uploadBytesResumable`), then
  `confirm` tells the API the upload finished so it can download the object,
  run `sharp` thumbnailing, re-upload the thumbnail, and write the
  `ListingImage` row. The API never proxies the original upload's bytes.

---

## 5. Cross-cutting concerns

- **Validation**: every DTO (`CreateListingDto`, `UpdateListingDto`, etc.) is
  a `class-validator`-annotated class; a global `ValidationPipe` with
  `whitelist: true` rejects unknown fields and enforces types/ranges
  (`@Min(50)` on price, `@ArrayMaxSize(6)` on image count at the DTO level —
  the exact rule that only lived in a `toast.error` today).
- **Authorization**: a `JwtAuthGuard` protects any route needing a signed-in
  user; a `ListingOwnerGuard` (reads `listing.ownerId` from the DB and
  compares to `request.user.id`) protects `PATCH`/`DELETE /listings/:id` —
  this is the real version of the client-side
  `listing.userRef !== auth.currentUser.uid` check.
- **Rate limiting**: `@nestjs/throttler` backed by Redis on `/auth/*` and
  `/uploads/presign` to stop credential-stuffing and storage abuse — Firebase
  Auth did this invisibly; a bare NestJS app needs it added explicitly.
- **Error shape**: a global `HttpExceptionFilter` normalizes every error to
  `{ statusCode, message, error }` so the frontend's existing
  `toast.error(...)` call sites need a one-line change (read `error.message`
  from the REST response instead of a Firebase error object).
- **CORS/Helmet**: locked to the frontend's origin(s); `helmet()` for standard
  security headers.
- **Config**: `@nestjs/config` with a validated (Zod/Joi) `.env` schema — no
  more hard-coded `firebaseConfig` object committed to the repo (which is
  the current state of `src/firebase.js`).
- **Testing**: Jest unit tests per service (especially the price/ownership
  validation rules), Supertest e2e tests per module against a throwaway
  Postgres (Testcontainers or `docker-compose.test.yml`).
- **Observability**: `nestjs-pino` for structured logs; a `/health` endpoint
  wired for container orchestration liveness/readiness probes.

---

## 6. Migration plan (no big-bang cutover)

1. **Stand up the API against a fresh Postgres, in parallel with Firebase.**
   No traffic yet. Get `docker-compose up` + `prisma migrate dev` green and
   the endpoints above passing their e2e tests.
2. **Backfill script**: export Firestore `listings` and `users` collections
   (Firebase Admin SDK, one-off Node script), transform into the new schema —
   this is also where the `bedroom`/`bedrooms` drift gets resolved once,
   centrally, instead of per-record silently. Re-upload each listing's images
   from Firebase Storage to the R2 bucket, rewriting `imgUrls[0]` as
   `position: 0`.
3. **Introduce an API client layer in the frontend** (`src/api/*.ts`,
   `fetch`/`axios`-based) that mirrors the current Firestore call sites
   one-for-one — e.g. `getListingsByType('rent')` — so each page swaps its
   `firebase/firestore` import for the new client without changing its own
   logic or JSX. This is the same shape of change per file as the visual
   redesign was: page-by-page, testable in isolation.
4. **Swap Auth first** (`SignIn`, `SignUp`, `ForgotPassword`, `OAuth`) since
   every other authenticated call depends on it — issue the new JWT, store it
   the same way `firebase/auth`'s persisted session was read (a thin
   `useAuthStatus` rewrite, same public interface).
5. **Swap read paths** (`Home`, `Category`, `Offers`, `Listing` detail) —
   these are the lowest-risk pages since they're unauthenticated reads.
6. **Swap write paths** (`CreateListing`, `EditListing`, `Profile` delete) —
   last, since these touch the ownership/authorization boundary that's the
   whole point of the rewrite.
7. **Decommission Firebase** once the API has served production traffic for
   a full billing cycle with no fallback reads — remove `firebase` from
   `package.json`, delete `src/firebase.js`.

Each step ships independently and is revertible (the old Firebase call sites
aren't deleted until the step after them is verified in production), so this
never requires a maintenance window or a big-bang rewrite.

---

## 7. What's in this scaffold vs. what's left to do

**Scaffolded in this repo** (see `README.md` for how to run it): project
structure, `prisma/schema.prisma` (the full data model above, compilable),
Auth module (register/login/Google/refresh, JWT + Google Passport strategies,
guards), Users module, Listings module (full CRUD, DTO validation, ownership
guard, cursor pagination, geo-radius query), Uploads module (S3-compatible
presign/confirm flow, MinIO for local dev), Messages module, global
validation/exception-filter/config wiring, Docker Compose for Postgres +
Redis + MinIO, and a starter e2e test.

**Deliberately left as follow-up work**, since they depend on decisions only
you can make (which email provider for password reset, whether to keep
`mailto:` short-term): real Cloudflare R2 credentials provisioned outside
`.env.example`, an email-sending integration
(SendGrid/Postmark/SES) for `forgot-password`, the Firestore→Postgres backfill
script itself (it needs your live Firestore export), and the frontend
`src/api/*` client layer described in migration step 3.
