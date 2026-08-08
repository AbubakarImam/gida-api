# GidaListing API

NestJS + PostgreSQL backend for
[**realtor-clone**](https://github.com/AbubakarImam/realtor-clone), the
GidaListing marketplace frontend, replacing its Firebase (Auth + Firestore +
Storage) backend. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
full breakdown: what the Firebase version got wrong, why each technology here
was chosen, the data model, the complete API surface, and a phased migration
plan that doesn't require rewriting the frontend in one shot.

For a guided, code-annotated walkthrough of the implementation itself — JWTs,
authentication vs. authorization, Prisma, Docker, Jest, all explained against
the real source — see the
[**Implementation Walkthrough**](https://claude.ai/code/artifact/f0fc893b-0e38-4955-8348-4b03969cf457).

For a diagram of every request the API handles — register, login, each
listing operation, both halves of an image upload, messages, profile — see
the [**Flow Atlas**](https://claude.ai/code/artifact/e6a9c01c-f7d5-409d-8695-5f3354727d4d).

## What's here

- **Auth module** — register/login (email+password), Google OAuth token
  verification, JWT access + refresh tokens, `argon2` password hashing.
- **Users module** — `GET/PATCH /users/me`.
- **Listings module** — full CRUD, DTO-level validation (including the price
  and image-count rules that used to live only in a `toast.error`), cursor
  pagination, and a PostGIS-backed `near=lat,lng&radiusKm=` search.
- **Uploads module** — presigned S3-compatible upload URLs (browser uploads
  directly, same shape as the current `uploadBytesResumable` flow) plus
  server-side thumbnail generation on confirm.
- **Messages module** — replaces the `mailto:` contact link with real,
  persisted threads.
- **`ListingOwnerGuard`** — the real version of the frontend's client-side
  `listing.userRef !== auth.currentUser.uid` check.
- `prisma/schema.prisma` — the full data model, including the fix for the
  `bedroom`/`bedrooms` field-name drift that exists in the current Firestore
  data (see Architecture doc §1).
- Docker Compose for Postgres (with the PostGIS extension), Redis, and MinIO
  (a local S3-compatible store, so you don't need real AWS credentials to run
  this locally).

## Running it locally

```bash
cp .env.example .env          # then fill in real secrets
docker compose up -d          # postgres (+ postgis), redis, minio
npm install
npm run prisma:migrate        # creates the database schema
npm run start:dev             # http://localhost:3333
```

MinIO's console is at `http://localhost:9001` (login: `gidalisting` /
`gidalisting123`) — create a bucket named `gidalisting-listings` (or whatever
you set `S3_BUCKET` to) before testing the upload flow.

## Testing

```bash
npm run test        # unit tests
npm run test:e2e     # e2e tests — point DATABASE_URL at a throwaway database first
```

## Not included yet

These need decisions only the project owner can make, so they're deliberately
left as follow-ups rather than guessed at:

- Real object-storage credentials (AWS S3 / Cloudflare R2) for anything past
  local development with MinIO.
- An email provider (SendGrid/Postmark/SES) to actually send the
  `forgot-password` reset email — the endpoint exists in the architecture doc
  but isn't wired to a sender in this scaffold.
- The Firestore → Postgres backfill script (needs a live export of your
  existing `users`/`listings` collections).
- The frontend's `src/api/*` client layer that swaps each page's
  `firebase/firestore` calls for calls to this API — see migration step 3 in
  the architecture doc.
