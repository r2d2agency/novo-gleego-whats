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

  const createSurvey = useMutation({
    mutationFn: (data: Partial<ExternalForm> & { fields?: FormField[] }) =>
      api<ExternalForm>("/api/surveys", { method: "POST", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["surveys"] });
      toast.success("Pesquisa criada com sucesso!");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return {
    surveys,
    isLoading,
    createSurvey,
  };
}
