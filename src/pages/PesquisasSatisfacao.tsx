import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, MessageSquare, Copy, ExternalLink, Sparkles, Star, Pencil, Trash2, Download, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { useSurveys } from "@/hooks/use-surveys";
import { toast } from "sonner";
import { SurveyWizard } from "@/components/surveys/SurveyWizard";
import { SurveyTemplateGallery } from "@/components/surveys/SurveyTemplateGallery";
import { SurveyTemplate } from "@/components/surveys/survey-templates";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSurveyResults } from "@/hooks/use-survey-results";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExternalForm, FormField } from "@/hooks/use-external-forms";

type WizardInitialData = (Partial<ExternalForm> & { fields?: FormField[] }) | SurveyTemplate | null;

function csvEscape(val: unknown) {
  const s = String(val ?? "");
  return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function PesquisasSatisfacao() {
  const [search, setSearch] = useState("");
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [wizardInitialData, setWizardInitialData] = useState<WizardInitialData>(null);
  // Tracks whether the wizard is editing a real survey (a UUID from the DB) —
  // kept separate from wizardInitialData.id because a SurveyTemplate also has
  // an `id` (a slug like "evento"), which must never be sent as a survey id.
  const [editingSurveyId, setEditingSurveyId] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [surveyToDelete, setSurveyToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { surveys, isLoading, createSurvey, updateSurvey, deleteSurvey, getSurvey } = useSurveys();

  const handleCopyLink = (slug: string) => {
    const url = `${window.location.origin}/f/${slug}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url);
      toast.success("Link da pesquisa copiado!");
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        toast.success("Link da pesquisa copiado!");
      } catch (err) {
        toast.error("Não foi possível copiar o link.");
      }
      document.body.removeChild(textArea);
    }
  };

  const handleNewBlank = () => {
    setEditingSurveyId(null);
    setWizardInitialData(null);
    setIsWizardOpen(true);
  };

  const handleSelectTemplate = (template: SurveyTemplate | null) => {
    setIsLibraryOpen(false);
    setEditingSurveyId(null);
    setWizardInitialData(template);
    setIsWizardOpen(true);
  };

  const handleEditSurvey = async (survey: any) => {
    setLoadingEdit(true);
    try {
      const full = await getSurvey(survey.id);
      if (!full) {
        toast.error("Não foi possível carregar a pesquisa");
        return;
      }
      setEditingSurveyId(survey.id);
      setWizardInitialData(full);
      setIsWizardOpen(true);
    } finally {
      setLoadingEdit(false);
    }
  };

  const closeWizard = () => {
    setIsWizardOpen(false);
    setWizardInitialData(null);
    setEditingSurveyId(null);
  };

  const handleSaveWizard = (data: any) => {
    if (editingSurveyId) {
      updateSurvey.mutate({ id: editingSurveyId, ...data }, { onSuccess: closeWizard });
    } else {
      createSurvey.mutate(data, { onSuccess: closeWizard });
    }
  };

  const handleConfirmDelete = async () => {
    if (!surveyToDelete) return;
    setDeleting(true);
    try {
      await deleteSurvey.mutateAsync(surveyToDelete.id);
      setSurveyToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const filteredSurveys = surveys.filter((s: any) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Star className="h-6 w-6 text-orange-500 fill-orange-500" />
              Pesquisas de Satisfação
            </h1>
            <p className="text-muted-foreground">
              Crie links de feedback para seus clientes e analise a satisfação.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2 border-orange-200 hover:bg-orange-50" onClick={() => setIsLibraryOpen(true)}>
              <Sparkles className="h-4 w-4 text-orange-500" />
              Biblioteca de Pesquisas
            </Button>
            <Button className="gap-2" onClick={handleNewBlank}>
              <Plus className="h-4 w-4" />
              Nova Pesquisa
            </Button>
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar pesquisas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <p>Carregando...</p>
          ) : filteredSurveys.length === 0 ? (
            <Card className="col-span-full py-12 text-center border-dashed">
              <CardContent className="space-y-4">
                <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground opacity-20" />
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground">Nenhuma pesquisa encontrada</p>
                  <p className="text-sm text-muted-foreground">Comece criando sua primeira pesquisa de satisfação.</p>
                </div>
                <Button variant="outline" onClick={() => setIsLibraryOpen(true)}>
                  Escolher da biblioteca
                </Button>
              </CardContent>
            </Card>
          ) : (
            filteredSurveys.map((survey: any) => (
              <SurveyItem
                key={survey.id}
                survey={survey}
                handleCopyLink={handleCopyLink}
                onEdit={handleEditSurvey}
                onDeleteRequest={setSurveyToDelete}
                getSurvey={getSurvey}
              />
            ))
          )}
        </div>

        <Dialog open={isWizardOpen} onOpenChange={(open) => { if (!open) closeWizard(); }}>
          <DialogContent className="max-w-3xl p-0 overflow-hidden border-none bg-transparent shadow-none">
            <SurveyWizard
              onClose={closeWizard}
              onSave={handleSaveWizard}
              isSubmitting={createSurvey.isPending || updateSurvey.isPending}
              initialData={wizardInitialData}
              isEditing={!!editingSurveyId}
            />
          </DialogContent>
        </Dialog>

        <SurveyTemplateGallery
          open={isLibraryOpen}
          onOpenChange={setIsLibraryOpen}
          onSelect={handleSelectTemplate}
        />

        <AlertDialog
          open={!!surveyToDelete}
          onOpenChange={(open) => { if (!open && !deleting) setSurveyToDelete(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir pesquisa</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir "{surveyToDelete?.name}"? As respostas já recebidas também serão excluídas. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Excluindo...</> : "Excluir"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}

function SurveyItem({
  survey,
  handleCopyLink,
  onEdit,
  onDeleteRequest,
  getSurvey,
}: {
  survey: any;
  handleCopyLink: (s: string) => void;
  onEdit: (survey: any) => void;
  onDeleteRequest: (survey: any) => void;
  getSurvey: (id: string) => Promise<any | null>;
}) {
  const [showStats, setShowStats] = useState(false);
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({});
  const { data: results, isLoading, isError, refetch } = useSurveyResults(showStats ? survey.id : "");
  const safeResults: any[] = Array.isArray(results) ? results : [];

  const openStats = () => {
    setShowStats(true);
    // Fetch the survey's questions once, to show "Qual sua nota?" instead of
    // the raw field_key ("rating") next to each answer.
    getSurvey(survey.id).then((full) => {
      if (full?.fields) {
        const map: Record<string, string> = {};
        for (const f of full.fields) map[f.field_key] = f.field_label || f.field_key;
        setFieldLabels(map);
      }
    });
  };

  const exportResponses = () => {
    if (safeResults.length === 0) {
      toast.error("Nenhuma resposta para exportar");
      return;
    }

    const fieldKeys = Array.from(
      new Set(safeResults.flatMap((r: any) => Object.keys(r?.data || {})))
    );
    const headers = ["Data", "Nome", "Telefone", "E-mail", ...fieldKeys.map((k) => fieldLabels[k] || k)];
    const rows = safeResults.map((r: any) => [
      r.created_at ? new Date(r.created_at).toLocaleString() : "",
      r.name || "",
      r.phone || "",
      r.email || "",
      ...fieldKeys.map((k) => (r?.data || {})[k] ?? ""),
    ]);
    const csvContent = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `respostas_${survey.name.replace(/\s+/g, "_")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Respostas exportadas!");
  };

  return (
    <Card className="group hover:border-orange-500/50 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg font-semibold truncate pr-2">
            {survey.name}
          </CardTitle>
          <Badge variant={survey.is_active ? "default" : "secondary"} className={survey.is_active ? "bg-success hover:bg-success/80 text-[10px]" : "text-[10px]"}>
            {survey.is_active ? "Ativa" : "Inativa"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex flex-col">
            <span className="text-foreground font-bold">{survey.views_count || 0}</span>
            <span>Visualizações</span>
          </div>
          <div className="flex flex-col">
            <span className="text-foreground font-bold">{survey.submissions_count || 0}</span>
            <span>Respostas</span>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => handleCopyLink(survey.slug)}>
            <Copy className="h-3.5 w-3.5" />
            Link
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openStats}>
            <Star className="h-3.5 w-3.5" />
            Resultados
          </Button>
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => window.open(`/f/${survey.slug}`, '_blank')} title="Abrir pesquisa">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" className="flex-1 gap-1.5" onClick={() => onEdit(survey)}>
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 gap-1.5 text-destructive hover:text-destructive" onClick={() => onDeleteRequest(survey)}>
            <Trash2 className="h-3.5 w-3.5" />
            Excluir
          </Button>
        </div>

        <Dialog open={showStats} onOpenChange={setShowStats}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <div className="flex items-center justify-between gap-2 pr-6">
                <DialogTitle>Resultados: {survey.name}</DialogTitle>
                {safeResults.length > 0 && (
                  <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={exportResponses}>
                    <Download className="h-3.5 w-3.5" />
                    Baixar respostas
                  </Button>
                )}
              </div>
            </DialogHeader>
            <ScrollArea className="flex-1 pr-4">
              {isLoading ? (
                <p className="py-8 text-center text-muted-foreground">Carregando resultados...</p>
              ) : isError ? (
                <div className="py-8 flex flex-col items-center gap-3 text-center">
                  <AlertTriangle className="h-8 w-8 text-destructive" />
                  <p className="text-muted-foreground">Não foi possível carregar as respostas.</p>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Tentar novamente
                  </Button>
                </div>
              ) : safeResults.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">Nenhuma resposta recebida ainda.</p>
              ) : (
                <div className="space-y-4 py-4">
                  {safeResults.map((res: any, idx: number) => {
                    const data = res?.data && typeof res.data === "object" ? res.data : {};
                    return (
                      <div key={res?.id || idx} className="p-4 border rounded-lg bg-muted/40 text-foreground">
                        <div className="flex justify-between mb-2">
                          <span className="text-sm font-bold">
                            {res?.name ? res.name : `Resposta #${safeResults.length - idx}`}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {res?.created_at ? new Date(res.created_at).toLocaleString() : ""}
                          </span>
                        </div>
                        {(res?.phone || res?.email) && (
                          <p className="text-xs text-muted-foreground mb-2">
                            {[res.phone, res.email].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <div className="space-y-2">
                          {Object.entries(data).map(([key, val]: [string, any]) => (
                            <div key={key} className="text-sm">
                              <span className="font-medium">{fieldLabels[key] || key}: </span>
                              <span>{val === null || val === undefined || val === "" ? "—" : String(val)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
