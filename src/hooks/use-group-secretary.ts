import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

export interface SecretaryConfig {
  id?: string;
  is_active: boolean;
  connection_ids: string[] | null;
  group_jids: string[] | null;
  create_crm_task: boolean;
  show_popup_alert: boolean;
  min_confidence: number;
  ai_provider: string | null;
  ai_model: string | null;
  ai_api_key?: string | null;
  notify_external_enabled?: boolean;
  notify_external_phone?: string;
  notify_members_whatsapp?: boolean;
  default_connection_id?: string | null;
  individual_notifications_enabled?: boolean;
  followup_enabled?: boolean;
  followup_hours?: number;
  daily_digest_enabled?: boolean;
    daily_digest_hour?: number;
    daily_digest_minute?: number;
    daily_digest_type?: 'detailed' | 'analytical';
  auto_reply_enabled?: boolean;
  auto_reply_message?: string;
  excluded_senders?: string[];
}

export interface SecretaryMember {
  id: string;
  organization_id: string;
  user_id: string;
  user_name: string;
  email: string;
  whatsapp_phone: string | null;
  phone: string | null;
  aliases: string[];
  role_description: string | null;
  departments: string[];
  is_active: boolean;
}

export interface SecretaryFollowup {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  followup_sent_at: string | null;
  followup_count: number;
  followup_disabled: boolean;
}


export interface SecretaryLog {
  id: string;
  conversation_id: string;
  message_content: string;
  sender_name: string;
  detected_request: string;
  matched_user_id: string | null;
  matched_user_name: string | null;
  confidence: number;
  crm_task_id: string | null;
  alert_id: string | null;
  group_name: string | null;
  processing_time_ms: number;
  priority: string;
  sentiment: string;
  deadline: string | null;
  matched_users_count: number;
  created_at: string;
}

export interface SecretaryStats {
  period_days: number;
  overall: {
    total: string;
    matched: string;
    urgent: string;
    high: string;
    negative: string;
    avg_processing_ms: string;
    avg_confidence: string;
  };
  members: Array<{
    matched_user_id: string;
    matched_user_name: string;
    total_requests: string;
    urgent_count: string;
    high_count: string;
    negative_count: string;
    avg_confidence: string;
  }>;
  pending_tasks: Array<{
    assigned_to: string;
    assigned_name: string;
    pending_count: string;
  }>;
  daily: Array<{
    date: string;
    count: string;
    priority_count: string;
  }>;
}

export interface AvailableUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface MeetingMinutes {
  id: string;
  organization_id: string;
  conversation_id: string;
  group_name: string;
  title: string;
  summary: string;
  decisions: Array<{ description: string; responsible: string | null }>;
  action_items: Array<{ task: string; responsible: string; deadline: string | null }>;
  participants: string[];
  message_count: number;
  period_start: string;
  period_end: string;
  generated_by_name: string | null;
  created_at: string;
}

export interface MonitoredGroup {
  id: string;
  remote_jid: string;
  group_name: string;
  connection_id: string;
  connection_name: string;
}

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  organizationId: string;
  provider: string;
  stage: string;
  messageId?: string | null;
  conversationId?: string | null;
  groupName?: string | null;
  senderName?: string | null;
  message?: string;
  details?: Record<string, any>;
  error?: string;
}

