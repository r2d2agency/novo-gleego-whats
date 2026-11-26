import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

export interface SalesSeoTracker {
  id: string;
  name: string;
  phrase: string;
  connection_ids: string[];
  is_active: boolean;
  created_at: string;
}

export interface SalesSeoAnalytics {
  stats: {
    total: number;
    just_arrived: number;
    engaged: number;
    converted: number;
    lost: number;
  };
  daily: Array<{ date: string; total: number; converted: number; just_arrived: number; engaged: number }>;
  hourly: Array<{ hour: number; total: number }>;
  monthly: Array<{ month: string; total: number; attended: number }>;
}

export interface SalesSeoLead {
  id: string;
  tracker_id: string;
  tracker_name: string;
  conversation_id: string;
  connection_id: string;
  connection_name: string;
  contact_name: string;
  phone: string;
  entry_message: string;
  evolution_status: number;
  ia_analysis?: string;
  ia_analyzed_at?: string | null;
  created_at: string;
}

export const useSalesSeo = () => {
  const [loading, setLoading] = useState(false);

  const getTrackers = useCallback(async (): Promise<SalesSeoTracker[]> => {
    return api<SalesSeoTracker[]>('/api/sales-seo/trackers');
  }, []);

  const createTracker = useCallback(async (data: Partial<SalesSeoTracker>): Promise<SalesSeoTracker> => {
    return api<SalesSeoTracker>('/api/sales-seo/trackers', {
      method: 'POST',
      body: data,
    });
  }, []);

  const deleteTracker = useCallback(async (id: string): Promise<void> => {
    await api(`/api/sales-seo/trackers/${id}`, { method: 'DELETE' });
  }, []);

  const getAnalytics = useCallback(async (params: any): Promise<SalesSeoAnalytics> => {
    const searchParams = new URLSearchParams(params);
    return api<SalesSeoAnalytics>(`/api/sales-seo/analytics?${searchParams.toString()}`);
  }, []);

  const getLeads = useCallback(async (params: any): Promise<SalesSeoLead[]> => {
    const searchParams = new URLSearchParams(params);
    return api<SalesSeoLead[]>(`/api/sales-seo/leads?${searchParams.toString()}`);
  }, []);

  const importRetroactive = useCallback(async (days: number = 7): Promise<{ processed: number; matched: number; errors: string[]; days: number }> => {
    return api('/api/sales-seo/import-retroactive', {
      method: 'POST',
      body: { days },
    });
  }, []);

  const analyzeIA = useCallback(async (leadId: string): Promise<any> => {
    return api('/api/sales-seo/analyze-ia', {
      method: 'POST',
      body: { lead_id: leadId },
    });
  }, []);

  return {
    loading,
    setLoading,
    getTrackers,
    createTracker,
    deleteTracker,
    getAnalytics,
    getLeads,
    importRetroactive,
    analyzeIA,
  };
};
