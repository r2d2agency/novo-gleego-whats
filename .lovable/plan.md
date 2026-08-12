
## Plan: Fix Supervisor IA Tag Monitoring

The user reports that despite having 350+ leads with selected tags, the Supervisor IA audit finds nothing. The current logic in `backend/src/supervisor-audit-scheduler.js` only iterates over `crm_deals` and checks tags within those deals. If the user is using tags in the chat but hasn't created CRM cards for all contacts, the current logic will miss them.

### Technical Changes

#### Backend
- **Audit Logic Enhancement** (`backend/src/supervisor-audit-scheduler.js`):
    - Fetch all conversations with monitored tags that belong to the organization.
    - Analyze engagement for these conversations even if they aren't linked to a CRM deal.
    - Detect "No Response" (last message is from customer and old) and "No Approach" (no seller message) directly from conversation metadata.
    - Ensure `last_customer_message_at` and `last_seller_message_at` are correctly synced from the `conversations` table if the `crm_deals` link is missing.

#### Database
- Ensure `conversations` table tags are indexed for performance.
- Update `supervisor_audits` to support `conversation_id` for cases where no `deal_id` exists.

### Verification Plan
- Trigger a manual audit and verify that findings are generated for conversations with the selected tags.
- Check the "Auditoria" tab in the UI to see the new alerts.