export const useGroupSecretary = () => {
  const [loading, setLoading] = useState(false);

  const getConfig = useCallback(async (): Promise<SecretaryConfig> => {
    const data = await api<SecretaryConfig>('/api/group-secretary/config');
    return data;
  }, []);

  const saveConfig = useCallback(async (config: Partial<SecretaryConfig>): Promise<SecretaryConfig> => {
    const data = await api<SecretaryConfig>('/api/group-secretary/config', {
      method: 'PUT',
      body: config,
    });
    return data;
  }, []);

  const getMembers = useCallback(async (): Promise<SecretaryMember[]> => {
    const data = await api<SecretaryMember[]>('/api/group-secretary/members');
    return data;
  }, []);

  const addMember = useCallback(async (member: {
    user_id: string;
    aliases: string[];
    role_description: string;
    departments: string[];
  }): Promise<SecretaryMember> => {
    const data = await api<SecretaryMember>('/api/group-secretary/members', {
      method: 'POST',
      body: member,
    });
    return data;
  }, []);

  const removeMember = useCallback(async (memberId: string): Promise<void> => {
    await api(`/api/group-secretary/members/${memberId}`, { method: 'DELETE' });
  }, []);

  const getLogs = useCallback(async (limit = 50): Promise<SecretaryLog[]> => {
    const data = await api<SecretaryLog[]>(`/api/group-secretary/logs?limit=${limit}`);
    return data;
  }, []);

  const getAvailableUsers = useCallback(async (): Promise<AvailableUser[]> => {
    const data = await api<AvailableUser[]>('/api/group-secretary/available-users');
    return data;
  }, []);

  const getGroups = useCallback(async (): Promise<MonitoredGroup[]> => {
    const data = await api<MonitoredGroup[]>('/api/group-secretary/groups');
    return data;
  }, []);

  const getStats = useCallback(async (days = 7): Promise<SecretaryStats> => {
    const data = await api<SecretaryStats>(`/api/group-secretary/stats?days=${days}`);
    return data;
  }, []);

  const updateMemberPhone = useCallback(async (userId: string, whatsappPhone: string): Promise<void> => {
    await api(`/api/group-secretary/members/${userId}/phone`, {
      method: 'PUT',
      body: { whatsapp_phone: whatsappPhone },
    });
  }, []);

  const generateMeetingMinutes = useCallback(async (conversationId: string, hours = 24): Promise<MeetingMinutes> => {
    const data = await api<MeetingMinutes>('/api/group-secretary/meeting-minutes/generate', {
      method: 'POST',
      body: { conversation_id: conversationId, hours },
    });
    return data;
  }, []);

  const getMeetingMinutes = useCallback(async (limit = 20): Promise<MeetingMinutes[]> => {
    const data = await api<MeetingMinutes[]>(`/api/group-secretary/meeting-minutes?limit=${limit}`);
    return data;
  }, []);

  const deleteMeetingMinutes = useCallback(async (id: string): Promise<void> => {
    await api(`/api/group-secretary/meeting-minutes/${id}`, { method: 'DELETE' });
  }, []);

  const sendDigestNow = useCallback(async (): Promise<{ success: boolean; sent: number }> => {
    const data = await api<{ success: boolean; sent: number }>('/api/group-secretary/digest/send-now', {
      method: 'POST',
      body: {},
    });
    return data;
  }, []);

  const getDiagnosticEvents = useCallback(async (filters: { provider?: string; stage?: string; limit?: number } = {}): Promise<DiagnosticEvent[]> => {
    const params = new URLSearchParams();
    if (filters.provider) params.set('provider', filters.provider);
    if (filters.stage) params.set('stage', filters.stage);
    if (filters.limit) params.set('limit', String(filters.limit));
    const qs = params.toString();
    const data = await api<{ events: DiagnosticEvent[] }>(`/api/group-secretary/diagnostic${qs ? `?${qs}` : ''}`);
    return data.events || [];
  }, []);

  const clearDiagnosticEvents = useCallback(async (): Promise<void> => {
    await api('/api/group-secretary/diagnostic', { method: 'DELETE' });
  }, []);

  const getFollowups = useCallback(async (): Promise<SecretaryFollowup[]> => {
    const data = await api<SecretaryFollowup[]>('/api/group-secretary/followups');
    return Array.isArray(data) ? data : [];
  }, []);

  const toggleFollowup = useCallback(async (id: string, disabled: boolean): Promise<void> => {
    await api(`/api/group-secretary/followups/${id}/toggle`, {
      method: 'POST',
      body: { disabled },
    });
  }, []);

  const stopAllFollowups = useCallback(async (): Promise<number> => {
    const data = await api<{ stopped: number }>('/api/group-secretary/followups/stop-all', {
      method: 'POST',
      body: {},
    });
    return data?.stopped || 0;
  }, []);

  return {
    loading,
    setLoading,
    getConfig,
    saveConfig,
    getMembers,
    addMember,
    removeMember,
    getLogs,
    getAvailableUsers,
    getGroups,
    getStats,
    updateMemberPhone,
    generateMeetingMinutes,
    getMeetingMinutes,
    deleteMeetingMinutes,
    sendDigestNow,
    getDiagnosticEvents,
    clearDiagnosticEvents,
    getFollowups,
    toggleFollowup,
    stopAllFollowups,
  };
};
