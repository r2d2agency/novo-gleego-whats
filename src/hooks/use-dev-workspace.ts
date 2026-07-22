import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "@/lib/api";
import { toast } from "sonner";

const base = "/api/dev-workspace";

export interface DevProject {
  id: string;
  organization_id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  status: string;
  portal_token: string;
  portal_enabled: boolean;
  cover_url: string | null;
  client_contact_id: string | null;
  total_tasks?: number;
  done_tasks?: number;
  next_due?: string | null;
  created_at: string;
  updated_at: string;
}
export interface DevModule { id: string; project_id: string; name: string; description: string | null; color: string; icon: string | null; position: number; }
export interface DevPhase { id: string; project_id: string; module_id: string | null; name: string; description: string | null; position: number; start_date: string | null; due_date: string | null; status: string; completed_at: string | null; }
export interface DevTask { id: string; project_id: string; module_id: string | null; phase_id: string | null; title: string; description: string | null; type: string; priority: string; status: string; source: string; client_note: string | null; ai_reasoning: string | null; due_date: string | null; completed_at: string | null; }
export interface DevTaskGlobal extends DevTask { project_name: string; phase_name: string | null; module_name: string | null; module_color: string | null; client_feedback?: string | null; client_feedback_note?: string | null; }
export interface DevKnowledge { id: string; title: string; kind: string; source_url: string | null; tokens: number; preview?: string; created_at: string; }
export interface DevGanttPhase extends DevPhase { module_name: string | null; module_color: string | null; deadline_status: "ok" | "warning" | "overdue"; }

// ===== Projects =====
export function useDevProjects() {
  return useQuery<DevProject[]>({ queryKey: ["dev-projects"], queryFn: () => api(`${base}/projects`, { auth: true }) });
}
export function useDevProject(id: string | null) {
  return useQuery<DevProject>({ queryKey: ["dev-project", id], queryFn: () => api(`${base}/projects/${id}`, { auth: true }), enabled: !!id });
}
export function useDevProjectMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["dev-projects"] });
  const create = useMutation({
    mutationFn: (data: Partial<DevProject>) => api(`${base}/projects`, { method: "POST", body: data, auth: true }),
    onSuccess: () => { inv(); toast.success("Projeto criado"); },
  });
  const update = useMutation({
    mutationFn: ({ id, ...rest }: { id: string } & Partial<DevProject>) =>
      api(`${base}/projects/${id}`, { method: "PATCH", body: rest, auth: true }),
    onSuccess: (_, v) => { inv(); qc.invalidateQueries({ queryKey: ["dev-project", v.id] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/projects/${id}`, { method: "DELETE", auth: true }),
    onSuccess: () => { inv(); toast.success("Projeto removido"); },
  });
  const regenToken = useMutation({
    mutationFn: (id: string) => api(`${base}/projects/${id}/regenerate-token`, { method: "POST", auth: true }),
    onSuccess: (_, id) => { inv(); qc.invalidateQueries({ queryKey: ["dev-project", id] }); toast.success("Novo link gerado"); },
  });
  return { create, update, remove, regenToken };
}

// ===== Modules =====
export function useDevModules(projectId: string | null) {
  return useQuery<DevModule[]>({ queryKey: ["dev-modules", projectId], queryFn: () => api(`${base}/projects/${projectId}/modules`, { auth: true }), enabled: !!projectId });
}
export function useDevModuleMutations(projectId: string | null) {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["dev-modules", projectId] });
  const create = useMutation({
    mutationFn: (data: Partial<DevModule>) => api(`${base}/projects/${projectId}/modules`, { method: "POST", body: data, auth: true }),
    onSuccess: () => inv(),
  });
  const update = useMutation({
    mutationFn: ({ id, ...rest }: { id: string } & Partial<DevModule>) => api(`${base}/modules/${id}`, { method: "PATCH", body: rest, auth: true }),
    onSuccess: () => inv(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/modules/${id}`, { method: "DELETE", auth: true }),
    onSuccess: () => inv(),
  });
  return { create, update, remove };
}

// ===== Phases =====
export function useDevPhases(projectId: string | null) {
  return useQuery<DevPhase[]>({ queryKey: ["dev-phases", projectId], queryFn: () => api(`${base}/projects/${projectId}/phases`, { auth: true }), enabled: !!projectId });
}
export function useDevPhaseMutations(projectId: string | null) {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["dev-phases", projectId] });
    qc.invalidateQueries({ queryKey: ["dev-gantt", projectId] });
  };
  const create = useMutation({
    mutationFn: (data: Partial<DevPhase>) => api(`${base}/projects/${projectId}/phases`, { method: "POST", body: data, auth: true }),
    onSuccess: () => inv(),
  });
  const update = useMutation({
    mutationFn: ({ id, ...rest }: { id: string } & Partial<DevPhase>) => api(`${base}/phases/${id}`, { method: "PATCH", body: rest, auth: true }),
    onSuccess: () => inv(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/phases/${id}`, { method: "DELETE", auth: true }),
    onSuccess: () => inv(),
  });
  return { create, update, remove };
}

// ===== Tasks =====
export function useDevTasks(projectId: string | null) {
  return useQuery<DevTask[]>({ queryKey: ["dev-tasks", projectId], queryFn: () => api(`${base}/projects/${projectId}/tasks`, { auth: true }), enabled: !!projectId });
}

// ===== Global tasks (kanban across projects) =====
export function useDevAllTasks() {
  return useQuery<DevTaskGlobal[]>({
    queryKey: ["dev-tasks-all"],
    queryFn: () => api(`${base}/tasks-all`, { auth: true }),
    refetchInterval: 30000,
  });
}

export function useDevTaskStatusMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`${base}/tasks/${id}`, { method: "PATCH", body: { status }, auth: true }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["dev-tasks-all"] });
      qc.invalidateQueries({ queryKey: ["dev-tasks"] });
      toast.success("Etapa atualizada");
    },
    onError: (e: any) => toast.error(e?.message || "Falha ao atualizar"),
  });
}

export function useDevTaskMutations(projectId: string | null) {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["dev-tasks", projectId] });
  const create = useMutation({
    mutationFn: (data: Partial<DevTask>) => api(`${base}/projects/${projectId}/tasks`, { method: "POST", body: data, auth: true }),
    onSuccess: () => inv(),
  });
  const update = useMutation({
    mutationFn: ({ id, ...rest }: { id: string } & Partial<DevTask>) => api(`${base}/tasks/${id}`, { method: "PATCH", body: rest, auth: true }),
    onSuccess: () => inv(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/tasks/${id}`, { method: "DELETE", auth: true }),
    onSuccess: () => inv(),
  });
  return { create, update, remove };
}

