import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// Types
export interface CRMGroup {
  id: string;
  name: string;
  description?: string;
  member_count: number;
  created_at: string;
}

export interface CRMGroupMember {
  id: string;
  group_id: string;
  user_id: string;
  is_supervisor: boolean;
  name: string;
  email: string;
}

export interface CRMStage {
  id?: string;
  funnel_id?: string;
  name: string;
  color: string;
  position: number;
  inactivity_hours: number;
  inactivity_color: string;
  is_final: boolean;
}

export interface CRMFunnel {
  id: string;
  name: string;
  description?: string;
  color: string;
  is_active: boolean;
  open_deals: number;
  total_value: number;
  stages?: CRMStage[];
  created_at: string;
}

export interface CRMCompany {
  id: string;
  name: string;
  razao_social?: string;
  nome_fantasia?: string;
  cnpj?: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  porte?: string;
  cnae?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  notes?: string;
  more_info?: string;
  segment_id?: string;
  segment_name?: string;
  segment_color?: string;
  custom_fields?: Record<string, any>;
  owner_id?: string;
  owner_name?: string;
  group_id?: string;
  group_name?: string;
  deals_count: number;
  created_by_name?: string;
  created_at: string;
}

export interface CRMDealContact {
  id: string;
  name: string;
  phone: string;
  is_primary: boolean;
  role?: string;
}

export interface DealAttachment {
  id: string;
  deal_id: string;
  name: string;
  url: string;
  mimetype?: string;
  size: number;
  uploaded_by?: string;
  uploaded_by_name?: string;
  created_at: string;
}

export interface CRMDeal {
  id: string;
  funnel_id: string;
  stage_id: string;
  company_id: string;
  company_name: string;
  owner_id?: string;
  owner_name?: string;
  group_id?: string;
  group_name?: string;
  title: string;
  value: number;
  probability: number;
  expected_close_date?: string;
  status: 'open' | 'won' | 'lost' | 'paused';
  lost_reason?: string;
  loss_reason_id?: string;
  description?: string;
  tags?: string[];
  stage_name?: string;
  stage_color?: string;
  inactivity_hours?: number;
  inactivity_color?: string;
  pending_tasks: number;
  upcoming_meetings?: number;
  scheduled_messages?: number;
  project_count?: number;
  contacts?: CRMDealContact[];
  attachments?: DealAttachment[];
  last_activity_at: string;
  last_opened_at: string;
  custom_fields?: Record<string, any>;
  source?: string;
  created_at: string;
  automation_active?: boolean;
}


export interface CRMTask {
  id: string;
  deal_id?: string;
  company_id?: string;
  deal_title?: string;
  company_name?: string;
  assigned_to?: string;
  assigned_to_name?: string;
  created_by?: string;
  created_by_name?: string;
  title: string;
  description?: string;
  type: 'task' | 'call' | 'email' | 'meeting' | 'follow_up';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string;
  reminder_at?: string;
  reminder_minutes?: number;
  reminder_whatsapp?: boolean;
  reminder_popup?: boolean;
  reminder_sent?: boolean;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completed_at?: string;
  created_at: string;
}

export interface TaskCounts {
  today: number;
  week: number;
  month: number;
  overdue: number;
  pending: number;
  completed: number;
}

// Groups
export function useCRMGroups() {
  return useQuery({
    queryKey: ["crm-groups"],
    queryFn: async () => {
      return api<CRMGroup[]>("/api/crm/groups");
    },
  });
}

export function useCRMGroupMembers(groupId: string | null) {
  return useQuery({
    queryKey: ["crm-group-members", groupId],
    queryFn: async () => {
      if (!groupId) return [];
      return api<CRMGroupMember[]>(`/api/crm/groups/${groupId}/members`);
    },
    enabled: !!groupId,
  });
}

