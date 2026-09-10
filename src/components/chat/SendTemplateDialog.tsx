import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Search, FileText, CheckCircle2, Clock, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MetaTemplate {
  id: string;
  connection_id: string;
  meta_template_id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: any[];
}

interface SendTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  conversationId: string;
  contactPhone: string;
  onTemplateSent: () => void;
}

const STATUS_ICON: Record<string, React.ElementType> = {
  APPROVED: CheckCircle2,
  PENDING: Clock,
  REJECTED: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "text-green-500",
  PENDING: "text-yellow-500",
  REJECTED: "text-destructive",
};

export function SendTemplateDialog({
  open,
  onOpenChange,
  connectionId,
  conversationId,
  contactPhone,
  onTemplateSent,
}: SendTemplateDialogProps) {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && connectionId) {
      loadTemplates();
    }
  }, [open, connectionId]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await api<MetaTemplate[]>(
        `/api/meta/${connectionId}/templates?sync=true`,
        { auth: true }
      );
      setTemplates(data);
    } catch (error) {
      console.error("Error loading templates:", error);
      toast.error("Erro ao carregar templates");
    } finally {
      setLoading(false);
    }
  };

  const approvedTemplates = templates.filter(
    (t) => t.status === "APPROVED" || t.status === "approved"
  );

  const filteredTemplates = approvedTemplates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const getBodyText = (components: any[]): string => {
    const body = components?.find(
      (c: any) => c.type === "BODY" || c.type === "body"
    );
    return body?.text || "";
  };

  const getHeaderText = (components: any[]): string => {
    const header = components?.find(
      (c: any) => c.type === "HEADER" || c.type === "header"
    );
    return header?.text || "";
  };

  const getFooterText = (components: any[]): string => {
    const footer = components?.find(
      (c: any) => c.type === "FOOTER" || c.type === "footer"
    );
    return footer?.text || "";
  };

  const extractParams = (text: string): string[] => {
    const matches = text.match(/\{\{(\d+)\}\}/g) || [];
    return [...new Set(matches)];
  };

  const getAllParams = (template: MetaTemplate): string[] => {
    const bodyText = getBodyText(template.components);
    const headerText = getHeaderText(template.components);
    const allText = `${headerText} ${bodyText}`;
    return extractParams(allText);
  };

  const handleSelectTemplate = (template: MetaTemplate) => {
    setSelectedTemplate(template);
    setParamValues({});
  };

  const handleSend = async () => {
    if (!selectedTemplate) return;
    setSending(true);
    try {
      await api(`/api/chat/conversations/${conversationId}/send-template`, {
        method: "POST",
        auth: true,
        body: {
          template_name: selectedTemplate.name,
          language: selectedTemplate.language,
          components: selectedTemplate.components,
          param_values: paramValues,
        },
      });
      toast.success("Template enviado com sucesso!");
      onTemplateSent();
      onOpenChange(false);
      setSelectedTemplate(null);
      setParamValues({});
    } catch (error: any) {
      console.error("Error sending template:", error);
      toast.error(error?.message || "Erro ao enviar template");
    } finally {
      setSending(false);
    }
  };

  const replaceParams = (text: string): string => {
    return text.replace(/\{\{(\d+)\}\}/g, (match, num) => {
      return paramValues[`{{${num}}}`] || match;
    });
  };

  const params = selectedTemplate ? getAllParams(selectedTemplate) : [];
  const allParamsFilled =
    params.length === 0 || params.every((p) => paramValues[p]?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {selectedTemplate ? "Preencher Template" : "Enviar Template Meta"}
          </DialogTitle>
        </DialogHeader>

        {!selectedTemplate ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar templates aprovados..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="flex-1 min-h-[300px]">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">
                    {approvedTemplates.length === 0
                      ? "Nenhum template aprovado encontrado"
                      : "Nenhum resultado para a busca"}
                  </p>
                  <p className="text-xs mt-1">
                    Crie e aprove templates na página de Meta Templates
                  </p>
                </div>
              ) : (
                <div className="space-y-2 pr-2">
                  {filteredTemplates.map((template) => (
                    <button
                      key={template.id}
                      className="w-full text-left p-3 rounded-lg border hover:border-primary/50 hover:bg-accent/50 transition-colors"
                      onClick={() => handleSelectTemplate(template)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">
                          {template.name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] h-5">
                            {template.category}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] h-5">
                            {template.language}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {getBodyText(template.components) || "Sem conteúdo"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 space-y-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedTemplate(null)}
              className="text-xs self-start"
            >
              ← Voltar aos templates
            </Button>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-4 pr-2">
                {/* Preview */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">
                      {selectedTemplate.name}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {selectedTemplate.language}
                    </Badge>
                  </div>

                  {getHeaderText(selectedTemplate.components) && (
                    <p className="text-sm font-semibold">
                      {replaceParams(getHeaderText(selectedTemplate.components))}
                    </p>
                  )}
                  <p className="text-sm whitespace-pre-wrap">
                    {replaceParams(getBodyText(selectedTemplate.components))}
                  </p>
                  {getFooterText(selectedTemplate.components) && (
                    <p className="text-xs text-muted-foreground">
                      {getFooterText(selectedTemplate.components)}
                    </p>
                  )}
                </div>

                {/* Param inputs */}
                {params.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      Preencha os parâmetros:
                    </p>
                    {params.map((param) => (
                      <div key={param} className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          {param}
                        </label>
                        <Input
                          placeholder={`Valor para ${param}`}
                          value={paramValues[param] || ""}
                          onChange={(e) =>
                            setParamValues((prev) => ({
                              ...prev,
                              [param]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>

            <Button
              className="w-full"
              onClick={handleSend}
              disabled={sending || !allParamsFilled}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Enviar Template
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
