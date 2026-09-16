import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, ExternalLink, Loader2, Users, Briefcase, AlertTriangle } from "lucide-react";
import { useExternalForms, ExternalForm, FormSubmission } from "@/hooks/use-external-forms";

interface FormSubmissionsDialogProps {
  open: boolean;
  onClose: () => void;
  form: ExternalForm;
}

export function FormSubmissionsDialog({
  open,
  onClose,
  form,
}: FormSubmissionsDialogProps) {
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(false);

  const { getSubmissions } = useExternalForms();

  useEffect(() => {
    if (open && form.id) {
      loadSubmissions();
    }
  }, [open, form.id]);

  const loadSubmissions = async () => {
    setLoading(true);
    const result = await getSubmissions(form.id);
    setSubmissions(result);
    setLoading(false);
  };

  const navigateToProspects = () => {
    window.location.href = `/crm/prospects?source=${encodeURIComponent(form.name)}`;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Leads Capturados - {form.name}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Nenhum lead capturado ainda
            </p>
            <p className="text-sm text-muted-foreground">
              Compartilhe o link do formulário para começar a receber leads
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between py-2">
              <p className="text-sm text-muted-foreground">
                {submissions.length} leads capturados
              </p>
              <Button variant="outline" size="sm" onClick={navigateToProspects}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Ver no CRM
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Cidade/UF</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium">
                        {sub.name || sub.data?.name || "-"}
                      </TableCell>
                      <TableCell>
                        {sub.phone || sub.data?.phone || "-"}
                      </TableCell>
                      <TableCell>
                        {[sub.city, sub.state].filter(Boolean).join(", ") || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(sub.created_at).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell>
                        {sub.deal_id ? (
                          <>
                            <Badge className="bg-blue-600">
                              <Briefcase className="h-3 w-3 mr-1" />
                              Criado no CRM
                            </Badge>
                            <p className="text-xs text-muted-foreground mt-1">
                              {sub.funnel_name || "—"} · {sub.stage_name || "—"}
                              {sub.deal_owner_name && (
                                <>
                                  <br />
                                  Dono: {sub.deal_owner_name}
                                </>
                              )}
                            </p>
                          </>
                        ) : sub.routing_error ? (
                          <Badge variant="destructive" className="cursor-help" title={sub.routing_error}>
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Erro ao criar no CRM
                          </Badge>
                        ) : sub.prospect_converted_at ? (
                          <Badge className="bg-green-600">
                            <Check className="h-3 w-3 mr-1" />
                            Convertido
                          </Badge>
                        ) : sub.prospect_id ? (
                          <Badge variant="secondary">Prospect</Badge>
                        ) : (
                          <Badge variant="outline">Novo</Badge>
                        )}
                        {sub.routing_error && (
                          <p className="text-xs text-destructive mt-1 max-w-[220px] truncate" title={sub.routing_error}>
                            {sub.routing_error}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
