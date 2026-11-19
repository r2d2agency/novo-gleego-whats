import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// Types
export interface CRMTaskType {
  id: string;
  organization_id?: string;
  name: string;
  icon: string;
  color: string;
  is_global: boolean;
  is_active: boolean;
  position: number;
  created_at: string;
}

export interface CRMSegment {
  id: string;
  organization_id?: string;
  name: string;
  color: string;
  description?: string;
  is_global: boolean;
  is_active: boolean;
  position: number;
  deals_count?: number;
  created_at: string;
}

export interface CRMCustomField {
  id: string;
  organization_id?: string;
  entity_type: 'deal' | 'company' | 'task';
  field_name: string;
  field_label: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean';
  options?: string[];
  is_required: boolean;
  is_global: boolean;
  is_active: boolean;
  position: number;
  created_at: string;
}

// Task Types
export function useCRMTaskTypes() {
  return useQuery({
    queryKey: ["crm-task-types"],
    queryFn: async () => {
      return api<CRMTaskType[]>("/api/crm/config/task-types");
    },
  });
}

export function useCRMTaskTypeMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createTaskType = useMutation({
    mutationFn: async (data: Partial<CRMTaskType>) => {
      return api<CRMTaskType>("/api/crm/config/task-types", { method: "POST", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-task-types"] });
      toast({ title: "Tipo de tarefa criado" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao criar tipo", description: error.message, variant: "destructive" });
    },
  });

  const updateTaskType = useMutation({
    mutationFn: async ({ id, ...data }: Partial<CRMTaskType> & { id: string }) => {
      return api<CRMTaskType>(`/api/crm/config/task-types/${id}`, { method: "PUT", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-task-types"] });
      toast({ title: "Tipo de tarefa atualizado" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao atualizar tipo", description: error.message, variant: "destructive" });
    },
  });

  const deleteTaskType = useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/crm/config/task-types/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-task-types"] });
      toast({ title: "Tipo de tarefa excluído" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao excluir tipo", description: error.message, variant: "destructive" });
    },
  });

  const cleanupDuplicates = useMutation({
    mutationFn: async () => {
      return api<{ success: boolean; deleted_count: number }>("/api/crm/config/task-types/cleanup", { method: "POST" });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["crm-task-types"] });
      toast({ title: "Limpeza concluída", description: `${data.deleted_count} tipo(s) duplicado(s) removido(s)` });
    },
    onError: (error: any) => {
      toast({ title: "Erro na limpeza", description: error.message, variant: "destructive" });
    },
  });

  return { createTaskType, updateTaskType, deleteTaskType, cleanupDuplicates };
}

// Segments
export function useCRMSegments() {
  return useQuery({
    queryKey: ["crm-segments"],
    queryFn: async () => {
      return api<CRMSegment[]>("/api/crm/config/segments");
    },
  });
}

export function useCRMSegmentMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createSegment = useMutation({
    mutationFn: async (data: Partial<CRMSegment>) => {
      return api<CRMSegment>("/api/crm/config/segments", { method: "POST", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-segments"] });
      toast({ title: "Segmento criado" });
    },
  });

  const updateSegment = useMutation({
    mutationFn: async ({ id, ...data }: Partial<CRMSegment> & { id: string }) => {
      return api<CRMSegment>(`/api/crm/config/segments/${id}`, { method: "PUT", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-segments"] });
      toast({ title: "Segmento atualizado" });
    },
  });

  const deleteSegment = useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/crm/config/segments/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-segments"] });
      toast({ title: "Segmento excluído" });
    },
  });

  const addSegmentToDeal = useMutation({
    mutationFn: async ({ dealId, segmentId }: { dealId: string; segmentId: string }) => {
      return api<any>(`/api/crm/deals/${dealId}/segments`, { method: "POST", body: { segment_id: segmentId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
    },
  });

  const removeSegmentFromDeal = useMutation({
    mutationFn: async ({ dealId, segmentId }: { dealId: string; segmentId: string }) => {
      return api<void>(`/api/crm/deals/${dealId}/segments/${segmentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
    },
  });

  return { createSegment, updateSegment, deleteSegment, addSegmentToDeal, removeSegmentFromDeal };
}

// Custom Fields
export function useCRMCustomFields(entityType?: string) {
  return useQuery({
    queryKey: ["crm-custom-fields", entityType],
    queryFn: async () => {
      const params = entityType ? `?entity_type=${entityType}` : "";
      return api<CRMCustomField[]>(`/api/crm/config/custom-fields${params}`);
    },
  });
}

export function useCRMCustomFieldMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createCustomField = useMutation({
    mutationFn: async (data: Partial<CRMCustomField>) => {
      return api<CRMCustomField>("/api/crm/config/custom-fields", { method: "POST", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-custom-fields"] });
      toast({ title: "Campo personalizado criado" });
    },
  });

  const updateCustomField = useMutation({
    mutationFn: async ({ id, ...data }: Partial<CRMCustomField> & { id: string }) => {
      return api<CRMCustomField>(`/api/crm/config/custom-fields/${id}`, { method: "PUT", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-custom-fields"] });
      toast({ title: "Campo atualizado" });
    },
  });

  const deleteCustomField = useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/crm/config/custom-fields/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-custom-fields"] });
      toast({ title: "Campo excluído" });
    },
  });

  return { createCustomField, updateCustomField, deleteCustomField };
}

// Loss Reasons
export interface CRMLossReason {
  id: string;
  organization_id?: string;
  name: string;
  description?: string;
  is_active: boolean;
  position: number;
  usage_count: number;
  created_at: string;
}

export function useCRMLossReasons() {
  return useQuery({
    queryKey: ["crm-loss-reasons"],
    queryFn: async () => {
      return api<CRMLossReason[]>("/api/crm/config/loss-reasons");
    },
  });
}

export function useCRMLossReasonMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createLossReason = useMutation({
    mutationFn: async (data: Partial<CRMLossReason>) => {
      return api<CRMLossReason>("/api/crm/config/loss-reasons", { method: "POST", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-loss-reasons"] });
      toast({ title: "Motivo de perda criado" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao criar motivo", description: error.message, variant: "destructive" });
    },
  });

  const updateLossReason = useMutation({
    mutationFn: async ({ id, ...data }: Partial<CRMLossReason> & { id: string }) => {
      return api<CRMLossReason>(`/api/crm/config/loss-reasons/${id}`, { method: "PUT", body: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-loss-reasons"] });
      toast({ title: "Motivo atualizado" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao atualizar motivo", description: error.message, variant: "destructive" });
    },
  });

  const deleteLossReason = useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/api/crm/config/loss-reasons/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-loss-reasons"] });
      toast({ title: "Motivo excluído" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao excluir motivo", description: error.message, variant: "destructive" });
    },
  });

  const resetToDefaults = useMutation({
    mutationFn: async () => {
      return api<CRMLossReason[]>("/api/crm/config/loss-reasons/reset-defaults", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-loss-reasons"] });
      toast({ title: "Motivos resetados para padrão" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao resetar motivos", description: error.message, variant: "destructive" });
    },
  });

  const cleanupDuplicates = useMutation({
    mutationFn: async () => {
      return api<{ success: boolean; deleted_count: number }>("/api/crm/config/loss-reasons/cleanup", { method: "POST" });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["crm-loss-reasons"] });
      toast({ title: "Limpeza concluída", description: `${data.deleted_count} motivo(s) duplicado(s) removido(s)` });
    },
    onError: (error: any) => {
      toast({ title: "Erro na limpeza", description: error.message, variant: "destructive" });
    },
  });

  return { createLossReason, updateLossReason, deleteLossReason, resetToDefaults, cleanupDuplicates };
}

// Lead Sources (Origens)
export interface CRMLeadSource {
  id: string;
  organization_id?: string;
  name: string;
  color: string;
  is_active: boolean;
  position: number;
  deals_count?: number;
  created_at: string;
}

export function useCRMLeadSources() {
  return useQuery({
    queryKey: ["crm-lead-sources"],
    queryFn: async () => api<CRMLeadSource[]>("/api/crm/config/lead-sources"),
  });
}

export function useCRMLeadSourceMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createLeadSource = useMutation({
    mutationFn: async (data: Partial<CRMLeadSource>) =>
      api<CRMLeadSource>("/api/crm/config/lead-sources", { method: "POST", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-sources"] });
      toast({ title: "Origem criada" });
    },
    onError: (e: any) => toast({ title: "Erro ao criar origem", description: e.message, variant: "destructive" }),
  });

  const updateLeadSource = useMutation({
    mutationFn: async ({ id, ...data }: Partial<CRMLeadSource> & { id: string }) =>
      api<CRMLeadSource>(`/api/crm/config/lead-sources/${id}`, { method: "PUT", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-sources"] });
      toast({ title: "Origem atualizada" });
    },
  });

  const deleteLeadSource = useMutation({
    mutationFn: async (id: string) =>
      api<void>(`/api/crm/config/lead-sources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-sources"] });
      toast({ title: "Origem excluída" });
    },
  });

  return { createLeadSource, updateLeadSource, deleteLeadSource };
}

// CRM Catalog
export interface CRMCatalogCategory {
  id: string;
  organization_id?: string;
  name: string;
  description?: string;
  is_active: boolean;
  position: number;
  items_count?: number;
  created_at: string;
}

export interface CRMCatalogItem {
  id: string;
  organization_id?: string;
  category_id?: string | null;
  category_name?: string;
  type: 'product' | 'service';
  name: string;
  code?: string;
  description?: string;
  unit: string;
  recurrence: 'one_time' | 'monthly' | 'yearly';
  unit_price: number;
  is_active: boolean;
  external_id?: string;
  external_source?: string;
  created_at: string;
}

export interface CRMDealItem {
  id: string;
  organization_id?: string;
  deal_id: string;
  catalog_item_id?: string | null;
  category_name?: string;
  item_type: 'product' | 'service';
  name: string;
  code?: string;
  description?: string;
  unit: string;
  recurrence: 'one_time' | 'monthly' | 'yearly';
  quantity: number;
  unit_price: number;
  discount_percent: number;
  external_id?: string;
  external_source?: string;
  created_at: string;
}

export interface CRMProposalItem {
  id: string;
  proposal_id: string;
  deal_item_id?: string;
  category_name?: string;
  item_type: 'product' | 'service';
  name: string;
  code?: string;
  description?: string;
  unit: string;
  recurrence: 'one_time' | 'monthly' | 'yearly';
  quantity: number;
  unit_price: number;
  discount_percent: number;
  total: number;
  position: number;
}

export interface CRMProposalTemplate {
  id: string;
  organization_id?: string;
  logo_url?: string | null;
  header_text?: string | null;
  description?: string | null;
  footer_text?: string | null;
  created_at: string;
}

export interface CRMProposal {
  id: string;
  organization_id?: string;
  deal_id: string;
  number: string;
  title: string;
  template_logo_url?: string | null;
  template_header_text?: string | null;
  template_description?: string | null;
  template_footer_text?: string | null;
  requires_signature?: boolean;
  signature_image?: string | null;
  signed_at?: string | null;
  opened_at?: string | null;
  opened_count?: number;
  customer_name?: string;
  customer_document?: string;
  customer_email?: string;
  customer_phone?: string;
  notes?: string;
  payment_terms?: string;
  payment_method?: string | null;
  validity_days: number;
  discount_percent: number;
  subtotal: number;
  discount_amount: number;
  total: number;
  status: 'draft' | 'sent' | 'approved' | 'rejected';
  public_token: string;
  sent_at?: string;
  decided_at?: string;
  decision_notes?: string;
  created_at: string;
  items?: CRMProposalItem[];
}

export function useCRMCatalogCategories() {
  return useQuery({
    queryKey: ["crm-catalog-categories"],
    queryFn: () => api<CRMCatalogCategory[]>("/api/crm/catalog/categories"),
  });
}

export function useCRMCatalogItems() {
  return useQuery({
    queryKey: ["crm-catalog-items"],
    queryFn: () => api<CRMCatalogItem[]>("/api/crm/catalog/items"),
  });
}

export function useCRMCatalogMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["crm-catalog-categories"] });
    queryClient.invalidateQueries({ queryKey: ["crm-catalog-items"] });
  };

  const createCategory = useMutation({
    mutationFn: (data: Partial<CRMCatalogCategory>) => api<CRMCatalogCategory>("/api/crm/catalog/categories", { method: "POST", body: data }),
    onSuccess: () => { invalidate(); toast({ title: "Categoria criada" }); },
    onError: (e: any) => toast({ title: "Erro ao criar categoria", description: e.message, variant: "destructive" }),
  });
  const updateCategory = useMutation({
    mutationFn: ({ id, ...data }: Partial<CRMCatalogCategory> & { id: string }) => api<CRMCatalogCategory>(`/api/crm/catalog/categories/${id}`, { method: "PUT", body: data }),
    onSuccess: () => { invalidate(); toast({ title: "Categoria atualizada" }); },
  });
  const deleteCategory = useMutation({
    mutationFn: (id: string) => api<void>(`/api/crm/catalog/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Categoria excluída" }); },
    onError: (e: any) => toast({ title: "Erro ao excluir categoria", description: e.message, variant: "destructive" }),
  });
  const createItem = useMutation({
    mutationFn: (data: Partial<CRMCatalogItem>) => api<CRMCatalogItem>("/api/crm/catalog/items", { method: "POST", body: data }),
    onSuccess: () => { invalidate(); toast({ title: "Item criado" }); },
    onError: (e: any) => toast({ title: "Erro ao criar item", description: e.message, variant: "destructive" }),
  });
  const updateItem = useMutation({
    mutationFn: ({ id, ...data }: Partial<CRMCatalogItem> & { id: string }) => api<CRMCatalogItem>(`/api/crm/catalog/items/${id}`, { method: "PUT", body: data }),
    onSuccess: () => { invalidate(); toast({ title: "Item atualizado" }); },
  });
  const deleteItem = useMutation({
    mutationFn: (id: string) => api<void>(`/api/crm/catalog/items/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Item excluído" }); },
  });

  return { createCategory, updateCategory, deleteCategory, createItem, updateItem, deleteItem };
}

export function useDealItems(dealId: string | null) {
  return useQuery({
    queryKey: ["crm-deal-items", dealId],
    queryFn: () => api<CRMDealItem[]>(`/api/crm/deals/${dealId}/items`),
    enabled: !!dealId,
  });
}

export function useDealItemMutations(dealId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["crm-deal-items", dealId] });
    queryClient.invalidateQueries({ queryKey: ["crm-deal"] });
  };

  const addItem = useMutation({
    mutationFn: (data: { catalog_item_id: string; quantity: number; unit_price: number; discount_percent?: number }) =>
      api<CRMDealItem>(`/api/crm/deals/${dealId}/items`, { method: "POST", body: data }),
    onSuccess: () => { invalidate(); toast({ title: "Item adicionado" }); },
    onError: (e: any) => toast({ title: "Erro ao adicionar item", description: e.message, variant: "destructive" }),
  });
  const updateItem = useMutation({
    mutationFn: ({ id, ...data }: { id: string; quantity: number; unit_price: number; discount_percent: number }) =>
      api<CRMDealItem>(`/api/crm/deals/${dealId}/items/${id}`, { method: "PUT", body: data }),
    onSuccess: () => invalidate(),
  });
  const removeItem = useMutation({
    mutationFn: (id: string) => api<void>(`/api/crm/deals/${dealId}/items/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Item removido" }); },
  });

  return { addItem, updateItem, removeItem };
}

export function useProposalTemplate() {
  return useQuery({
    queryKey: ["crm-proposal-template"],
    queryFn: () => api<CRMProposalTemplate | null>("/api/crm/proposal-template"),
  });
}

export function useProposalTemplateMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: Partial<CRMProposalTemplate>) =>
      api<CRMProposalTemplate>("/api/crm/proposal-template", { method: "PUT", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-proposal-template"] });
      toast({ title: "Modelo de proposta salvo" });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar modelo", description: e.message, variant: "destructive" }),
  });
}

export function useDealProposals(dealId: string | null) {
  return useQuery({
    queryKey: ["crm-deal-proposals", dealId],
    queryFn: () => api<CRMProposal[]>(`/api/crm/deals/${dealId}/proposals`),
    enabled: !!dealId,
  });
}

export function useProposalMutations(dealId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["crm-deal-proposals", dealId] });

  const createProposal = useMutation({
    mutationFn: (data: Partial<CRMProposal>) => api<CRMProposal>(`/api/crm/deals/${dealId}/proposals`, { method: "POST", body: data }),
    onSuccess: () => { invalidate(); toast({ title: "Proposta criada" }); },
    onError: (e: any) => toast({ title: "Erro ao criar proposta", description: e.message, variant: "destructive" }),
  });
  const updateProposal = useMutation({
    mutationFn: ({ id, ...data }: Partial<CRMProposal> & { id: string }) =>
      api<CRMProposal>(`/api/crm/deals/${dealId}/proposals/${id}`, { method: "PUT", body: data }),
    onSuccess: () => { invalidate(); toast({ title: "Proposta atualizada" }); },
    onError: (e: any) => toast({ title: "Erro ao salvar proposta", description: e.message, variant: "destructive" }),
  });
  const deleteProposal = useMutation({
    mutationFn: (id: string) => api<void>(`/api/crm/deals/${dealId}/proposals/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Proposta excluída" }); },
    onError: (e: any) => toast({ title: "Erro ao excluir proposta", description: e.message, variant: "destructive" }),
  });
  const sendProposal = useMutation({
    mutationFn: ({ id, requires_signature }: { id: string; requires_signature: boolean }) =>
      api<CRMProposal>(`/api/crm/deals/${dealId}/proposals/${id}/send`, { method: "POST", body: { requires_signature } }),
    onSuccess: () => { invalidate(); toast({ title: "Proposta enviada" }); },
    onError: (e: any) => toast({ title: "Erro ao enviar proposta", description: e.message, variant: "destructive" }),
  });

  return { createProposal, updateProposal, deleteProposal, sendProposal };
}
