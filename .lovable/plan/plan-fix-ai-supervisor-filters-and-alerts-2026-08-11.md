# Plan - Fix AI Supervisor Filters and Alerts

The user is experiencing issues with the AI Supervisor system:
1. **SLA Rules / Funnel Filters:** Only one funnel is appearing in the SLA rules dialog and the main funnel filter, even when multiple funnels exist.
2. **Alerts Tab:** The "Alertas" tab is not loading all expected data.

## Proposed Changes

### 1. Frontend: Fix Funnel Selection in SLA Rules
In `src/pages/SupervisorIA.tsx`, the `monitored_funnels` logic in the SLA rules dialog needs to be more resilient. Currently, it initializes `next` with `localSettings.monitored_funnels` or falls back to mapping all funnels, but the state management might be causing issues when `localSettings.monitored_funnels` is null or empty.

### 2. Frontend: Improve Alerts Tab Loading
The "Alertas" tab relies on `semaphore?.leads`. I will verify if the filtering logic for specific funnels is causing leads to be omitted unexpectedly.

### 3. Backend: Fix Semaphore and Stats Funnel Filtering
In `backend/src/routes/supervisor.js`:
- The `/semaphore` endpoint uses a strict `AND funnel_id = ANY($2)` check. If `monitored_funnels` is empty in settings, it might be defaulting to an empty array instead of "all".
- I will update the logic to treat an empty `monitored_funnels` array as "monitor all funnels" in the backend queries.

### 4. Backend: Fix Stats Funnel Filtering
Similarly, in the `/stats` endpoint, I will ensure that if `funnelId` is not provided and `monitored_funnels` is empty, it correctly defaults to searching all funnels for the organization.

## Technical Details
- **File:** `src/pages/SupervisorIA.tsx` - Fix the Checkbox logic for monitored funnels in the SLA Dialog.
- **File:** `backend/src/routes/supervisor.js` - Update `/semaphore` and `/stats` queries to handle empty `monitored_funnels` as "all".
- **Verification:** I will check if the user has multiple funnels in their CRM and ensure the filters display them all.

---
**Note:** I will also check the `crm_deals` table schema if needed, but primarily focusing on the logic that filters these records.
