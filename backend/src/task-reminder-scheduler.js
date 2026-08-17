import { query } from './db.js';
import * as whatsappProvider from './lib/whatsapp-provider.js';

/**
 * Task Reminder Scheduler
 * Checks for tasks with upcoming reminders and sends WhatsApp messages + popup alerts
 */
export async function executeTaskReminders() {
  try {
    // Find tasks where reminder is due and not yet sent
    const result = await query(`
      SELECT t.*, 
             u.name as assigned_to_name, 
             u.email as assigned_to_email,
             d.title as deal_title
      FROM crm_tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      LEFT JOIN crm_deals d ON d.id = t.deal_id
      WHERE t.status = 'pending'
        AND t.reminder_sent = false
        AND t.reminder_at IS NOT NULL
        AND t.reminder_at <= NOW()
        AND t.assigned_to IS NOT NULL
    `);

    if (result.rows.length === 0) return;

    console.log(`⏰ [REMINDERS] Processing ${result.rows.length} task reminders...`);

    for (const task of result.rows) {
      try {
        // Build reminder message
        const typeLabels = {
          task: 'Tarefa',
          call: 'Ligação',
          email: 'Email',
          meeting: 'Reunião',
          follow_up: 'Follow-up',
        };
        const typeLabel = typeLabels[task.type] || 'Compromisso';
        const dueDate = task.due_date ? new Date(task.due_date) : null;
        const dueDateStr = dueDate
          ? dueDate.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
          : '';

        const reminderMessage = `⏰ *Lembrete: ${typeLabel}*\n\n` +
          `📋 *${task.title}*\n` +
          (task.deal_title ? `💼 Negociação: ${task.deal_title}\n` : '') +
          (dueDateStr ? `📅 Data: ${dueDateStr}\n` : '') +
          (task.description ? `\n📝 ${task.description}` : '');

        // Send popup alert
        if (task.reminder_popup !== false) {
          await query(
            `INSERT INTO user_alerts (user_id, type, title, message, metadata)
             VALUES ($1, 'task_reminder', $2, $3, $4)`,
            [
              task.assigned_to,
              `${typeLabel}: ${task.title}`,
              dueDateStr ? `Horário: ${dueDateStr}` : 'Compromisso próximo',
              JSON.stringify({
                task_id: task.id,
                task_type: task.type,
                deal_id: task.deal_id,
                priority: task.priority,
              }),
            ]
          );
        }

        // Send WhatsApp message to the responsible person
        if (task.reminder_whatsapp) {
          await sendWhatsAppReminder(task, reminderMessage);
        }

        // Mark reminder as sent
        await query(
          `UPDATE crm_tasks SET reminder_sent = true, updated_at = NOW() WHERE id = $1`,
          [task.id]
        );

        console.log(`  ✓ Reminder sent for task "${task.title}" to ${task.assigned_to_name}`);
      } catch (taskError) {
        console.error(`  ✗ Error processing reminder for task ${task.id}:`, taskError.message);
      }
    }
  } catch (error) {
    console.error('⏰ [REMINDERS] Error executing task reminders:', error);
  }
}

/**
 * Send WhatsApp reminder to the assigned user
 */
async function sendWhatsAppReminder(task, message) {
  try {
    // Get user's phone from conversations or user profile
    const userResult = await query(
      `SELECT u.phone_number as phone, u.whatsapp_phone 
       FROM users u WHERE u.id = $1`,
      [task.assigned_to]
    );

    let phone = userResult.rows[0]?.whatsapp_phone || userResult.rows[0]?.phone;
    if (!phone) {
      console.log(`  ⚠ No phone number for user ${task.assigned_to_name}, skipping WhatsApp`);
      return;
    }

    // Clean phone
    phone = phone.replace(/\D/g, '');
    if (!phone) return;

    // Get an active connection for this organization
    const connResult = await query(
      `SELECT c.* FROM connections c
       WHERE c.organization_id = $1 AND c.status = 'connected'
       ORDER BY c.created_at ASC LIMIT 1`,
      [task.organization_id]
    );

    if (connResult.rows.length === 0) {
      console.log(`  ⚠ No active connection for org ${task.organization_id}, skipping WhatsApp`);
      return;
    }

    const connection = connResult.rows[0];
    await whatsappProvider.sendMessage(connection, phone, message, 'text');
    console.log(`  📱 WhatsApp reminder sent to ${phone}`);
  } catch (error) {
    console.error(`  ✗ Error sending WhatsApp reminder:`, error.message);
  }
}
