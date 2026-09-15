import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FilePlus, ArrowRight } from "lucide-react";
import { SURVEY_TEMPLATES, SurveyTemplate } from "./survey-templates";

interface SurveyTemplateGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: SurveyTemplate | null) => void;
}

export function SurveyTemplateGallery({ open, onOpenChange, onSelect }: SurveyTemplateGalleryProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Biblioteca de Pesquisas</DialogTitle>
          <DialogDescription>
            Escolha um modelo pronto para começar — tudo pode ser editado depois (perguntas, cores, logo).
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-1 space-y-3">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="w-full flex items-center gap-3 p-4 rounded-lg border border-dashed hover:bg-accent/30 transition-colors text-left"
          >
            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
              <FilePlus className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">Começar do zero</p>
              <p className="text-xs text-muted-foreground">Monte sua pesquisa do jeito que quiser.</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>

          {SURVEY_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template)}
              className="w-full flex items-center gap-3 p-4 rounded-lg border hover:bg-accent/30 transition-colors text-left"
            >
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-semibold"
                style={{ backgroundColor: template.primary_color }}
              >
                {template.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{template.name}</p>
                <p className="text-xs text-muted-foreground truncate">{template.description}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
