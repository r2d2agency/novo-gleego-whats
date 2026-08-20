# Plan: Fix for Meta Campaigns and Log Verification

The user reported that scheduled Meta campaigns are not starting or get stuck in "running" without sending. This plan focuses on identifying and fixing the scheduler logic, improving campaign execution reliability, and providing clear diagnostic logs.

## Technical Details

### 1. Scheduler Logic Investigation and Fix
- **Backend `backend/src/campaign-scheduler.js`**:
    - Refactor the auto-start logic to be more resilient to timezone shifts.
    - Ensure Meta campaigns are correctly filtered and processed even if the connection status is temporarily unstable.
    - Add explicit logging for skipped messages (e.g., "Connection offline", "Token missing").
- **Backend `backend/src/routes/campaigns.js`**:
    - Review the `scheduled_at` calculation during campaign creation. Ensure the `-3h` offset correctly matches the database `NOW()` (UTC).

### 2. Provider Integration Stability
- **Meta Provider `backend/src/lib/meta-template-send.js`**:
    - Improve error handling to distinguish between transient network issues and permanent Meta API errors (e.g., invalid tokens).
    - Ensure the campaign scheduler correctly handles these errors to prevent blocking the entire queue.

### 3. Diagnostic and Verification
- **Log Injection**:
    - Temporarily increase log verbosity for the `executeCampaignMessages` function to trace each step of a Meta campaign lifecycle.
    - Provide the user with a way to see why a specific campaign is "waiting" or "executing" without progress.

### 4. Verification Plan
- Use existing unit/integration tests if available.
- Manually trigger the scheduler cycle via a temporary route or script and monitor the output.
- Verify that Meta campaigns move from `pending` -> `running` -> `completed` and that `sent_count` increments.

## User Impact
- Campaigns will start as scheduled without manual intervention.
- The user will have clear feedback if a campaign is paused due to connection issues (Meta token expired, etc.).
