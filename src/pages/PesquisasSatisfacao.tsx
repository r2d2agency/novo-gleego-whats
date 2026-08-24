import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, MessageSquare, Copy, ExternalLink, Sparkles, Star, X } from "lucide-react";
import { useSurveys } from "@/hooks/use-surveys";
import { toast } from "sonner";
import { SurveyWizard } from "@/components/surveys/SurveyWizard";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";


export default function PesquisasSatisfacao() {
  const [search, setSearch] = useState("");
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const { surveys, isLoading, createSurvey } = useSurveys();


  const handleCopyLink = (slug: string) => {
    const url = `${window.location.origin}/f/${slug}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url);
      toast.success("Link da pesquisa copiado!");
    } else {
      // Fallback for non-secure contexts or mobile
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

  const handleCreateAI = () => {
    toast.info("A IA está gerando sua pesquisa de NPS...", {
      description: "Estamos criando perguntas otimizadas para satisfação do cliente."
    });
    
    createSurvey.mutate({
      name: "Pesquisa de Satisfação IA",
      description: "Pesquisa gerada automaticamente pela IA da Gleego",
      fields: [
        { field_key: "rating", field_label: "De 0 a 10, o quanto você nos recomendaria?", field_type: "select", is_required: true, options: ["0","1","2","3","4","5","6","7","8","9","10"] },
        { field_key: "reason", field_label: "Qual o principal motivo da sua nota?", field_type: "textarea", is_required: false },
        { field_key: "improvement", field_label: "O que poderíamos fazer para melhorar sua experiência?", field_type: "textarea", is_required: false }
      ]
    });
  };

  const handleSaveWizard = (data: any) => {
    createSurvey.mutate(data, {
      onSuccess: () => {
        setIsWizardOpen(false);
      }
    });
  };


  const filteredSurveys = surveys.filter(s => 
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
            <Button variant="outline" className="gap-2 border-orange-200 hover:bg-orange-50" onClick={handleCreateAI}>
              <Sparkles className="h-4 w-4 text-orange-500" />
              Criar com IA
            </Button>
            <Button className="gap-2" onClick={() => setIsWizardOpen(true)}>
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
                <Button variant="outline" onClick={handleCreateAI}>
                  Gerar exemplo com IA
                </Button>
              </CardContent>
            </Card>
          ) : (
            filteredSurveys.map((survey) => (
              <Card key={survey.id} className="group hover:border-orange-500/50 transition-colors">
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
                      Copiar Link
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setIsWizardOpen(true)}>
                       <Plus className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => window.open(`/f/${survey.slug}`, '_blank')}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
          <DialogContent className="max-w-3xl p-0 overflow-hidden border-none bg-transparent shadow-none">
            <SurveyWizard 
              onClose={() => setIsWizardOpen(false)} 
              onSave={handleSaveWizard}
              isSubmitting={createSurvey.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>

  );
}
