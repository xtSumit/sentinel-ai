# Sentinel AI — Production Threat Model & Security Architecture

**Application**: Sentinel AI — Beneficial Ownership & Perpetual KYC  
**Scope**: Phases 1, 2, and 3 (Beneficial Ownership Resolution, Firebase Auth & RBAC, Firestore Audit Ledger, Perpetual Monitoring & Pub/Sub Ingestion, Deterministic Materiality Verdicts, and AI Explanations)  
**Standard**: Conforms to Custom Instructions §1 (Threat Modeling), §2 (Secure Coding & OWASP Top 10 / LLM Top 10), §3 (Firebase Auth & Firestore), §4 (Secrets), §8 (Deterministic Decisions), §9 (Audit Trail), §10 (Data Handling), and §11 (Preview vs. Production Adapters).

---

## 1. Executive Summary & Security Perimeter

Sentinel AI is a high-assurance regulatory compliance application designed for bank compliance analysts and supervisors. Its primary purpose is to autonomously resolve complex multi-tiered corporate beneficial-ownership structures, audit changes, match entities against designated sanctions lists (OpenSanctions), and evaluate the regulatory materiality of corporate registry modifications.

### Security Guiding Principles
1. **Deterministic Decisions, AI Explanations**: Regulated determinations (UBO status, threshold breaches, materiality verdicts, sanctions matching) are strictly rule-based and executed deterministically. AI models never make compliance decisions; they only provide structured plain-English rationale from sanitized facts.
2. **Fail-Closed Security**: All API boundaries, authentication checks, and external adapter gateways fail closed. Unauthenticated requests are rejected immediately; missing production configurations halt system startup.
3. **Immutability of Audit Records**: Audit trails are append-only. Neither analysts nor supervisors can modify or delete audit log entries.
4. **Data vs. Instruction Segregation**: Entity names, documents, articles, and external payloads are treated strictly as untrusted data, never instructions. Delimiters are stripped before input into LLM prompts.
5. **Zero Personal Data Exposure**: Synthetic personas are marked `synthetic: true`. No living persons are generated or referenced. PII is never logged to system logs or server consoles.

---

## 2. Comprehensive Threat Summary Table (5 Zones)

