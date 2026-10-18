# Sentinel AI — Beneficial Ownership & Perpetual KYC

Sentinel AI resolves complex multi-layered corporate beneficial-ownership structures (based on the **Beneficial Ownership Data Standard v0.4**), surfaces arithmetic provenance for every effective ownership percentage or band, highlights opacity gaps and circular loops, monitors onboarded structures continuously for material changes, and evaluates regulatory materiality deterministically.

---

## 1. System Architecture Diagram

```
                           +-------------------------------------------------------------+
                           |                     Browser Client SPA                      |
                           |  - Visual Ownership Tree (D3 / SVG Hierarchy & Provenance)  |
                           |  - Perpetual KYC Alerts & Case Docket Management            |
                           |  - Adverse Media Grounded Q&A & Document Upload Intake      |
                           +------------------------------+------------------------------+
                                                          |
                                          Firebase ID Token (Bearer)
                                          & Strict TLS / HTTPS
                                                          v
+-------------------------------------------------------------------------------------------------------+
|                                    Cloud Run Full-Stack Express Server                                |
|                                                                                                       |
|  [Middleware: Security & Input Validation]                                                            |
|  - Body Parsers (15MB limit) | Magic Byte Signature Check (%PDF-, PNG, JPEG)                         |
|  - Fail-Closed Auth Middleware (Firebase Admin SDK verifyIdToken, derives UID only)                   |
|  - Startup Validator (requires all 9 cloud environment variables in PRODUCTION mode)                  |
|                                                                                                       |
|  [API Routes]                                                                                         |
|  - POST /api/auth/verify-role     -> Fetches/initializes user profile in named Firestore              |
|  - POST /api/auth/switch-role     -> Switches analyst/supervisor role and writes audit log            |
|  - POST /api/governance/set-mode  -> Sets human-in-the-loop vs automated (supervisor-only)            |
|  - POST /api/events/registry      -> Push endpoint (verifies OIDC token: audience + SA email)         |
|  - POST /api/events/publish       -> Publishes registry change events to Google Cloud Pub/Sub         |
|  - POST /api/sanctions/lookup     -> Parameterised query to BigQuery OpenSanctions table              |
|  - POST /api/materiality/explain  -> Gemini fallback ladder / Vertex AI (never decides, only explains)|
|  - POST /api/adverse-media/qa     -> Dossier Q&A (rate-limited 20/10m, citation verification)         |
|  - POST /api/adverse-media/extract-> Batch adverse media extraction with server-side caching          |
|  - POST /api/documents/extract    -> Uploads to GCS & invokes Document AI Form Parser                 |
|  - POST /api/documents/confirm    -> Confirms shareholder rows, updates graph & audit trail           |
|  - GET  /api/system/mode          -> Exposes active mode (Preview/Production) and live integrations   |
|  - GET  /api/health               -> Health check endpoint                                            |
+------------+--------------------+---------------------+--------------------+--------------------+---+
             |                    |                     |                    |                    |
             v                    v                     v                    v                    v
      +--------------+     +---------------+     +--------------+     +--------------+     +--------------+
      |  Cloud Run   |     | Cloud Storage |     | Google Cloud |     | Google Cloud |     |    Vertex    |
      | Runtime SA   |     | (Evidence)    |     | Document AI  |     | BigQuery     |     |   AI SDK     |
      |   (ADC)      |     |               |     | (Form Parser)|     | (Sanctions)  |     | (Gemini)     |
      +-------+------+     +-------+-------+     +-------+------+     +-------+------+     +-------+------+
              |                    |                     |                    |                    |
              | Upload Evidence    | Read/Write          | Structured OCR     | Parameterised SQL  | Multi-Model  |
              | & Firestore Admin  | gs://bucket/        | Form Extraction    | Named Parameters   | Fallback     |
              v                    v                     v                    v                    v
+--------------------+----------------------------------------------------------------------------------+
| Named Cloud Firestore Database: ai-studio-sentinelai-1a66e7cb-9c43-4e20-98b7-cd3f760ce19a            |
| Collections: users | audit (create-only) | customers | events | screeningRuns | cases | documentExtractions |
| Security Rules: Deny-by-default, four-eyes gate on CRITICAL cases, supervisor-only role protection    |
+-------------------------------------------------------------------------------------------------------+
```

