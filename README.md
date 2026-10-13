# Sentinel AI — Beneficial Ownership & Perpetual KYC

Sentinel AI resolves complex multi-layered corporate beneficial-ownership structures (based on the **Beneficial Ownership Data Standard v0.4**), surfaces arithmetic provenance for every effective ownership percentage or band, highlights opacity gaps and circular loops, monitors onboarded structures continuously for material changes, and evaluates regulatory materiality deterministically.

---

## 1. Architecture Overview (Phases 1, 2 & 3)

Sentinel AI is structured as a full-stack high-assurance application:

- **Express Full-Stack Server (`server.ts`)**:
  - Hosts secure server routes (`/api/auth/verify-role`, `/api/governance/set-mode`, `/api/materiality/explain`, `/api/events/registry`).
  - Verifies Firebase ID tokens using the Firebase Admin SDK `verifyIdToken()` with fail-closed semantics (no sandbox bypasses).
  - Connects to the named Firestore database provisioned in `firebase-applet-config.json`.
  - Mounts Vite dev middleware in development mode and serves compiled assets in production.
- **Frontend SPA & Design System (`DESIGN.md`, `src/index.css`)**:
  - Implements the complete design specification: fixed 56px Topbar, 44px Flow Strip, 62px Icon Rail, and responsive main viewport.
  - Complete animation library (`anim-vin`, `anim-nodein`, `anim-edgeDraw`, `anim-drop`, `anim-mpulse`, `anim-spin`) respecting `prefers-reduced-motion`.
  - Typography: `Sora` for brand and headers, `Inter` for body UI, `JetBrains Mono` for IDs, percentages, and metrics.
- **Firebase Authentication & Cloud Firestore**:
  - Google Sign-In through Firebase Auth exclusively (no password accounts).
  - Unauthenticated users land on the dedicated Sentinel AI Sign-In card.
  - Firestore security rules enforce role-based access control (RBAC), immutability of audit records, and client restrictions.
- **Deterministic Resolution & Materiality Engines (`src/engine/uboEngine.ts`, `src/engine/materialityEngine.ts`)**:
  - Walks multi-tiered holding chains from the reporting root entity upward to natural persons.
  - Handles exact percentages and percentage bands `[min, max]`, cycle breaking, dissolved entities, and disclosure opacity gaps.
  - Evaluates changes against statutory thresholds (e.g., UK Money Laundering Regulations 2017 `> 25%`, India Companies SBO Rules 2018 `> 10%`).
  - Flags sanctions designations (`CRITICAL`), PEP stake movements (`MATERIAL`), and classification transitions.
- **AI Explanation Helper (`/api/materiality/explain`)**:
  - Generates 2–3 sentence regulatory rationale using the Gemini model fallback ladder (`gemini-2.5-flash` → `gemini-1.5-flash`).
  - Strips delimiter tokens from dynamic untrusted inputs.
  - Times out after 6 seconds, gracefully falling back to deterministic statutory explanation templates.

---

## 2. Preview vs. Production Modes

Sentinel AI supports two deployment configurations via the `APP_MODE` environment variable:

- **`APP_MODE=PREVIEW` (Default)**:
  - Topbar mode pill indicates `"Preview · simulated feeds"`.
  - Utilizes fixture-backed sanctions adapter and local event feed simulator.
  - Allows supervisors to inject demonstration registry changes via the UI (`"Inject registry change"`).
- **`APP_MODE=PRODUCTION`**:
  - Topbar mode pill indicates `"Production · live feeds"`.
  - Connects to Google Cloud APIs: Cloud Pub/Sub push subscriber, BigQuery OpenSanctions dataset, and Vertex AI.
  - Enforces OIDC bearer token verification on `/api/events/registry` matching `PUBSUB_PUSH_SA`.
  - **Fails closed at startup** if any required configuration, credential, or service account is missing.

---

## 3. Firebase Setup & Firestore Security Rules

### 3.1 Provisioning
Firebase Authentication (Google Sign-In) and a named Cloud Firestore database are configured using AI Studio tools and recorded in `firebase-applet-config.json`:
- **Project ID**: `untangle-7`
- **Firestore Database ID**: `ai-studio-sentinelai-1a66e7cb-9c43-4e20-98b7-cd3f760ce19a`

### 3.2 Firestore Collections & Schemas
- `users/{uid}`: User profile storing `role` (`"analyst"` or `"supervisor"`) and `governanceMode` (`"human-in-the-loop"` or `"automated"`).
  - Readable by document owner only (`isOwner(uid)`).
  - Created by owner with default role `"analyst"`. Role field can never be altered by client write.
