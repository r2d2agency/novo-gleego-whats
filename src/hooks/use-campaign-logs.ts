import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface CampaignLog {
  id: string;
  campaign_id?: string;
  campaign_name?: string;
  organization_name?: string;
  phone?: string;
  status?: string;
  message?: string;
  error?: string;
  created_at: string;
  [key: string]: unknown;
}

interface Filters { campaignId?: string; status?: string; search?: string; from?: string; to?: string; }

export const useCampaignLogs = (filters: Filters = {}) => {
  const [logs, setLogs] = useState<CampaignLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getCampaignLogs = useCallback(async (override: Filters = {}) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries({ ...filters, ...override }).forEach(([key, value]) => { if (value) params.set(key, value); });
      const result = await api<CampaignLog[] | { logs: CampaignLog[] }>(`/campaigns/logs${params.toString() ? `?${params}` : ''}`);
      setLogs(Array.isArray(result) ? result : result.logs || []);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar logs das campanhas';
      setError(message); throw err;
    } finally { setLoading(false); }
  }, [JSON.stringify(filters)]);

  useEffect(() => { getCampaignLogs().catch(() => undefined); }, [getCampaignLogs]);
  return { logs, loading, error, getCampaignLogs };
};