---

## 2. Preview vs. Production Modes

Sentinel AI supports two deployment configurations controlled strictly by the `APP_MODE` environment variable (evaluated case-insensitively):

### `APP_MODE=preview` (Default)
- **Topbar Mode Pill**: Displays `"Preview · simulated feeds"` with an amber indicator light.
- **Event Feed**: Uses direct Firestore writes (`_simulation: true`) for testing; supervisors can trigger synthetic registry changes via the UI (`"Inject registry change"`).
- **Sanctions Lookup**: Uses official fixture data for designated entities (Sovcomflot `NK-VDEKGF5ZgHAkye4kGuUXs3`, CC BY-NC 4.0).
- **Document Processing**: Uses preview Gemini extractor with mock confidence thresholds.
- **Pub/Sub Push Endpoint**: Disabled (returns HTTP 404 to prevent untrusted calls).

### `APP_MODE=production`
- **Topbar Mode Pill**: Displays `"Production"` with a green indicator light. Hovering shows a comprehensive tooltip listing all active live cloud integrations.
- **Startup Validation**: Stops the server immediately (`process.exit(1)`) if any of the 9 required cloud integration environment variables are missing, logging only variable names (no credentials or personal data).
- **Cloud Pub/Sub Push Endpoint (`POST /api/events/registry`)**:
  - Requires Google Cloud OIDC Bearer token in the `Authorization` header.
  - Verifies token signature, audience (`PUBSUB_PUSH_AUDIENCE`), service account email (`PUBSUB_PUSH_SA`), and `email_verified === true`.
  - Decodes base64-encoded `message.data` payload.
  - Fails closed on any authentication or decoding error.
- **Pub/Sub Publish (`POST /api/events/publish`)**: Publishes messages to the live Google Cloud Pub/Sub topic via runtime service account.
- **BigQuery Sanctions Search**: Queries the live BigQuery sanctions table (`BQ_SANCTIONS_TABLE`) using strictly parameterised queries (`@cleanName`) to prevent SQL injection.
- **Document AI & Cloud Storage**:
  - Validates binary magic bytes (`%PDF-`, `\x89PNG`, `\xFF\xD8\xFF`).
  - Stores uploaded documents in the private Cloud Storage evidence bucket (`EVIDENCE_BUCKET`).
  - Invokes Google Cloud Document AI Form Parser (`DOCAI_PROCESSOR_ID` in `DOCAI_LOCATION`).
  - Fails closed if any cloud call fails; never falls back to simulated data.
- **Vertex AI (Gemini Flash)**:
  - When `GOOGLE_GENAI_USE_VERTEXAI=true`, uses the `@google/genai` TypeScript SDK on Vertex AI with Application Default Credentials (ADC) from the Cloud Run runtime service account (no API key).
  - Employs a multi-model fallback ladder on Vertex AI (`gemini-2.5-flash` -> `gemini-2.0-flash` -> `gemini-1.5-flash` -> `gemini-2.5-flash-lite` -> `gemini-2.0-flash-lite`).
  - Fails closed on downstream errors; never simulates AI findings.

---

## 3. Firebase Setup & Firestore Security Rules

### 3.1 Provisioning
Firebase Authentication (Google Sign-In) and a dedicated named Cloud Firestore database are provisioned and recorded in `firebase-applet-config.json`:
- **Project ID**: `sentinel-ai-511412`
- **Named Firestore Database ID**: `ai-studio-sentinelai-1a66e7cb-9c43-4e20-98b7-cd3f760ce19a`

All server-side Firestore operations use the Firebase Admin SDK explicitly bound to the named database:
```ts
export function getAdminDb() {
  return getFirestore('ai-studio-sentinelai-1a66e7cb-9c43-4e20-98b7-cd3f760ce19a');
}
```