export function useCRMGroupMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createGroup = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      return api<CRMGroup>("/api/crm/groups", { method: "POST", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-groups"] });
      toast({ title: "Grupo criado com sucesso" });
    },
  });

  const updateGroup = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name: string; description?: string }) => {
      return api<CRMGroup>(`/api/crm/groups/${id}`, { method: "PUT", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-groups"] });
      toast({ title: "Grupo atualizado" });
    },
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/crm/groups/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-groups"] });
      toast({ title: "Grupo excluído" });
    },
  });

  const addMember = useMutation({
    mutationFn: async ({ groupId, userId, isSupervisor }: { groupId: string; userId: string; isSupervisor: boolean }) => {
      return api<CRMGroupMember>(`/api/crm/groups/${groupId}/members`, { 
        method: "POST", 
        body: { user_id: userId, is_supervisor: isSupervisor } 
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["crm-group-members", variables.groupId] });
      queryClient.invalidateQueries({ queryKey: ["crm-groups"] });
    },
  });

  const removeMember = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: string; userId: string }) => {
      return api<void>(`/api/crm/groups/${groupId}/members/${userId}`, { method: "DELETE" });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["crm-group-members", variables.groupId] });
      queryClient.invalidateQueries({ queryKey: ["crm-groups"] });
    },
  });

  return { createGroup, updateGroup, deleteGroup, addMember, removeMember };
}

// Group Funnels
export interface CRMGroupFunnel {
  funnel_id: string;
  name: string;
  color: string;
}

export function useCRMGroupFunnels(groupId: string | null) {
  return useQuery({
    queryKey: ["crm-group-funnels", groupId],
    queryFn: async () => {
      if (!groupId) return [];
      return api<CRMGroupFunnel[]>(`/api/crm/groups/${groupId}/funnels`);
    },
    enabled: !!groupId,
  });
}

export function useCRMGroupFunnelMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const setGroupFunnels = useMutation({
    mutationFn: async ({ groupId, funnelIds }: { groupId: string; funnelIds: string[] }) => {
      return api<void>(`/api/crm/groups/${groupId}/funnels`, { 
        method: "PUT", 
        body: { funnel_ids: funnelIds } 
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["crm-group-funnels", variables.groupId] });
      toast({ title: "Funis do grupo atualizados" });
    },
  });

  return { setGroupFunnels };
}

// Funnels
export function useCRMFunnels(all: boolean = false) {
  return useQuery({
    queryKey: ["crm-funnels", all],
    queryFn: async () => {
      return api<CRMFunnel[]>(`/api/crm/funnels${all ? '?all=true' : ''}`);
    },
  });
}

export function useCRMFunnel(id: string | null) {
  return useQuery({
    queryKey: ["crm-funnel", id],
    queryFn: async () => {
      if (!id) return null;
      return api<CRMFunnel & { stages: CRMStage[] }>(`/api/crm/funnels/${id}`);
    },
    enabled: !!id,
  });
}

export function useCRMFunnelMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createFunnel = useMutation({
    mutationFn: async (data: { name: string; description?: string; color?: string; stages?: Partial<CRMStage>[] }) => {
      return api<CRMFunnel>("/api/crm/funnels", { method: "POST", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-funnels"] });
      toast({ title: "Funil criado com sucesso" });
    },
  });

  const updateFunnel = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; description?: string; color?: string; is_active?: boolean; stages?: CRMStage[] }) => {
      return api<{ success: boolean }>(`/api/crm/funnels/${id}`, { method: "PUT", body: data });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["crm-funnels"] });
      queryClient.invalidateQueries({ queryKey: ["crm-funnel", variables.id] });
      toast({ title: "Funil atualizado" });
    },
  });

  const deleteFunnel = useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/crm/funnels/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-funnels"] });
      toast({ title: "Funil excluído" });
    },
  });

  return { createFunnel, updateFunnel, deleteFunnel };
}

// Companies
export function useCRMCompanies(search?: string) {
  return useQuery({
    queryKey: ["crm-companies", search],
    queryFn: async () => {
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
      return api<CRMCompany[]>(`/api/crm/companies${params}`);
    },
    staleTime: 30_000,
    retry: 2,
  });
}

export function useCRMCompany(id: string | null) {
  return useQuery({
    queryKey: ["crm-company", id],
    queryFn: async () => {
      if (!id) return null;
      return api<CRMCompany>(`/api/crm/companies/${id}`);
    },
    enabled: !!id,
  });
}