// ===== Knowledge =====
export function useDevKnowledge(projectId: string | null) {
  return useQuery<DevKnowledge[]>({ queryKey: ["dev-knowledge", projectId], queryFn: () => api(`${base}/projects/${projectId}/knowledge`, { auth: true }), enabled: !!projectId });
}
export function useDevKnowledgeMutations(projectId: string | null) {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["dev-knowledge", projectId] });
  const create = useMutation({
    mutationFn: (data: { title: string; content: string; kind?: string; source_url?: string }) =>
      api(`${base}/projects/${projectId}/knowledge`, { method: "POST", body: data, auth: true }),
    onSuccess: () => { inv(); toast.success("Documento indexado no cérebro"); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/knowledge/${id}`, { method: "DELETE", auth: true }),
    onSuccess: () => inv(),
  });
  return { create, remove };
}

// ===== AI =====
export function useDevAI(projectId: string | null) {
  const qc = useQueryClient();
  const breakdown = useMutation({
    mutationFn: (data: { briefing: string; extra_context?: string }) =>
      api<{ modules: any[] }>(`${base}/projects/${projectId}/ai/breakdown`, { method: "POST", body: data, auth: true, timeoutMs: 120000 }),
  });
  const applyBreakdown = useMutation({
    mutationFn: (data: { modules: any[] }) =>
      api(`${base}/projects/${projectId}/ai/apply-breakdown`, { method: "POST", body: data, auth: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dev-modules", projectId] });
      qc.invalidateQueries({ queryKey: ["dev-phases", projectId] });
      qc.invalidateQueries({ queryKey: ["dev-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["dev-gantt", projectId] });
      toast.success("Estrutura aplicada");
    },
  });
  const classify = useMutation({
    mutationFn: (data: { text: string; create?: boolean }) =>
      api<{ classification: any; task?: any }>(`${base}/projects/${projectId}/ai/classify-demand`, { method: "POST", body: data, auth: true, timeoutMs: 60000 }),
    onSuccess: (_, v) => { if (v.create) qc.invalidateQueries({ queryKey: ["dev-tasks", projectId] }); },
  });
  const ask = useMutation({
    mutationFn: (data: { question: string }) =>
      api<{ answer: string }>(`${base}/projects/${projectId}/ai/ask`, { method: "POST", body: data, auth: true, timeoutMs: 60000 }),
  });
  const roadmap = useMutation({
    mutationFn: () => api<{ markdown: string }>(`${base}/projects/${projectId}/ai/roadmap`, { method: "POST", auth: true, timeoutMs: 120000 }),
  });
  return { breakdown, applyBreakdown, classify, ask, roadmap };
}

// ===== Gantt =====
export function useDevGantt(projectId: string | null) {
  return useQuery<{ phases: DevGanttPhase[] }>({
    queryKey: ["dev-gantt", projectId],
    queryFn: () => api(`${base}/projects/${projectId}/gantt`, { auth: true }),
    enabled: !!projectId,
  });
}

// ===== Public portal =====
export function useDevPortal(token: string | undefined) {
  return useQuery<any>({
    queryKey: ["dev-portal", token],
    queryFn: async () => {
      const r = await fetch(`${API_URL}${base}/portal/${token}`);
      if (!r.ok) throw new Error("Portal não encontrado");
      return r.json();
    },
    enabled: !!token,
    retry: false,
  });
}

export async function submitPortalRequest(token: string, data: { title: string; description?: string; contact_email?: string }) {
  const r = await fetch(`${API_URL}${base}/portal/${token}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error("Falha ao enviar pedido");
  return r.json();
}

export async function submitPortalFeedback(
  token: string,
  taskId: string,
  data: { feedback: "approved" | "needs_changes"; note?: string }
) {
  const r = await fetch(`${API_URL}${base}/portal/${token}/tasks/${taskId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error("Falha ao enviar feedback");
  return r.json();
}