### 3.2 Firestore Collections & Schemas
- `users/{uid}`: User profile storing `role` (`"analyst"` or `"supervisor"`) and `governanceMode` (`"human-in-the-loop"` or `"automated"`).
  - Readable only by document owner (`isOwner(uid)`).
  - Created by owner with default role `"analyst"`. Role field can never be altered by client writes.
- `audit/{auditId}`: Append-only audit trail capturing every compliance determination and analyst action.
  - Any authenticated user may read and create.
  - Create requires `actorUid == request.auth.uid`, valid `actorType` (`HUMAN`, `SYSTEM`, `AI`), action string, and server timestamp (`request.time`).
  - **Update and delete are strictly denied for all callers**.
- `customers/{customerId}`: Onboarded corporate entities.
  - Any authenticated user may read.
  - Create requires `onboardedBy == request.auth.uid` and status `"onboarded"`.
  - Update allowed only for `status`. Delete is denied.
- `events/{eventId}`: Monitored registry change events.
  - Authenticated users may read.
  - Created in preview mode by supervisors; created in production mode exclusively by server Admin SDK via verified Pub/Sub push.
  - Update allowed only when `resource.data.status == 'pending'`, updating `status` (`accepted`, `monitoring`, `dismissed`), `decidedBy`, and `decidedAt`. Dismissals mandate a non-empty `dismissReason`.
- `screeningRuns/{runId}`: Asynchronous due-diligence screening executions across Sanctions, PEP, Adverse Media, and Ownership Integrity agents.
  - Readable by authenticated users; created and updated by the initiating analyst.
- `cases/{caseId}`: Compliance case docket records for PKYC and onboarding.
  - Created by the initiating analyst with status `open`.
  - **Four-Eyes Closure Gate**: Critical cases (`overallStatus == 'CRITICAL'`) can only be closed by a supervisor (`isSupervisor()`), and **never by the same user who initiated it** (`request.auth.uid != resource.data.analystUid`).
- `documentExtractions/{extractionId}`: Staged client evidence and shareholder extracts.
  - Created and updated strictly by the requesting analyst; deletion is prohibited.
  - Records request metadata, file signature validation, extracted rows, field confidences, and confirmed rows.

---

## 4. Required Google Cloud APIs & IAM Roles (Production)

### 4.1 Required Google Cloud APIs
Enable the following APIs in the Google Cloud project (`sentinel-ai-511412`):
```bash
gcloud services enable \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  pubsub.googleapis.com \
  bigquery.googleapis.com \
  aiplatform.googleapis.com \
  documentai.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  run.googleapis.com
```

### 4.2 IAM Roles per Service Account

#### 1. Application Runtime Service Account
Runs the Cloud Run container (`sentinel-app-sa@sentinel-ai-511412.iam.gserviceaccount.com`):
| IAM Role | Purpose |
| :--- | :--- |
| `roles/datastore.user` | Read/write access to Cloud Firestore (named database) |
| `roles/aiplatform.user` | Invoke Vertex AI Gemini Flash models without API keys |
| `roles/pubsub.publisher` | Publish registry change events to Google Cloud Pub/Sub topic |
| `roles/bigquery.dataViewer` | Read access to OpenSanctions BigQuery dataset |
| `roles/bigquery.jobUser` | Execute parameterised queries against BigQuery |
| `roles/documentai.apiUser` | Invoke Document AI Form Parser processor |
| `roles/storage.objectAdmin` | Upload and retrieve client evidence PDFs in Cloud Storage bucket |
| `roles/secretmanager.secretAccessor` | Access any runtime secrets from Secret Manager |

#### 2. Pub/Sub Push Subscription Service Account
Invokes the authenticated Cloud Run push endpoint (`sentinel-pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com`):
| IAM Role | Purpose |
| :--- | :--- |
| `roles/run.invoker` | Allows Cloud Pub/Sub push subscription to authenticate and invoke `/api/events/registry` |