export function useCRMCompanyMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createCompany = useMutation({
    mutationFn: async (data: Partial<CRMCompany>) => {
      return api<CRMCompany>("/api/crm/companies", { method: "POST", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-companies"] });
      toast({ title: "Empresa criada com sucesso" });
    },
  });

  const updateCompany = useMutation({
    mutationFn: async ({ id, ...data }: Partial<CRMCompany> & { id: string }) => {
      return api<CRMCompany>(`/api/crm/companies/${id}`, { method: "PUT", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-companies"] });
      toast({ title: "Empresa atualizada" });
    },
  });

  const deleteCompany = useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/crm/companies/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-companies"] });
      toast({ title: "Empresa excluída" });
    },
  });

  const importCompanies = useMutation({
    mutationFn: async (companies: Partial<CRMCompany>[]) => {
      return api<{ success: boolean; imported: number }>("/api/crm/companies/import", { method: "POST", body: { companies } });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["crm-companies"] });
      toast({ title: `${data.imported} empresas importadas` });
    },
  });

  return { createCompany, updateCompany, deleteCompany, importCompanies };
}

// Deals
export function useCRMDealsSearch(search?: string) {
  return useQuery({
    queryKey: ["crm-deals-search", search],
    queryFn: async () => {
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
      return api<CRMDeal[]>(`/api/crm/deals${params}`);
    },
    enabled: !!search && search.length >= 2,
  });
}

// Get deals by contact phone (for chat integration)
export function useCRMDealsByPhone(phone: string | null | undefined) {
  return useQuery({
    queryKey: ["crm-deals-by-phone", phone],
    queryFn: async () => {
      if (!phone) return [];
      return api<CRMDeal[]>(`/api/crm/deals/by-phone/${encodeURIComponent(phone)}`);
    },
    enabled: !!phone && phone.length >= 8,
    staleTime: 30000, // Cache for 30 seconds
  });
}

export function useCRMDeals(funnelId: string | null) {
  return useQuery({
    queryKey: ["crm-deals", funnelId],
    queryFn: async () => {
      if (!funnelId) return {};
      return api<Record<string, CRMDeal[]>>(`/api/crm/funnels/${funnelId}/deals`);
    },
    enabled: !!funnelId,
  });
}

export function useCRMDeal(id: string | null) {
  return useQuery({
    queryKey: ["crm-deal", id],
    queryFn: async () => {
      if (!id) return null;
      return api<CRMDeal & { contacts: any[]; history: any[]; tasks: CRMTask[]; attachments: DealAttachment[] }>(`/api/crm/deals/${id}`);
    },
    enabled: !!id,
  });
}

