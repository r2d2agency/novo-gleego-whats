import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

export interface FormField {
  id?: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "phone" | "email" | "select" | "textarea";
  placeholder?: string;
  is_required: boolean;
  validation_regex?: string;
  options?: string[];
  position?: number;
}

export interface ExternalForm {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description?: string;
  is_active: boolean;
  
  // Branding
  logo_url?: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  button_text: string;
  logo_size?: number;
  welcome_message: string;
  
  // Post-submission
  thank_you_message: string;
  redirect_url?: string;
  trigger_flow_id?: string;
  connection_id?: string;
  display_mode?: "chat" | "typeform" | "standard";
  transition_type?: "slide-right" | "slide-left";
  
  // Stats
  views_count: number;
  submissions_count: number;
  field_count?: number;
  organization_name?: string;
  
  // Relations
  fields?: FormField[];
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  data: Record<string, string>;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  prospect_id?: string;
  prospect_name?: string;
  prospect_converted_at?: string;
  created_at: string;
}

export function useExternalForms() {
  const queryClient = useQueryClient();

  const { data: forms = [], isLoading, error } = useQuery({
    queryKey: ["external-forms"],
    queryFn: () => api<ExternalForm[]>("/api/external-forms"),
  });

  const getForm = async (id: string): Promise<ExternalForm | null> => {
    try {
      return await api<ExternalForm>(`/api/external-forms/${id}`);
    } catch {
      return null;
    }
  };

  const createForm = useMutation({
    mutationFn: (data: Partial<ExternalForm> & { fields?: FormField[] }) =>
      api<ExternalForm>("/api/external-forms", { method: "POST", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["external-forms"] });
      toast.success("Formulário criado com sucesso!");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const updateForm = useMutation({
    mutationFn: ({ id, ...data }: Partial<ExternalForm> & { id: string; fields?: FormField[] }) =>
      api<ExternalForm>(`/api/external-forms/${id}`, { method: "PUT", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["external-forms"] });
      toast.success("Formulário atualizado!");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const deleteForm = useMutation({
    mutationFn: (id: string) =>
      api(`/api/external-forms/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["external-forms"] });
      toast.success("Formulário excluído!");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const getSubmissions = async (formId: string): Promise<FormSubmission[]> => {
    try {
      return await api<FormSubmission[]>(`/api/external-forms/${formId}/submissions`);
    } catch {
      return [];
    }
  };

  return {
    forms,
    isLoading,
    error,
    getForm,
    createForm,
    updateForm,
    deleteForm,
    getSubmissions,
  };
}

// Public API (no auth). Tries configured API URL first, then falls back to current origin
// for deployments where the backend is served from the same domain via proxy.
export async function getPublicForm(slug: string): Promise<ExternalForm | null> {
  const baseUrls = [import.meta.env.VITE_API_URL || "", window.location.origin].filter(Boolean);
  const uniqueUrls = Array.from(new Set(baseUrls));

  for (const base of uniqueUrls) {
    try {
      const url = `${base.replace(/\/$/, "")}/api/external-forms/public/${slug}`;
      console.log(`[getPublicForm] Trying ${url}`);
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return res.json();
      console.warn(`[getPublicForm] Failed ${url}: ${res.status}`);
    } catch (err) {
      console.error(`[getPublicForm] Error fetching from ${base}:`, err);
    }
  }
  return null;
}

export async function submitPublicForm(
  slug: string,
  data: Record<string, string>,
  meta?: { utm_source?: string; utm_medium?: string; utm_campaign?: string; referrer?: string }
): Promise<{ success: boolean; thank_you_message?: string; redirect_url?: string }> {
  const baseUrls = [import.meta.env.VITE_API_URL || "", window.location.origin].filter(Boolean);
  const uniqueUrls = Array.from(new Set(baseUrls));
  let lastError: Error | null = null;

  for (const base of uniqueUrls) {
    try {
      const res = await fetch(`${base}/api/external-forms/public/${slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, ...meta }),
      });
      if (res.ok) return res.json();
      const err = await res.json().catch(() => ({ error: "Erro ao enviar formulário" }));
      lastError = new Error(err.error || "Erro ao enviar formulário");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError || new Error("Erro ao enviar formulário");
}