---

## 5. Environment Variables Reference

| Variable | Required in Prod | Description | Example / Default |
| :--- | :---: | :--- | :--- |
| `APP_MODE` | Yes | Application operating mode (`preview` or `production`) | `production` |
| `GOOGLE_CLOUD_PROJECT` | Yes | Google Cloud Project ID | `sentinel-ai-511412` |
| `GOOGLE_CLOUD_LOCATION` | Yes | Google Cloud Region for Vertex AI & Cloud Run | `us-central1` |
| `GOOGLE_GENAI_USE_VERTEXAI` | Yes (for Vertex) | Enables Vertex AI ADC client (no API key required) | `true` |
| `GEMINI_API_KEY` | Preview Only | Developer API key (used when Vertex AI is disabled) | `AIzaSy...` |
| `PUBSUB_TOPIC` | Yes | Google Cloud Pub/Sub topic for publishing events | `projects/sentinel-ai-511412/topics/registry-events` |
| `PUBSUB_PUSH_SA` | Yes | Expected service account email on Pub/Sub OIDC tokens | `sentinel-pubsub-invoker@sentinel-ai-511412.iam.gserviceaccount.com` |
| `PUBSUB_PUSH_AUDIENCE` | Yes | Expected audience claim on Pub/Sub OIDC tokens | `https://your-service.run.app/api/events/registry` |
| `BQ_SANCTIONS_TABLE` | Yes | Fully qualified BigQuery OpenSanctions table ID | `sentinel-ai-511412.compliance.opensanctions_entities` |
| `DOCAI_LOCATION` | Yes | Cloud Document AI processor location | `us` or `eu` |
| `DOCAI_PROCESSOR_ID` | Yes | Document AI Form Parser processor ID | `1234abcd5678efgh` |
| `EVIDENCE_BUCKET` | Yes | Private Cloud Storage bucket for document evidence | `sentinel-compliance-evidence-vault` |

> [!IMPORTANT]
> **Cloud Run Republishing Notice**: In AI Studio and Cloud Run, republishing the application creates a new deployment revision that may reset environment variables to defaults. When republishing in production, always ensure that `APP_MODE=production` and all required cloud integration variables are configured in Cloud Run service settings.

---

## 6. Build, Testing & Deployment

### 6.1 Running the Automated Test Suite
```bash
# Run all 50 deterministic engine and adapter tests:
npm test

# Run individual test modules:
npx tsx src/engine/uboEngine.test.ts
npx tsx src/engine/materialityEngine.test.ts
npx tsx --test src/engine/screeningAgents.test.ts
npx tsx --test src/adapters/documentAiAdapter.test.ts
npx tsx --test src/server/pubsubHandler.test.ts
```

### 6.2 Compilation & Linting
```bash
npm run lint    # tsc --noEmit
npm run build   # vite build
```

### 6.3 Deploying Firestore Security Rules
```bash
firebase deploy --only firestore:rules
```

---

## 7. Complete Production Test Walkthrough

Follow this step-by-step verification plan to confirm end-to-end functionality in a live production environment:

### Step 1: Startup Validation & Mode Pill Verification
1. Start the server with `APP_MODE=production` and unset any required variable (e.g. `unset BQ_SANCTIONS_TABLE`).
   - **Verification**: The process exits immediately with code 1 and logs: `[Server] Production startup validation failed. Missing required environment variables: BQ_SANCTIONS_TABLE`.
2. Configure all 9 environment variables and start the server.
   - **Verification**: The server logs: `[Sentinel AI] Operating mode: PRODUCTION` and starts cleanly on port 3000.
3. Open the web application.
   - **Verification**: The topbar mode pill displays **Production** with a pulsing green indicator. Hovering over the pill displays the active live cloud integrations tooltip.

