import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarClock, Loader2, Trash2, Image, X, FileText, SplitSquareHorizontal } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { ScheduledMessage } from "@/hooks/use-chat";
import { useUpload } from "@/hooks/use-upload";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@/lib/api";
import { Search } from "lucide-react";

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (data: {
    content?: string;
    message_type?: string;
    media_url?: string;
    media_mimetype?: string;
    scheduled_at: string;
    send_text_separate?: boolean;
    template_name?: string;
    template_language?: string;
    template_components?: unknown;
    template_params?: Record<string, string>;
  }) => Promise<void>;
  scheduledMessages: ScheduledMessage[];
  onCancelScheduled: (id: string) => Promise<void>;
  sending?: boolean;
  connectionId?: string;
  isMetaConnection?: boolean;
}

interface Attachment {
  url: string;
  mimetype: string;
  type: "image" | "document";
  preview: string | null;
  name: string;
}
interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  components: any[];
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  onSchedule,
  scheduledMessages,
  onCancelScheduled,
  sending,
  connectionId,
  isMetaConnection,
}: ScheduleMessageDialogProps) {
  const isMobile = useIsMobile();
  const [content, setContent] = useState("");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("09:00");
  const [showCalendar, setShowCalendar] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sendTextSeparate, setSendTextSeparate] = useState(false);
  const [useTemplate, setUseTemplate] = useState(false);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateParams, setTemplateParams] = useState<Record<string, string>>({});
  const [templateSearch, setTemplateSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile, isUploading } = useUpload();

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) || null;

  useEffect(() => {
    if (!open || !useTemplate || !isMetaConnection || !connectionId) return;
    setLoadingTemplates(true);
    api<MetaTemplate[]>(`/api/meta/${connectionId}/templates?sync=true`)
      .then((data) => setTemplates((data || []).filter((t) => String(t.status).toUpperCase() === 'APPROVED')))
      .catch(() => toast.error('Erro ao carregar templates Meta'))
      .finally(() => setLoadingTemplates(false));
  }, [open, useTemplate, isMetaConnection, connectionId]);

  const getTemplateText = (template: MetaTemplate) =>
    (template.components || []).map((c) => c.text || '').join(' ') || template.name;

  const templateParamKeys = selectedTemplate
    ? [...new Set(getTemplateText(selectedTemplate).match(/\{\{\d+\}\}/g) || [])]
    : [];

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      try {
        let preview: string | null = null;
        if (isImage) {
          preview = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve((ev.target?.result as string) || "");
            reader.readAsDataURL(file);
          });
        }
        const url = await uploadFile(file);
        if (url) {
          setAttachments((prev) => [
            ...prev,
            {
              url,
              mimetype: file.type,
              type: isImage ? "image" : "document",
              preview,
              name: file.name,
            },
          ]);
        }
      } catch (error) {
        console.error("Upload error:", error);
        toast.error(`Erro ao carregar ${file.name}`);
      }
    }

    toast.success(`${files.length} arquivo(s) carregado(s)!`);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setAttachments([]);
  };

  const handleSchedule = async () => {
    if (!date) return;

    const [hours, minutes] = time.split(":").map(Number);
    const scheduledDate = new Date(date);
    scheduledDate.setHours(hours, minutes, 0, 0);
    const baseIso = scheduledDate.toISOString();
    const trimmedContent = content.trim();

    try {
      if (useTemplate) {
        if (!selectedTemplate) {
          toast.error("Selecione um template aprovado");
          return;
        }
        const missing = templateParamKeys.some((key) => !templateParams[key]?.trim());
        if (missing) {
          toast.error("Preencha todos os parâmetros do template");
          return;
        }
        await onSchedule({
          content: getTemplateText(selectedTemplate).replace(/\{\{(\d+)\}\}/g, (_, num) => templateParams[`{{${num}}}`] || ''),
          message_type: "template",
          scheduled_at: baseIso,
          template_name: selectedTemplate.name,
          template_language: selectedTemplate.language,
          template_components: selectedTemplate.components,
          template_params: templateParams,
        });
        setUseTemplate(false);
        setSelectedTemplateId("");
        setTemplateParams({});
        onOpenChange(false);
        return;
      }

      if (!content.trim() && attachments.length === 0) {
        toast.error("Adicione uma mensagem ou imagem");
        return;
      }

      if (attachments.length === 0) {
        // Only text
        await onSchedule({
          content: trimmedContent,
          message_type: "text",
          scheduled_at: baseIso,
        });
      } else if (attachments.length === 1) {
        // Single attachment — preserve original behavior (caption / separate text)
        const att = attachments[0];
        await onSchedule({
          content: trimmedContent || undefined,
          message_type: att.type,
          media_url: att.url,
          media_mimetype: att.mimetype,
          scheduled_at: baseIso,
          send_text_separate: trimmedContent ? sendTextSeparate : undefined,
        });
      } else {
        // Multiple attachments — schedule each with tiny (50ms) spacing so they all
        // become due in the SAME cron tick and get sent together (the cron loop
        // already paces sends serially). Text goes either as caption on the first
        // attachment or as a final separate message.
        const baseMs = scheduledDate.getTime();
        const useSeparateText = sendTextSeparate || !trimmedContent;
        const SPACING_MS = 50;

        let failures = 0;
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          const at = new Date(baseMs + i * SPACING_MS).toISOString();
          const caption = !useSeparateText && i === 0 ? trimmedContent : undefined;
          try {
            await onSchedule({
              content: caption,
              message_type: att.type,
              media_url: att.url,
              media_mimetype: att.mimetype,
              scheduled_at: at,
            });
          } catch (err) {
            console.error(`Falha ao agendar anexo ${i + 1}/${attachments.length}:`, err);
            failures++;
          }
        }

        if (useSeparateText && trimmedContent) {
          const at = new Date(baseMs + attachments.length * SPACING_MS).toISOString();
          try {
            await onSchedule({
              content: trimmedContent,
              message_type: "text",
              scheduled_at: at,
            });
          } catch (err) {
            console.error("Falha ao agendar texto final:", err);
            failures++;
          }
        }

        if (failures > 0) {
          toast.error(`${failures} item(ns) não foram agendados`);
        }
      }
    } catch (error) {
      console.error("Schedule error:", error);
      toast.error("Erro ao agendar uma ou mais mensagens");
      return;
    }

    // Reset form
    setContent("");
    setDate(undefined);
    setTime("09:00");
    setSendTextSeparate(false);
    clearAll();
    
    // Close dialog after scheduling
    onOpenChange(false);
  };

  const formatScheduledDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  };

  const getMessageIcon = (msg: ScheduledMessage) => {
    if (msg.message_type === "image") return <Image className="h-3 w-3" />;
    if (msg.message_type === "document") return <FileText className="h-3 w-3" />;
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "w-[calc(100vw-2rem)] max-w-2xl overflow-hidden",
        isMobile ? "h-[100dvh] max-h-[100dvh] rounded-none p-4 overflow-y-auto" : "max-h-[88vh]"
      )}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Agendar Mensagem
          </DialogTitle>
          <DialogDescription>
            Programe uma mensagem para ser enviada automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className={cn(
          "space-y-4 pr-1 min-h-0",
          isMobile ? "" : "overflow-y-auto flex-1"
        )}>
          {/* Image/Document Upload */}
          <div className="space-y-2">
            <Label>Anexos (opcional) {attachments.length > 0 && `— ${attachments.length}`}</Label>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex-1"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Carregando...
                  </>
                ) : (
                  <>
                    <Image className="h-4 w-4 mr-2" />
                    Adicionar imagens ou documentos
                  </>
                )}
              </Button>
            </div>

            {/* Attachments Preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <div key={i} className="relative inline-block">
                    {att.type === "image" && att.preview ? (
                      <img
                        src={att.preview}
                        alt={att.name}
                        className="h-20 w-20 object-cover rounded-lg border"
                      />
                    ) : (
                      <div className="flex items-center gap-2 p-2 bg-muted rounded-lg max-w-[180px]">
                        <FileText className="h-5 w-5 flex-shrink-0" />
                        <span className="text-xs truncate">{att.name}</span>
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-5 w-5"
                      onClick={() => removeAttachment(i)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isMetaConnection && (
            <div className="space-y-3 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
                Usar template Meta aprovado
              </label>
              {useTemplate && (
                <>
                  {loadingTemplates ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando templates...
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          className="pl-9"
                          placeholder="Buscar template..."
                          value={templateSearch}
                          onChange={(e) => setTemplateSearch(e.target.value)}
                        />
                      </div>
                      <div className="max-h-[180px] w-full min-w-0 overflow-y-auto overflow-x-hidden space-y-1 pr-1">
                        {templates
                          .filter((t) => t.name.toLowerCase().includes(templateSearch.toLowerCase()))
                          .map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => { setSelectedTemplateId(template.id); setTemplateParams({}); }}
                              className={cn(
                                "w-full min-w-0 overflow-hidden rounded-md border p-2 text-left text-sm",
                                selectedTemplateId === template.id ? "border-primary bg-primary/10" : "hover:bg-accent"
                              )}
                            >
                              <span className="font-medium">{template.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">{template.language}</span>
                              <span className="mt-1 block truncate text-xs text-muted-foreground">{getTemplateText(template)}</span>
                            </button>
                          ))}
                      </div>
                      {selectedTemplate && templateParamKeys.length > 0 && (
                        <div className="space-y-2 border-t pt-3">
                          <p className="text-xs font-medium flex items-center gap-1"><FileText className="h-3 w-3" /> Parâmetros do template</p>
                          {templateParamKeys.map((key) => (
                            <div key={key} className="space-y-1">
                              <Label className="text-xs">{key}</Label>
                              <Input
                                value={templateParams[key] || ''}
                                onChange={(e) => setTemplateParams((prev) => ({ ...prev, [key]: e.target.value }))}
                                placeholder={`Valor para ${key}`}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Message content */}
          {!useTemplate && (
          <div className="space-y-2">
            <Label>Mensagem {attachments.length > 0 ? (sendTextSeparate ? "" : "(legenda do 1º anexo)") : ""}</Label>
            <Textarea
              placeholder={attachments.length > 0 && !sendTextSeparate ? "Digite uma legenda (opcional)..." : "Digite a mensagem..."}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
            />
          </div>
          )}

          {/* Send text separate toggle - only show when both media and text exist */}
          {attachments.length > 0 && content.trim() && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-2 min-w-0">
                <SplitSquareHorizontal className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Enviar texto separado</p>
                  <p className="text-xs text-muted-foreground">
                    {sendTextSeparate 
                      ? "Texto será enviado como mensagem separada após os anexos" 
                      : "Texto será enviado como legenda do primeiro anexo"}
                  </p>
                </div>
              </div>
              <Switch
                checked={sendTextSeparate}
                onCheckedChange={setSendTextSeparate}
              />
            </div>
          )}

          {/* Date picker */}
          <div className="space-y-2">
            <Label>Data</Label>
            <Popover open={showCalendar} onOpenChange={setShowCalendar}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarClock className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP", { locale: ptBR }) : "Selecione a data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-[100]" align="center" side={isMobile ? "top" : "bottom"}>
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    setDate(d);
                    setShowCalendar(false);
                  }}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  locale={ptBR}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Time picker */}
          <div className="space-y-2">
            <Label>Horário</Label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          {/* Scheduled messages list */}
          {scheduledMessages.length > 0 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Mensagens agendadas</Label>
              <div className="max-h-[150px] overflow-y-auto space-y-2">
                {scheduledMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="flex items-start gap-2 p-2 rounded-lg bg-muted text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        {getMessageIcon(msg)}
                        {formatScheduledDate(msg.scheduled_at)}
                      </p>
                      {msg.media_url && (
                        <p className="text-xs text-primary">
                          {msg.message_type === "image" ? "📷 Imagem" : "📄 Documento"}
                        </p>
                      )}
                      {msg.content && <p className="line-clamp-2">{msg.content}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive flex-shrink-0"
                      onClick={() => onCancelScheduled(msg.id)}
                      title="Cancelar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={
              !(useTemplate
                ? !!selectedTemplate && templateParamKeys.every((key) => !!templateParams[key]?.trim())
                : !!content.trim() || attachments.length > 0)
              || !date || sending || isUploading
            }
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Agendando...
              </>
            ) : (
              "Agendar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
