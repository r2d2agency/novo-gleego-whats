import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Search, AlertCircle, FileText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useCampaignLogs, CampaignLog } from "@/hooks/use-campaign-logs";

const statusBadge = (status?: string) => {
  const s = (status || "").toLowerCase();
  if (s === "sent" || s === "success" || s === "enviado")
    return <Badge className="bg-green-500/15 text-green-600 border-green-500/30">Enviado</Badge>;
  if (s === "failed" || s === "error" || s === "erro")
    return <Badge className="bg-destructive/15 text-destructive border-destructive/30">Falhou</Badge>;
  if (s === "pending" || s === "pendente")
    return <Badge className="bg-muted text-muted-foreground">Pendente</Badge>;
  return status ? <Badge variant="outline">{status}</Badge> : null;
};

export const CampaignLogsPanel = () => {
  const [campaignId, setCampaignId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState<{ campaignId?: string; status?: string; search?: string }>({});

  const { logs, loading, error, getCampaignLogs } = useCampaignLogs(applied);

  const applyFilters = () => {
    setApplied({
      campaignId: campaignId || undefined,
      status: status && status !== "all" ? status : undefined,
      search: search || undefined,
    });
  };

  const refresh = () => {
    getCampaignLogs({
      campaignId: campaignId || undefined,
      status: status && status !== "all" ? status : undefined,
      search: search || undefined,
    }).catch(() => undefined);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Logs de Envio
            </CardTitle>
            <CardDescription>
              Histórico de envios de campanhas de todas as organizações
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg bg-muted/40 border">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por telefone ou campanha..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              className="pl-9"
            />
          </div>
          <Input
            placeholder="ID da campanha"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="w-[220px]"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="sent">Enviado</SelectItem>
              <SelectItem value="failed">Falhou</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={applyFilters} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Filtrar
          </Button>
        </div>

        {/* Erro */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Tabela */}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Organização</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    Nenhum log encontrado
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log: CampaignLog, idx: number) => (
                  <TableRow key={log.id || idx}>
                    <TableCell className="whitespace-nowrap">
                      {log.created_at
                        ? format(new Date(log.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
                        : "-"}
                    </TableCell>
                    <TableCell>{log.campaign_name || log.campaign_id || "-"}</TableCell>
                    <TableCell>{log.organization_name || "-"}</TableCell>
                    <TableCell className="font-mono text-sm">{log.phone || "-"}</TableCell>
                    <TableCell>{statusBadge(log.status)}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">
                      {log.error || log.message || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