### Step 2: Pub/Sub Registry Push Ingestion
1. Send a simulated Cloud Pub/Sub push notification with a valid Google OIDC Bearer token to `POST /api/events/registry`:
   ```bash
   curl -X POST https://<cloud-run-url>/api/events/registry \
     -H "Authorization: Bearer <ID_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"message":{"data":"eyJpZCI6ImV2dC1wcm9kLTAxIiwiY3VzdG9tZXJJZCI6IkNVUy0yMDI2LTAwMDEiLCJncm91cElkIjoiZ3JwLTAxLWF1cmVsaWEiLCJjaGFuZ2VUeXBlIjoiU0hBUkVfQ0hBTkdFIiwidGVtcGxhdGVJZCI6InRtcC0wMSJ9"}}'
   ```
   - **Verification**: Endpoint returns `200 OK {"status":"received","eventId":"evt-prod-01"}`. The event appears under the **Alerts** docket.
2. Attempt sending a request without a token or with an invalid audience.
   - **Verification**: Returns `401 Unauthorized`.

### Step 3: BigQuery Parameterised Sanctions Query
1. Trigger a KYC screening run on an entity named `"Sovcomflot"`.
   - **Verification**: The server executes a parameterised SQL query against `BQ_SANCTIONS_TABLE`. The result is matched deterministically as an official sanctions `HIT` with OpenSanctions attribution and URL.
2. Verify that searching for special punctuation or SQL keywords (e.g. `' OR 1=1 --`) does not trigger SQL injection; queries remain strictly parameterised.

### Step 4: Document AI & Cloud Storage Evidence Intake
1. Navigate to Group 5 (*Obsidian Wharf Properties Ltd*) and select the Nominee Gap card.
2. Click **Request documents** and upload a valid shareholder register PDF.
   - **Verification**:
     - Binary header validation verifies `%PDF-`.
     - File is uploaded to `gs://${EVIDENCE_BUCKET}/evidence/EXT-PROD-*.pdf`.
     - Google Cloud Document AI Form Parser extracts shareholder names, share percentages, and classes.
     - Extracted rows appear in the UI review table with confidence badges.
3. Edit Arthur Kensington Pryce's holding to 65% Ordinary Shares and click **Confirm & Apply to Graph**.
   - **Verification**: The opacity gap is resolved, the completeness score increases deterministically, and an immutable audit record is committed to Firestore.

### Step 5: Vertex AI Grounded Q&A & Materiality Explanations
1. Open the node drawer for Kaelen Vance Morozov and open the **Adverse media dossier**.
2. Ask: *"Has any court convicted this person?"*
   - **Verification**: Vertex AI generates a response citing specific articles with `[cite:ARTICLE_ID]` tags. Clicking the citation tag opens the exact source article modal with the quoted passage highlighted.
3. Verify that submitting 21 questions within 10 minutes returns `429 Too Many Requests` (per-analyst rate limiting).

### Step 6: Four-Eyes Principle Enforcement
1. As Analyst A, accept a critical sanctions alert and initiate a `CRITICAL` compliance case (`overallStatus == 'CRITICAL'`).
2. Attempt to close the case as Analyst A:
   - **Verification**: The UI displays a four-eyes warning and disables the close button. If an update is attempted directly against Firestore, security rules reject the write (`request.auth.uid != resource.data.analystUid`).
3. Log in as Supervisor B (a different user with `role: supervisor`), enter a resolution note (at least 5 characters), and close the case.
   - **Verification**: Case transitions to `closed`, recording `closedBy: Supervisor_B_UID` and an immutable audit entry in `audit/{id}`.

---

## 8. OpenSanctions Attribution & Synthetic Data Integrity

- **100% Synthetic Natural Persons**: All individuals in this application are completely fictional, marked `synthetic: true`. No living person is depicted as an owner, director, PEP, or subject of adverse media.
- **Official Sanctions Data Attribution**: Legal entity sanctions data is sourced directly from [OpenSanctions](https://www.opensanctions.org/) under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0).
  - Featured entity: **Sovcomflot** (OpenSanctions ID: `NK-VDEKGF5ZgHAkye4kGuUXs3`).