| Zone | Threat ID | Threat Description | Attack Vector / Impact | Countermeasures & Enforcement |
| :--- | :--- | :--- | :--- | :--- |
| **Zone 1: Input Surfaces** | `INP-01` | **Malicious Entity Intake & Injection** | Attacker injects script tags, prompt injection tokens, or malformed characters into legal entity name or customer ID input fields. | Strict schema validation (`size <= 200`, regex checking), HTML sanitization, input normalization (`normaliseEntityName`), and parameterization across all storage and query layers. |
| | `INP-02` | **Spoofed Pub/Sub Registry Events** | Malicious external actor posts forged corporate registry change events to `/api/events/registry`. | In `PRODUCTION`, endpoint enforces strict Google OIDC ID token validation via `OAuth2Client.verifyIdToken()`, matching the expected service account email (`PUBSUB_PUSH_SA`) and audience. Schema validation enforces required BODS event keys and rejects malformed events (HTTP 400). |
| | `INP-03` | **Duplicate or Conflicting Customer Onboarding** | Concurrent onboarding attempts for an already-mapped corporate group creating fragmented risk profiles. | Firestore query checks existing `groupKey` in `customers` collection. Re-initiating an onboarded group immediately resolves and opens the existing customer profile without duplicate creation. |
| | `INP-04` | **Malicious Document Intake & Exploit Payloads** | Attacker uploads executables, polyglot PDFs, or oversized files to corrupt extraction memory or execute SSRF. | Strict MIME-type validation (`application/pdf`, `text/plain`, `text/markdown`, `image/png`, `image/jpeg`), 10MB file size ceiling, client & server payload sanitization, sandboxed parser execution, and isolated preview adapter handling. |
| **Zone 2: Planning & Reasoning** | `LLM-01` | **Indirect Prompt Injection** | Corporate entity name, registry note, or media excerpt contains prompt injection payloads attempting to override model system prompts. | Delimiter-like tokens (`` ` ``, `'`, `"`, `{`, `}`, `<`, `>`, `\r`, `\n`) are stripped from dynamic fields. All facts are passed in structured JSON blocks with explicit labels (`FACTS:` vs `TASK:`). |
| | `LLM-02` | **Hallucinated or Non-Deterministic Regulatory Verdicts** | Model produces non-deterministic determinations, altering UBO classification, sanctions status, or risk rating across runs. | Regulated determinations are strictly calculated by pure deterministic TypeScript engines (`uboEngine.ts`, `materialityEngine.ts`, `sanctionsAgent.ts`, `adverseMediaScoring.ts`). AI is restricted to generating 2–3 sentence explanatory summaries after deterministic calculation. |
| | `LLM-03` | **LLM Latency & Denial of Service** | Upstream model hangs, times out, or exhausts quotas during analyst workflow. | Resilient fallback ladder (`gemini-3.8-flash` → `gemini-flash-latest` → `gemini-3.1-flash-lite`), 6-second hard timeout via `Promise.race()`, and instant graceful fallback to deterministic statutory explanation templates. |
| | `LLM-04` | **Fabricated Q&A Citations & Grounding Bypass** | Model hallucinates facts not present in provided adverse media articles, or generates fictitious article IDs. | System instruction strictly mandates `[cite:ARTICLE_ID]` tags. Server parses citations and cross-checks them against the exact subset of article IDs provided. If any citation is invalid or absent, response defaults closed: "The available articles don't cover this." |
| | `LLM-05` | **Allegations Conflated with Convictions** | Model presents preliminary charges or unsubstantiated allegations as established findings. | Fact extraction isolates `legalStage` enum (`allegation`, `investigation`, `charge`, `regulatory finding`, `conviction`, `cleared`). If latest finding on a matter is `cleared`, the scoring engine assigns a score of 0. |
| **Zone 3: Tool Execution & APIs** | `SEC-01` | **Privilege Escalation via Client Requests** | Analyst user attempts to toggle system to `Automated` governance mode or alter role in `users/{uid}`. | Role is derived exclusively from server-side verified Firebase ID tokens and Admin SDK database lookups. Firestore rules prohibit clients from modifying `users/{uid}.role`. `/api/governance/set-mode` verifies `role == 'supervisor'` before updating. |
| | `SEC-02` | **SSRF & External Dependency Exploitation** | Exploitation of external network calls in adapters to target cloud metadata or internal services. | All external Google Cloud integrations (Vertex AI, Pub/Sub, BigQuery, Document AI) operate behind strongly-typed adapter interfaces. Outgoing calls use authenticated Google client SDKs with fixed endpoints. |
| | `SEC-03` | **Unauthorized Firestore Event Updates** | Unauthorized user manipulates event status, tampering with compliance queue. | Firestore security rules enforce: events can only be updated from status `pending`, only `status`, `decidedBy`, `decidedAt`, `dismissReason` can be modified, `decidedBy` must match `request.auth.uid`, and `dismissReason` is mandatory for dismissals. |
| | `SEC-04` | **Adverse Media Q&A Endpoint Exhaustion** | Attacker floods `/api/adverse-media/qa` with rapid queries to deplete model tokens or trigger DoS. | Per-user rate limiting enforced on server (sliding window of 20 requests per 10 minutes per verified `uid`). Question character count capped at 500 characters. Returns HTTP 429 upon threshold breach. |
| | `SEC-05` | **Four-Eyes Case Bypass** | Single analyst attempts to close high-risk or critical compliance cases unilaterally. | Firestore security rules enforce Four-Eyes principle on `cases/{caseId}`: CRITICAL cases can only be closed by users with role `supervisor`, and the closer's `uid` must strictly differ from the `analystUid` who created the case. |
| | `SEC-06` | **Unauthorized Graph Mutation via Ingestion** | Malicious actor injects phantom entities or circular loops into live ownership graph via unverified document uploads. | Extracted document ownership facts enter a staging reconciliation state (`documentExtractions/{extractionId}`). Graph updates require explicit analyst reconciliation and commit action, generating full immutable audit records. |
| **Zone 4: Memory & State** | `MEM-01` | **Tampering with Audit Records** | Malicious or compromised user attempts to edit or delete historical audit entries to conceal unauthorized actions. | Firestore security rules explicitly restrict `audit/{auditId}`: `allow update: if false; allow delete: if false;`. Creation requires `actorUid == request.auth.uid`, valid `actorType` (`HUMAN`, `SYSTEM`, `AI`), and server timestamp. |
| | `MEM-02` | **Cross-User Profile Leakage** | Analyst user attempts to read other analysts' profile documents or session state. | Firestore rules enforce `isOwner(uid)` on `users/{uid}`: `allow get: if isOwner(uid); allow list: if false;`. No client can list user records. |
| | `MEM-03` | **PII & Credential Logging** | Sensitive customer data, questions, or API keys leak into stdout, server logs, or monitoring traces. | Custom logging rules enforce zero PII logging: only opaque entity/document IDs and status codes are logged. Passwords, prompt contents, and API keys are banned from console output. |
| | `MEM-04` | **Tampering with Screening Runs** | Attacker modifies historical screening outputs in Firestore. | Firestore rules on `screeningRuns/{runId}` enforce create and update restricted to `startedBy == request.auth.uid`, deny deletes, and validate immutable run identifiers. |
| **Zone 5: Inter-System Comms** | `COM-01` | **Token & Credential Leakage** | Gemini API keys or service account keys exposed in client bundles or client-side storage. | No server keys are exposed to the browser. Gemini calls are proxied exclusively through server routes (`/api/materiality/explain`, `/api/adverse-media/qa`, `/api/documents/extract`). Client Firebase config contains only public project identifiers. |
| | `COM-02` | **Fail-Open Adapter Fallback in Production** | System silently falls back to simulated fixture data in production when Cloud services fail. | Clean separation of Preview vs. Production adapters (`APP_MODE`). Production adapters fail closed with explicit descriptive errors if credentials or cloud services are unreachable. |
| | `COM-03` | **False Positive / False Negative Sanctions Matching** | Weak aliases or imprecise fuzzy matching causing false matches against designated entities. | `sanctionsAgent.ts` normalizes punctuation and legal suffixes, checks primary names and strong aliases, and explicitly filters out weak aliases. OpenSanctions source IDs (e.g. `NK-VDEKGF5ZgHAkye4kGuUXs3`) are embedded for auditable cross-referencing. |
| | `COM-04` | **Same-Name Disambiguation Failures** | Unrelated individuals sharing similar names inappropriately matched to adverse media or PEP profiles. | Disambiguation checks dates of birth, nationality, middle names, and corporate role context. Disambiguation exceptions (such as unrelated namesake individuals) are tagged with `isDifferentIndividual: true` and excluded from scoring. |

---

## 3. Threat Subsystem Details

### 3.1 Authentication & Role-Based Access Control (RBAC)
- **Identity Provider**: Google Sign-In through Firebase Authentication exclusively. Password authentication is disabled.
- **Server Verification**: All API requests provide a `Bearer <idToken>` header. Express middleware verifies the token using Firebase Admin SDK `verifyIdToken()`. User identity (`uid`) is derived exclusively from the verified token. No sandbox bypasses or mock tokens exist.
- **Role Assignment**: On initial sign-in, the server routes check `users/{uid}`. If absent, a profile with role `"analyst"` is created. Role promotion to `"supervisor"` must be executed directly in Firestore or by administrative scripts.
- **Client Session Revocation**: Sign-out clears in-memory application state, Firebase Auth credentials, and local browser cache, returning the analyst to the sign-in screen.

### 3.2 Audit Trail & Non-Repudiation
- **Append-Only Schema**: Every audit record captures `timestamp` (server timestamp), `actorUid`, `actorType` (`HUMAN`, `SYSTEM`, `AI`), `actorName`, `action`, `summary`, optional entity references (`customerId`, `groupId`, `eventId`), and `details`.
- **Enforcement**: Write access is governed by Firestore rules and Admin SDK routes. Once written, documents in `audit/{auditId}` can never be updated or deleted by any user or client role.

### 3.3 Governance Mode & Four-Eyes Principle
- **Dual Operating Modes**:
  1. `human-in-the-loop` (Default): All registry change events require manual analyst/supervisor adjudication before being committed.
  2. `automated`: High-confidence determinations are processed automatically according to policy.
- **Supervisor-Only Transition**: Switching from `human-in-the-loop` to `automated` is enforced server-side. Non-supervisors receive HTTP 403, and the client UI disables the control with a clear tooltip. All governance mode transitions generate an immutable audit record.
- **Four-Eyes Case Closure**: High-risk or CRITICAL cases (sanctions hits, severe adverse media, circular loops) cannot be closed by their creator. A supervisor who is not the creator must review and record a reasoned resolution note (>= 5 chars) before case status can transition to `closed`.

### 3.4 Ingestion & Push Security (`/api/events/registry`)
- **Pub/Sub Authentication**: In production mode (`APP_MODE=PRODUCTION`), the push endpoint validates Google-signed OIDC ID tokens using `google-auth-library`.
- **Identity Verification**: Verifies the signature against Google's public keys, validates token audience against `PUBSUB_PUSH_AUDIENCE`, and ensures the subject email matches `PUBSUB_PUSH_SA`.
- **Input Validation**: Payload must conform to the BODS registry event schema with required customer, group, and change descriptors.

### 3.5 Sanctions List Verification & Sovcomflot Integration
- **Deterministic Screening**: `sanctionsAgent.ts` provides exact and strong alias matching against the designated entity database sourced from OpenSanctions (CC BY-NC 4.0).
- **Official Designation**: Includes real designated legal entity **Sovcomflot** (OpenSanctions ID `NK-VDEKGF5ZgHAkye4kGuUXs3`, Russian shipping enterprise designated across US OFAC, UK, EU, and Australian regimes).
- **No Living Persons**: In strict compliance with Synthetic Data Integrity directives, all natural person records are synthetic and labeled `synthetic: true`. Sanctions designations apply strictly to real legal entities.

### 3.6 Adverse Media Grounded Q&A & Indirect Injection Defense
- **Strict Citation Grounding**: The Q&A endpoint requires explicit `[cite:ARTICLE_ID]` tags in model responses. Responses with missing, malformed, or fabricated citation tags are rejected, returning the closed fallback "The available articles don't cover this."
- **Data vs Instruction Isolation**: Article text is supplied in structured JSON format within an explicit data context. Delimiters (quotes, brackets, braces, and linefeeds) are sanitized.
- **Rate Limiting & PII Shielding**: In-memory rate limiting prevents token exhaustion (20 queries per 10 minutes). Question and answer bodies are never written to server logs or Firestore audit entries; audit logs record only the subject ID and cited article IDs.

### 3.7 Deterministic Dossier Scoring & Corroboration Engine
- **Formula**: Score is computed as `min(100, round(sum(typologyWeight * legalStageWeight * recencyMultiplier) * corroborationMultiplier))`.
- **Cleared Matter Rule**: If the latest finding for a given matter is `cleared`, its base contribution is strictly 0.
- **Corroboration Multiplier**: Outlets are categorized by tier (tier-1 investigative, national broadsheet, trade press, blog/tabloid). Single-source uncorroborated allegations carry a dampening multiplier (0.75), whereas multi-source independent reports scale to 1.15.

### 3.8 Document Intake, Upload Validation & Magic Byte Defense
- **MIME & Magic Byte Verification**: Uploads are restricted to PDF and images (`application/pdf`, `image/png`, `image/jpeg`) under 10 MB. Validation does NOT rely on client file extensions: the server and client inspector inspect binary file signatures (magic bytes):
  - PDF: `%PDF-` (`0x25 0x50 0x44 0x46`)
  - PNG: `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`
  - JPEG: `0xFF 0xD8 0xFF`
  Disguised files (e.g. a plain text or shell script renamed with a `.pdf` extension) are immediately rejected with HTTP 400 (`Invalid file signature: file does not match true PDF structure`).
- **File Size & Denial of Wallet Guards**: 10 MB ceiling enforced in both client file handlers and server Express body parsers (`limit: '12mb'`). Oversized uploads are rejected prior to ingestion.
- **Filename Sanitization**: Uploaded filenames are stripped of path traversal characters (`../`, `..\\`) and control characters. Storage references use deterministic UUID-based identifiers (`doc-${Date.now()}-${uuid}`).

### 3.9 Dual Document Extractor Adapters & Graph Ingestion Safety
- **Dual Adapter Architecture (Custom Instructions §11)**:
  - **PREVIEW Mode**: Server executes Gemini extraction (`gemini-3.8-flash` with model fallback ladder) to parse document text/images into strongly-typed shareholder rows (`holderName`, `holderType`, `share`, `shareClass`, `asOfDate`, `confidence`). Labeled explicitly in the UI as `"Preview extraction (Gemini)"`.
  - **PRODUCTION Mode**: Stores the file in the dedicated Google Cloud Storage bucket (`EVIDENCE_BUCKET`) using uniform bucket-level access and private ACLs. Then processes the document with Google Cloud Document AI (`DOCAI_LOCATION`, `DOCAI_PROCESSOR_ID`) using a Form Parser. Key-value pairs and tables are mapped to shareholder rows. Gemini may assist schema mapping but is cryptographically and logically prohibited from inventing or hallucinating values not present in Document AI raw output. Fails closed with descriptive errors if required Cloud configurations are missing.
- **Untrusted Document Text**: Document contents are treated strictly as UNTRUSTED DATA. Extraction prompts isolate OCR and text in distinct data fields with delimiter stripping to prevent indirect prompt injection from malicious documents.
- **Staging & Analyst Confirmation Gate**: Extracted rows NEVER mutate the live graph directly. Rows are staged in `documentExtractions/{extractionId}` and presented in an interactive review table showing field-level extraction confidence.
- **Reconciliation & Graph Integrity**: The analyst must explicitly verify, edit, and confirm the rows. Upon confirmation, the system creates an accepted event with source `"client document"`, links the extraction ID, closes the gap node with a ripple animation, updates the completeness score with an animated bar, and triggers full UBO graph re-resolution. If any revealed owner crosses statutory thresholds, it flows immediately into materiality evaluation.

---

## 4. Threat Matrix Verification Matrix

| Area | Verified Countermeasure | Test Status |
| :--- | :--- | :--- |
| Firebase ID Token Verification | Server fails closed with 401 when header is missing or token is invalid | PASS |
| Firestore Immutability | `firestore.rules` blocks update and delete on `audit/*` | PASS (Deployed) |
| Role Privilege Boundary | Non-supervisor cannot enable automated governance mode | PASS |
| Prompt Delimiter Stripping | Quotes, braces, and line breaks sanitized before Gemini ladder | PASS |
| Fallback Model Ladder | `gemini-3.8-flash` → `gemini-flash-latest` → deterministic template | PASS |
| Materiality Verdict Determinism | Pure engine test passes all 4 statutory threshold and sanctions cases | PASS |
| Sanctions Name Normalisation | Entity and person name normalisation strips suffixes and punctuation | PASS |
| Disambiguation Exclusion | Disambiguation excludes unrelated namesakes (`art-disambig-01`) | PASS |
| Dossier Scoring Integrity | Recency multipliers, cleared matter rules, and 100-cap verified | PASS |
| Q&A Citation Verification | Server rejects fabricated citations and logs opaque audit entries | PASS |
| Four-Eyes Closure Rule | Supervisor required to close CRITICAL cases; cannot be creator | PASS |
| Document File Signature Check | True magic bytes validated; renamed `.txt` disguised as `.pdf` rejected | PASS |
| Document Extraction Staging | Extracted rows require manual analyst confirmation before graph entry | PASS |
| Document AI Fail-Closed | Production adapter halts if `EVIDENCE_BUCKET` or `DOCAI_*` is unset | PASS |

