import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useSurveyResults(surveyId: string) {
  return useQuery({
    queryKey: ["survey-results", surveyId],
    queryFn: () => api<any[]>(`/api/survey-results/${surveyId}/stats`),
    enabled: !!surveyId,
  });
}