- `audit/{auditId}`: Append-only audit trail capturing every compliance determination and analyst action.
  - Any authenticated user may read and create.
  - Create requires `actorUid == request.auth.uid`, valid `actorType` (`HUMAN`, `SYSTEM`, `AI`), action string, and server timestamp.
  - **Update and delete are strictly denied for all callers**.
- `customers/{customerId}`: Onboarded corporate entities.
  - Any authenticated user may read.
  - Create requires `onboardedBy == request.auth.uid` and status `"onboarded"`.
  - Update allowed only for `status`. Delete is denied.
- `events/{eventId}`: Monitored registry change events.
  - Authenticated users may read.
  - Supervisors may create (for simulation injection); production events are ingested via the server push route.
  - Update allowed only when `resource.data.status == 'pending'`, updating `status` (`accepted`, `monitoring`, `dismissed`), `decidedBy`, and `decidedAt`. Dismissals mandate a non-empty `dismissReason`.

---

## 4. Required Google Cloud APIs & IAM Roles (Production)

### 4.1 Required APIs
Enable the following APIs in the Google Cloud Console:
- Cloud Firestore API (`firestore.googleapis.com`)
- Firebase Authentication API (`identitytoolkit.googleapis.com`)
- Cloud Pub/Sub API (`pubsub.googleapis.com`)
- BigQuery API (`bigquery.googleapis.com`)
- Vertex AI API (`aiplatform.googleapis.com`)
- Secret Manager API (`secretmanager.googleapis.com`)

### 4.2 IAM Roles per Service Account
- **Application Runtime Service Account** (`sentinel-app-sa@<project-id>.iam.gserviceaccount.com`):
  - `roles/datastore.user` (Cloud Datastore / Firestore User)
  - `roles/aiplatform.user` (Vertex AI User)
  - `roles/pubsub.subscriber` (Pub/Sub Subscriber)
  - `roles/bigquery.dataViewer` (BigQuery Data Viewer)
  - `roles/bigquery.jobUser` (BigQuery Job User)
  - `roles/secretmanager.secretAccessor` (Secret Manager Secret Accessor)
- **Pub/Sub Push Subscription Service Account** (`sentinel-pubsub-invoker@<project-id>.iam.gserviceaccount.com`):
  - `roles/run.invoker` (Cloud Run Invoker)

---

## 5. Environment Variables

Define the following environment variables in `.env` (refer to `.env.example`):

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `APP_MODE` | Application operating mode (`PREVIEW` or `PRODUCTION`) | `PREVIEW` |
| `PORT` | Local web server listening port | `3000` |
| `HOST` | Local web server listening host | `0.0.0.0` |
| `GEMINI_API_KEY` | Server-side API key for Google Gemini model fallback ladder | *Required for live AI summaries* |
| `PUBSUB_PUSH_AUDIENCE` | Expected audience for Pub/Sub push OIDC token verification | `https://your-service.run.app/api/events/registry` |
| `PUBSUB_PUSH_SA` | Authorized Pub/Sub invoker service account email | `sentinel-pubsub-invoker@<project-id>.iam.gserviceaccount.com` |

---

## 6. Deployment & Verification

### Build & Run
```bash
# 1. Install dependencies
npm install

# 2. Run unit tests for deterministic UBO resolution and materiality engines
npx tsx src/engine/uboEngine.test.ts
npx tsx src/engine/materialityEngine.test.ts

# 3. Compile client assets
npm run build

# 4. Start production server
npm run start
```

### Deploying Firestore Security Rules
Firestore security rules are maintained in `/firestore.rules` and deployed to the named database using the `deploy_firebase` tool or Firebase CLI:
```bash
firebase deploy --only firestore:rules
```

---

## 7. Synthetic Data Integrity & OpenSanctions Attribution

- **100% Synthetic Individuals**: Every natural person in this application is fictional, created with `synthetic: true`. No real living individuals are referenced or depicted as beneficial owners, directors, PEPs, or adverse media subjects.
- **OpenSanctions Legal Entity Attribution**: Real data appears exclusively as official sanctions designations of legal entities sourced from [OpenSanctions](https://www.opensanctions.org/) under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0).
  - **Featured Designated Entity**: Russian international maritime shipping enterprise **Sovcomflot** (OpenSanctions Entity ID: `NK-VDEKGF5ZgHAkye4kGuUXs3`), designated under US OFAC, UK HM Treasury, EU, and Australian sanctions regimes.