export function useCRMDealMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createDeal = useMutation({
    mutationFn: async (data: Partial<CRMDeal> & { contact_ids?: string[] }) => {
      return api<CRMDeal>("/api/crm/deals", { method: "POST", body: data });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["crm-deals", variables.funnel_id] });
      toast({ title: "Negociação criada com sucesso" });
    },
  });

  const updateDeal = useMutation({
    mutationFn: async ({ id, ...data }: Partial<CRMDeal> & { id: string }) => {
      return api<CRMDeal>(`/api/crm/deals/${id}`, { method: "PUT", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-deals"] });
      queryClient.invalidateQueries({ queryKey: ["crm-deals-by-phone"] });
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
      toast({ title: "Negociação atualizada" });
    },
  });

  const moveDeal = useMutation({
    mutationFn: async ({ id, stage_id, over_deal_id }: { id: string; stage_id?: string; over_deal_id?: string }) => {
      return api<{ success: boolean; reordered?: boolean }>(`/api/crm/deals/${id}/move`, { 
        method: "POST", 
        body: { stage_id, over_deal_id } 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-deals"] });
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
    },
  });

  const addContact = useMutation({
    mutationFn: async ({ dealId, contactId, role, isPrimary }: { dealId: string; contactId: string; role?: string; isPrimary?: boolean }) => {
      return api<any>(`/api/crm/deals/${dealId}/contacts`, { method: "POST", body: { contact_id: contactId, role, is_primary: isPrimary } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
    },
  });

  const removeContact = useMutation({
    mutationFn: async ({ dealId, contactId }: { dealId: string; contactId: string }) => {
      return api<void>(`/api/crm/deals/${dealId}/contacts/${contactId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
    },
  });

  const bulkAction = useMutation({
    mutationFn: async (data: { action: string; deal_ids: string[]; target_funnel_id?: string; target_stage_id?: string; owner_id?: string; group_id?: string }) => {
      return api<{ success: boolean; affected: number }>("/api/crm/deals/bulk", { method: "POST", body: data });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["crm-deals"] });
      queryClient.invalidateQueries({ queryKey: ["crm-funnels"] });
      toast({ title: `${data.affected} negociação(ões) atualizadas` });
    },
  });

  const addAttachment = useMutation({
    mutationFn: async ({ dealId, ...data }: { dealId: string; name: string; url: string; mimetype?: string; size: number }) => {
      return api<DealAttachment>(`/api/crm/deals/${dealId}/attachments`, { method: "POST", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
    },
  });

  const removeAttachment = useMutation({
    mutationFn: async ({ dealId, attachmentId }: { dealId: string; attachmentId: string }) => {
      return api<void>(`/api/crm/deals/${dealId}/attachments/${attachmentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
    },
  });

  return { createDeal, updateDeal, moveDeal, addContact, removeContact, bulkAction, addAttachment, removeAttachment };
}

// Tasks
export function useCRMTasks(filters?: { 
  period?: string; 
  status?: string; 
  assigned_to?: string; 
  deal_id?: string;
  start_date?: string;
  end_date?: string;
  view_all?: boolean;
}) {
  const params = new URLSearchParams();
  if (filters?.period) params.append("period", filters.period);
  if (filters?.status) params.append("status", filters.status);
  if (filters?.assigned_to) params.append("assigned_to", filters.assigned_to);
  if (filters?.deal_id) params.append("deal_id", filters.deal_id);
  if (filters?.start_date) params.append("start_date", filters.start_date);
  if (filters?.end_date) params.append("end_date", filters.end_date);
  if (filters?.view_all) params.append("view_all", "true");

  return useQuery({
    queryKey: ["crm-tasks", filters],
    queryFn: async () => {
      return api<CRMTask[]>(`/api/crm/tasks?${params.toString()}`);
    },
  });
}

export function useCRMTaskCounts() {
  return useQuery({
    queryKey: ["crm-task-counts"],
    queryFn: async () => {
      return api<TaskCounts>("/api/crm/tasks/counts");
    },
  });
}

export function useCRMTaskMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createTask = useMutation({
    mutationFn: async (data: Partial<CRMTask>) => {
      return api<CRMTask>("/api/crm/tasks", { method: "POST", body: data });
    },
    onMutate: async (data) => {
      if (!data.deal_id) return;
      const key = ["crm-deal", data.deal_id];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<any>(key);
      if (previous) {
        const optimistic: any = {
          id: `temp-${Date.now()}`,
          status: "pending",
          created_at: new Date().toISOString(),
          ...data,
        };
        queryClient.setQueryData(key, {
          ...previous,
          tasks: [...(previous.tasks || []), optimistic],
        });
      }
      return { previous, key };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.previous && ctx?.key) queryClient.setQueryData(ctx.key, ctx.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["crm-task-counts"] });
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
      queryClient.invalidateQueries({ queryKey: ["task-cards"] });
      queryClient.invalidateQueries({ queryKey: ["task-boards"] });
      toast({ title: "Tarefa criada com sucesso" });
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, ...data }: Partial<CRMTask> & { id: string }) => {
      return api<CRMTask>(`/api/crm/tasks/${id}`, { method: "PUT", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["crm-task-counts"] });
      toast({ title: "Tarefa atualizada" });
    },
  });

  const completeTask = useMutation({
    mutationFn: async (id: string) => {
      return api<CRMTask>(`/api/crm/tasks/${id}/complete`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["crm-task-counts"] });
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
      queryClient.invalidateQueries({ queryKey: ["task-cards"] });
      queryClient.invalidateQueries({ queryKey: ["task-boards"] });
      toast({ title: "Tarefa concluída" });
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/crm/tasks/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["crm-task-counts"] });
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
      queryClient.invalidateQueries({ queryKey: ["task-cards"] });
      queryClient.invalidateQueries({ queryKey: ["task-boards"] });
      toast({ title: "Tarefa excluída" });
    },
  });

  return { createTask, updateTask, completeTask, deleteTask };
}
