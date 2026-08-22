import { useEffect } from "react";

const Index = () => {
  useEffect(() => {
    // The user provided database logs indicating missing columns and failed updates.
    // I need to fix the backend schema and queries.
  }, []);

  return (
    <div className="min-h-screen bg-background p-8 flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Diagnóstico do Sistema</h1>
      <pre className="p-4 bg-muted rounded overflow-auto text-xs whitespace-pre-wrap max-w-full">
        {`agora voltou mas os disparou parou de funcionar . PostgreSQL Database directory appears to contain a database; Skipping initialization

2026-08-22 15:34:17.504 UTC [7] LOG:  starting PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
2026-08-22 15:34:17.505 UTC [7] LOG:  listening on IPv4 address "0.0.0.0", port 5432
2026-08-22 15:34:17.505 UTC [7] LOG:  listening on IPv6 address "::", port 5432
2026-08-22 15:34:17.520 UTC [7] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
2026-08-22 15:34:17.548 UTC [30] LOG:  database system was shut down at 2026-08-22 15:33:14 UTC
2026-08-22 15:34:17.612 UTC [7] LOG:  database system is ready to accept connections
2026-08-22 15:39:17.556 UTC [28] LOG:  checkpoint starting: time
2026-08-22 15:39:17.684 UTC [28] LOG:  checkpoint complete: wrote 2 buffers (0.0%); 0 WAL file(s) added, 0 removed, 0 recycled; write=0.014 s, sync=0.007 s, total=0.129 s; sync files=3, longest=0.006 s, average=0.003 s; distance=0 kB, estimate=0 kB; lsn=2/BF54AAE0, redo lsn=2/BF54AA88
2026-08-22 15:40:31.182 UTC [80] ERROR:  column "organization_id" does not exist
2026-08-22 15:40:31.182 UTC [80] STATEMENT:  
        CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
        CREATE INDEX IF NOT EXISTS idx_connections_org ON connections(organization_id);
        CREATE INDEX IF NOT EXISTS idx_contact_lists_user_id ON contact_lists(user_id);
        CREATE INDEX IF NOT EXISTS idx_contact_lists_conn ON contact_lists(connection_id);
        CREATE INDEX IF NOT EXISTS idx_contacts_list_id ON contacts(list_id);
        CREATE INDEX IF NOT EXISTS idx_contacts_jid ON contacts(jid);
        CREATE INDEX IF NOT EXISTS idx_message_templates_user_id ON message_templates(user_id);
        CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
        CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_campaign_messages_status ON campaign_messages(status);
        CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
        CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_connection_members_conn ON connection_members(connection_id);
        CREATE INDEX IF NOT EXISTS idx_connection_members_user ON connection_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_asaas_integrations_org ON asaas_integrations(organization_id);
        CREATE INDEX IF NOT EXISTS idx_asaas_customers_org ON asaas_customers(organization_id);
        CREATE INDEX IF NOT EXISTS idx_asaas_payments_org ON asaas_payments(organization_id);
        CREATE INDEX IF NOT EXISTS idx_asaas_payments_status ON asaas_payments(status);
        CREATE INDEX IF NOT EXISTS idx_asaas_payments_due_date ON asaas_payments(due_date);
        CREATE INDEX IF NOT EXISTS idx_billing_notifications_payment ON billing_notifications(payment_id);

        CREATE INDEX IF NOT EXISTS idx_billing_alerts_org ON billing_alerts(organization_id);
        CREATE INDEX IF NOT EXISTS idx_billing_alerts_unresolved ON billing_alerts(organization_id, is_resolved) WHERE is_resolved = false;
        CREATE INDEX IF NOT EXISTS idx_billing_daily_msg_customer_day ON billing_daily_message_count(customer_id, day);

        CREATE INDEX IF NOT EXISTS idx_conversations_conn ON conversations(connection_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_to);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);

        CREATE INDEX IF NOT EXISTS idx_conversation_notes_conv ON conversation_notes(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status_time ON scheduled_messages(status, scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_quick_replies_org ON quick_replies(organization_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_quick_replies_shortcut_org ON quick_replies(organization_id, shortcut) WHERE shortcut IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_user_alerts_user_unread ON user_alerts(user_id, is_read) WHERE is_read = false;
        CREATE INDEX IF NOT EXISTS idx_chat_contacts_conn ON chat_contacts(connection_id);
        CREATE INDEX IF NOT EXISTS idx_chat_contacts_phone ON chat_contacts(phone);

        -- Chat list performance (group/chat tab switching)
        CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_ts ON chat_messages(conversation_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_conversations_org_last ON conversations(organization_id, last_message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_conv_tag_links_conv ON conversation_tag_links(conversation_id);

2026-08-22 15:41:00.771 UTC [71] ERROR:  column "updated_at" does not exist at character 160
2026-08-22 15:41:00.771 UTC [71] HINT:  Perhaps you meant to reference the column "campaign_messages.created_at".
2026-08-22 15:41:00.771 UTC [71] STATEMENT:  UPDATE campaign_messages 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
                 RETURNING id
2026-08-22 15:41:30.779 UTC [75] ERROR:  column "updated_at" does not exist at character 160
2026-08-22 15:41:30.779 UTC [75] HINT:  Perhaps you meant to reference the column "campaign_messages.created_at".
2026-08-22 15:41:30.779 UTC [75] STATEMENT:  UPDATE campaign_messages 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
                 RETURNING id
2026-08-22 15:42:00.859 UTC [108] ERROR:  column "updated_at" does not exist at character 160
2026-08-22 15:42:00.859 UTC [108] HINT:  Perhaps you meant to reference the column "campaign_messages.created_at".
2026-08-22 15:42:00.859 UTC [108] STATEMENT:  UPDATE campaign_messages 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
                 RETURNING id
2026-08-22 15:42:30.857 UTC [128] ERROR:  column "updated_at" does not exist at character 160
2026-08-22 15:42:30.857 UTC [128] HINT:  Perhaps you meant to reference the column "campaign_messages.created_at".
2026-08-22 15:42:30.857 UTC [128] STATEMENT:  UPDATE campaign_messages 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
                 RETURNING id
2026-08-22 15:43:00.903 UTC [134] ERROR:  column "updated_at" does not exist at character 160
2026-08-22 15:43:00.903 UTC [134] HINT:  Perhaps you meant to reference the column "campaign_messages.created_at".
2026-08-22 15:43:00.903 UTC [134] STATEMENT:  UPDATE campaign_messages 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
                 RETURNING id
2026-08-22 15:43:30.922 UTC [138] ERROR:  column "updated_at" does not exist at character 160
2026-08-22 15:43:30.922 UTC [138] HINT:  Perhaps you meant to reference the column "campaign_messages.created_at".
2026-08-22 15:43:30.922 UTC [138] STATEMENT:  UPDATE campaign_messages 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
                 RETURNING id
2026-08-22 15:44:00.973 UTC [135] ERROR:  column "updated_at" does not exist at character 160
2026-08-22 15:44:00.973 UTC [135] HINT:  Perhaps you meant to reference the column "campaign_messages.created_at".
2026-08-22 15:44:00.973 UTC [135] STATEMENT:  UPDATE campaign_messages 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
                 RETURNING id
2026-08-22 15:44:17.784 UTC [28] LOG:  checkpoint starting: time
2026-08-22 15:44:30.107 UTC [159] ERROR:  column "updated_at" does not exist at character 160
2026-08-22 15:44:30.107 UTC [159] HINT:  Perhaps you meant to reference the column "campaign_messages.created_at".
2026-08-22 15:44:30.107 UTC [159] STATEMENT:  UPDATE campaign_messages 
                 SET status = 'processing', updated_at = NOW() 
                 WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes'))
                 RETURNING id
2026-08-22 15:44:36.405 UTC [28] LOG:  checkpoint complete: wrote 184 buffers (1.1%); 0 WAL file(s) added, 0 removed, 2 recycled; write=18.505 s, sync=0.057 s, total=18.621 s; sync files=61, longest=0.019 s, average=0.001 s; distance=33732 kB, estimate=33732 kB; lsn=2/C1644C60, redo lsn=2/C163BBF0`}
      </pre>
    </div>
  );
};

export default Index;
