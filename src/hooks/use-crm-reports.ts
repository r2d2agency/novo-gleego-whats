import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SalesTimelineData {
  period: string;
  open: number;
  won: number;
  lost: number;
  wonValue: number;
  lostValue: number;
  openValue: number;
}

export interface SalesSummary {
  open: { count: number; value: number };
  won: { count: number; value: number };
  lost: { count: number; value: number };
  winRate: number;
  totalValue: number;
}

export interface FunnelSalesData {
  funnelId: string;
  funnelName: string;
  funnelColor: string;
  open: number;
  won: number;
  lost: number;
  wonValue: number;
}

export interface OwnerSalesData {
  userId: string;
  userName: string;
  wonCount: number;
  lostCount: number;
  wonValue: number;
  lostValue: number;
  openValue: number;
  totalDeals: number;
  avgTicket: number;
}

export interface GroupSalesData {
  groupId: string;
  groupName: string;
  open: number;
  won: number;
  lost: number;
  openValue: number;
  wonValue: number;
  lostValue: number;
  totalDeals: number;
  avgTicket: number;
}

export interface SalesReportData {
  timeline: SalesTimelineData[];
  summary: SalesSummary;
  newLeads: number;
  avgTicket: number;
  avgCycleDays: number;
  totalPipeline: number;
  byFunnel: FunnelSalesData[];
  byOwner: OwnerSalesData[];
  byGroup: GroupSalesData[];
}

export interface ConversionStageData {
  stageId: string;
  stageName: string;
  stageColor: string;
  position: number;
  isFinal: boolean;
  dealCount: number;
  totalValue: number;
}

export function useCRMSalesReport(params: {
  startDate?: string;
  endDate?: string;
  funnelId?: string;
  groupBy?: 'day' | 'week' | 'month';
  groupId?: string;
  ownerId?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params.startDate) searchParams.append('start_date', params.startDate);
  if (params.endDate) searchParams.append('end_date', params.endDate);
  if (params.funnelId) searchParams.append('funnel_id', params.funnelId);
  if (params.groupBy) searchParams.append('group_by', params.groupBy);
  if (params.groupId) searchParams.append('group_id', params.groupId);
  if (params.ownerId) searchParams.append('owner_id', params.ownerId);

  return useQuery({
    queryKey: ["crm-sales-report", params],
    queryFn: async () => {
      return api<SalesReportData>(`/api/crm/reports/sales?${searchParams.toString()}`);
    },
  });
}

export interface OperationalReport {
  period: { start_date: string; end_date: string };
  byUser: Array<{
    user_id: string;
    user_name: string;
    chats: number;
    scheduled_sent: number;
    calls: number;
    followups: number;
    cards: number;
  }>;
  daily: Array<{
    day: string;
    chats: number;
    calls: number;
    scheduled_sent: number;
    tasks: number;
  }>;
  calls: Array<{ user_id: string; user_name: string; total: number; outgoing: number }>;
  scheduled: Array<{ user_id: string; user_name: string; total: number; sent: number; pending: number; failed: number }>;
  followups: Array<{ user_id: string; user_name: string; followups: number; completed: number }>;
  byFunnel: Array<{ funnel_id: string; funnel_name: string; total: number; won: number; open: number; total_value: number }>;
  tasksByFunnel: Array<{ funnel_id: string; funnel_name: string; task_type: string; total: number; completed: number; pending: number }>;
  tasksByType: Array<{ type: string; total: number; completed: number; pending: number }>;
  assignedCards: number;
}

export interface CallLogReport {
  period: { start_date: string; end_date: string };
  summary: { total: number; answered: number; duration_seconds: number; contacts: number };
  byUser: Array<{ user_id: string; user_name: string; total: number; duration_seconds: number; answered: number }>;
  byOutcome: Array<{ outcome: string; total: number; duration_seconds: number }>;
  daily: Array<{ day: string; total: number; duration_seconds: number }>;
  calls: Array<{
    id: string;
    created_at: string;
    call_type: string;
    outcome: string;
    duration_seconds: number;
    notes?: string;
    contact_name?: string;
    contact_phone?: string;
    user_name?: string;
    conversation_id: string;
    conversation_contact?: string;
  }>;
}

