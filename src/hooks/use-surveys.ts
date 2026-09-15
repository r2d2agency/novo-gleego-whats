import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ExternalForm, FormField } from "./use-external-forms";

export function useSurveys() {
  const queryClient = useQueryClient();

  const { data: surveys = [], isLoading } = useQuery({
    queryKey: ["surveys"],
    queryFn: () => api<ExternalForm[]>("/api/surveys"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["surveys"] });

  // Surveys are external_forms rows (display_mode: 'survey'). Create/update/delete
  // reuse the generic external-forms endpoints, which already handle field_key
  // correctly (the dedicated POST /api/surveys route has a bug that discards it).
  const createSurvey = useMutation({
    mutationFn: (data: Partial<ExternalForm> & { fields?: FormField[] }) =>
      api<ExternalForm>("/api/external-forms", { method: "POST", body: { ...data, display_mode: "survey" } }),
    onSuccess: () => {
      invalidate();
      toast.success("Pesquisa criada com sucesso!");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const updateSurvey = useMutation({
    mutationFn: ({ id, ...data }: Partial<ExternalForm> & { id: string; fields?: FormField[] }) =>
      api<ExternalForm>(`/api/external-forms/${id}`, { method: "PUT", body: data }),
    onSuccess: () => {
      invalidate();
      toast.success("Pesquisa atualizada!");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const deleteSurvey = useMutation({
    mutationFn: (id: string) => api(`/api/external-forms/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Pesquisa excluída!");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const getSurvey = async (id: string): Promise<ExternalForm | null> => {
    try {
      return await api<ExternalForm>(`/api/external-forms/${id}`);
    } catch {
      return null;
    }
  };

  return {
    surveys,
    isLoading,
    createSurvey,
    updateSurvey,
    deleteSurvey,
    getSurvey,
  };
}
