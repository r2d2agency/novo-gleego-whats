import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "@/lib/api";
import { toast } from "sonner";

export interface FormField {
  id?: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "phone" | "whatsapp" | "email" | "select" | "textarea" | "rating_stars";
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
  button_text_color?: string;
  field_background_color?: string;
  field_border_color?: string;
  field_text_color?: string;
  label_color?: string;
  logo_size?: number;
  welcome_message: string;
  
  // Post-submission
  thank_you_message: string;
  redirect_url?: string;
  trigger_flow_id?: string;
  connection_id?: string;
  lead_target?: "prospect" | "crm";
  crm_funnel_id?: string;
  use_round_robin?: boolean;
  round_robin_user_ids?: string[];
  display_mode?: "chat" | "typeform" | "standard" | "survey";
  transition_type?: "slide-right" | "slide-left";

  // Referral ("indicação")
  referral_enabled?: boolean;
  referral_message?: string;

  // Post-submit redirect delay (seconds) and ad-tracking pixels
  redirect_delay_seconds?: number;
  fb_pixel_id?: string;
  google_ads_conversion_id?: string;
  google_ads_conversion_label?: string;

  // Optional per-seller welcome flow for the round robin: {user_id: flow_id}
  round_robin_user_flows?: Record<string, string>;

  // Template for the CRM deal title, e.g. "{name} - {city}". Falls back to
  // name/phone when empty.
  deal_title_template?: string;

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
  deal_id?: string;
  funnel_name?: string;
  stage_name?: string;
  deal_owner_name?: string;
  routing_error?: string;
  referrals?: { name: string; phone: string }[];
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

  const duplicateForm = useMutation({
    mutationFn: (id: string) =>
      api<ExternalForm>(`/api/external-forms/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["external-forms"] });
      toast.success("Formulário duplicado com sucesso!");
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
    duplicateForm,
    getSubmissions,
  };
}

// Public API (no auth). Tries configured API URL first, then falls back to current origin
// for deployments where the backend is served from the same domain via proxy.
export async function getPublicForm(slug: string): Promise<ExternalForm | null> {
  const baseUrls = [API_URL, window.location.origin].filter(Boolean);
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

// Checks whether a phone number is a real, registered WhatsApp account
// (not just format) using the form's own connection, resolved server-side.
// `checked: false` means the provider can't really verify (e.g. Meta Cloud
// API) — callers should not block the visitor in that case.
export async function validatePublicPhone(
  slug: string,
  phone: string
): Promise<{ valid: boolean; checked: boolean }> {
  const baseUrls = [API_URL, window.location.origin].filter(Boolean);
  const uniqueUrls = Array.from(new Set(baseUrls));

  for (const base of uniqueUrls) {
    try {
      const res = await fetch(`${base}/api/external-forms/public/${slug}/validate-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (res.ok) return res.json();
    } catch {
      // try next base
    }
  }
  // Infra hiccup on our side -- never block the visitor over it.
  return { valid: true, checked: false };
}

export async function submitPublicForm(
  slug: string,
  data: Record<string, string>,
  meta?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    referrer?: string;
    referrals?: { name: string; phone: string }[];
  }
): Promise<{ success: boolean; thank_you_message?: string; redirect_url?: string; redirect_delay_seconds?: number }> {
  const baseUrls = [API_URL, window.location.origin].filter(Boolean);
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