export function useCallLogReport(params: {
  startDate?: string;
  endDate?: string;
  userId?: string;
  outcome?: string;
  contact?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params.startDate) searchParams.append('start_date', params.startDate);
  if (params.endDate) searchParams.append('end_date', params.endDate);
  if (params.userId) searchParams.append('user_id', params.userId);
  if (params.outcome) searchParams.append('outcome', params.outcome);
  if (params.contact) searchParams.append('contact', params.contact);

  return useQuery({
    queryKey: ["call-log-report", params],
    queryFn: () => api<CallLogReport>(`/api/chat/call-logs/report?${searchParams.toString()}`),
  });
}

export function useOperationalReport(params: { startDate?: string; endDate?: string }) {
  const searchParams = new URLSearchParams();
  if (params.startDate) searchParams.append('start_date', params.startDate);
  if (params.endDate) searchParams.append('end_date', params.endDate);

  return useQuery({
    queryKey: ["crm-operational-report", params],
    queryFn: () => api<OperationalReport>(`/api/crm/reports/operational?${searchParams.toString()}`),
  });
}

export function useCRMConversionReport(params: {
  funnelId: string;
  startDate?: string;
  endDate?: string;
}) {
  const searchParams = new URLSearchParams();
  searchParams.append('funnel_id', params.funnelId);
  if (params.startDate) searchParams.append('start_date', params.startDate);
  if (params.endDate) searchParams.append('end_date', params.endDate);

  return useQuery({
    queryKey: ["crm-conversion-report", params],
    queryFn: async () => {
      return api<ConversionStageData[]>(`/api/crm/reports/conversion?${searchParams.toString()}`);
    },
    enabled: !!params.funnelId,
  });
}

// ============================================
// REVENUE INTELLIGENCE HOOKS
// ============================================

export interface RevenueForecast {
  pipeline: Array<{
    funnel_name: string;
    stage_name: string;
    position: number;
    is_final: boolean;
    deal_count: number;
    total_value: number;
    avg_lead_score: number;
  }>;
  historical_wins: Array<{
    month: string;
    won_count: number;
    won_value: number;
  }>;
  avg_deal_value: number;
  avg_days_to_close: number;
  current_pipeline_value: number;
  forecast: Array<{
    month: string;
    projected: number;
    optimistic: number;
    pessimistic: number;
    confidence: number;
  }>;
}

export interface PipelineVelocity {
  velocity: number;
  metrics: {
    won_deals: number;
    open_deals: number;
    avg_deal_value: number;
    avg_cycle_days: number;
    win_rate: number;
  };
  stage_conversion: Array<{
    stage_id: string;
    stage_name: string;
    position: number;
    deals_entered: number;
    deals_won: number;
    conversion_rate: number;
  }>;
  stage_time: Array<{
    stage_name: string;
    position: number;
    avg_days_in_stage: number;
  }>;
}

export interface WinLossAnalysis {
  summary: {
    won: {
      count: number;
      total_value: number;
      avg_value: number;
      avg_days: number;
    };
    lost: {
      count: number;
      total_value: number;
      avg_value: number;
      avg_days: number;
    };
    win_rate: number;
  };
  loss_reasons: Array<{
    reason: string;
    count: number;
    lost_value: number;
  }>;
  by_owner: Array<{
    user_id: string;
    user_name: string;
    won_count: number;
    lost_count: number;
    won_value: number;
    win_rate: number;
  }>;
  by_segment: Array<{
    segment: string;
    won_count: number;
    lost_count: number;
    won_value: number;
  }>;
  trend: Array<{
    month: string;
    won_count: number;
    lost_count: number;
    won_value: number;
    lost_value: number;
  }>;
}

export function useRevenueForecast(months?: number) {
  return useQuery({
    queryKey: ["revenue-forecast", months],
    queryFn: () => api<RevenueForecast>(`/api/crm/intelligence/revenue-forecast?months=${months || 6}`),
  });
}

export function usePipelineVelocity(funnelId?: string) {
  const params = new URLSearchParams();
  if (funnelId) params.set("funnel_id", funnelId);

  return useQuery({
    queryKey: ["pipeline-velocity", funnelId],
    queryFn: () => api<PipelineVelocity>(`/api/crm/intelligence/pipeline-velocity?${params.toString()}`),
  });
}

export function useWinLossAnalysis(params?: {
  startDate?: string;
  endDate?: string;
  funnelId?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.startDate) searchParams.set("start_date", params.startDate);
  if (params?.endDate) searchParams.set("end_date", params.endDate);
  if (params?.funnelId) searchParams.set("funnel_id", params.funnelId);

  return useQuery({
    queryKey: ["win-loss-analysis", params],
    queryFn: () => api<WinLossAnalysis>(`/api/crm/intelligence/win-loss-analysis?${searchParams.toString()}`),
  });
}
