import { useState, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  Check,
  FileSpreadsheet,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  Users,
  Phone,
} from "lucide-react";
import { useProspects, Prospect } from "@/hooks/use-prospects";
import { useCRMFunnels } from "@/hooks/use-crm";
import ProspectImportDialog from "@/components/crm/ProspectImportDialog";
import { ProspectCallsDialog } from "@/components/crm/ProspectCallsDialog";

export default function CRMProspects() {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [showBulkConvertDialog, setShowBulkConvertDialog] = useState(false);
  const [convertingProspect, setConvertingProspect] = useState<Prospect | null>(null);
  const [callProspect, setCallProspect] = useState<Prospect | null>(null);
  
  const { prospects, isLoading, createProspect, deleteProspect, convertToDeal, bulkDelete, bulkConvert } = useProspects();
  const { data: funnels } = useCRMFunnels();

  // New prospect form
  const [newProspect, setNewProspect] = useState({ 
    name: "", 
    phone: "", 
    source: "",
    city: "",
    state: "",
    address: "",
    zip_code: "",
    is_company: false
  });
  
  // Convert form
  const [convertForm, setConvertForm] = useState({ 
    funnel_id: "", 
    title: "",
    create_company: false,
    company_name: ""
  });
  const [bulkConvertFunnelId, setBulkConvertFunnelId] = useState("");
  const [bulkCreateCompanies, setBulkCreateCompanies] = useState(false);

  const filteredProspects = useMemo(() => {
    if (!search.trim()) return prospects;
    const term = search.toLowerCase();
    return prospects.filter(p =>
      p.name?.toLowerCase().includes(term) ||
      p.phone?.toLowerCase().includes(term) ||
      p.source?.toLowerCase().includes(term)
    );
  }, [prospects, search]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(filteredProspects.map(p => p.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelect = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(i => i !== id));
    }
  };

  const handleAddProspect = async () => {
    if (!newProspect.name || !newProspect.phone) {
      toast.error("Nome e telefone são obrigatórios");
      return;
    }
    await createProspect.mutateAsync(newProspect);
    setNewProspect({ 
      name: "", 
      phone: "", 
      source: "",
      city: "",
      state: "",
      address: "",
      zip_code: "",
      is_company: false
    });
    setShowAddDialog(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este prospect?")) return;
    await deleteProspect.mutateAsync(id);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Excluir ${selectedIds.length} prospects?`)) return;
    await bulkDelete.mutateAsync(selectedIds);
    setSelectedIds([]);
  };

  const openConvertDialog = (prospect: Prospect) => {
    setConvertingProspect(prospect);
    setConvertForm({ 
      funnel_id: funnels?.[0]?.id || "", 
      title: prospect.name,
      create_company: prospect.is_company || false,
      company_name: prospect.is_company ? prospect.name : ""
    });
    setShowConvertDialog(true);
  };

  const handleConvert = async () => {
    if (!convertingProspect || !convertForm.funnel_id) {
      toast.error("Selecione um funil");
      return;
    }
    if (convertForm.create_company && !convertForm.company_name.trim()) {
      toast.error("Informe o nome da empresa");
      return;
    }
    await convertToDeal.mutateAsync({
      prospect_id: convertingProspect.id,
      funnel_id: convertForm.funnel_id,
      title: convertForm.title || convertingProspect.name,
      create_company: convertForm.create_company,
      company_name: convertForm.company_name.trim() || undefined,
    });
    setShowConvertDialog(false);
    setConvertingProspect(null);
  };

  const handleExportToCampaign = () => {
    if (selectedIds.length === 0) {
      toast.error("Selecione pelo menos um prospect");
      return;
    }
    // Navigate to campaigns with selected prospect IDs
    const params = new URLSearchParams();
    params.set("prospect_ids", selectedIds.join(","));
    window.location.href = `/campanhas?${params.toString()}`;
  };

  const handleBulkConvert = async () => {
    if (!bulkConvertFunnelId) {
      toast.error("Selecione um funil");
      return;
    }
    // Filter only non-converted prospects
    const unconvertedIds = selectedIds.filter(id => {
      const prospect = prospects.find(p => p.id === id);
      return prospect && !prospect.converted_at;
    });
    if (unconvertedIds.length === 0) {
      toast.error("Nenhum prospect selecionado está pendente");
      return;
    }
    await bulkConvert.mutateAsync({
      prospect_ids: unconvertedIds,
      funnel_id: bulkConvertFunnelId,
      create_companies: bulkCreateCompanies,
    });
    setShowBulkConvertDialog(false);
    setSelectedIds([]);
    setBulkConvertFunnelId("");
  };

  const openBulkConvertDialog = () => {
    if (selectedIds.length === 0) {
      toast.error("Selecione pelo menos um prospect");
      return;
    }
    setBulkConvertFunnelId(funnels?.[0]?.id || "");
    setShowBulkConvertDialog(true);
  };

  return (
    <MainLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone ou origem..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Importar
            </Button>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Prospect
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de Prospects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{prospects.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Selecionados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{selectedIds.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Novos (7 dias)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {prospects.filter(p => {
                  const created = new Date(p.created_at);
                  const weekAgo = new Date();
                  weekAgo.setDate(weekAgo.getDate() - 7);
                  return created >= weekAgo;
                }).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Convertidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {prospects.filter(p => p.converted_at).length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bulk Actions */}
        {selectedIds.length > 0 && (
          <div className="flex gap-2 p-3 bg-muted rounded-lg flex-wrap">
            <span className="text-sm text-muted-foreground self-center">
              {selectedIds.length} selecionados
            </span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={openBulkConvertDialog}>
              <ArrowRight className="h-4 w-4 mr-2" />
              Converter para Negociação
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportToCampaign}>
              <Send className="h-4 w-4 mr-2" />
              Criar Campanha
            </Button>
            <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir
            </Button>
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={filteredProspects.length > 0 && selectedIds.length === filteredProspects.length}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filteredProspects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="h-8 w-8 text-muted-foreground" />
                        <p className="text-muted-foreground">Nenhum prospect encontrado</p>
                        <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Importar lista
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProspects.map((prospect) => (
                    <TableRow key={prospect.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(prospect.id)}
                          onCheckedChange={(checked) => handleSelect(prospect.id, checked as boolean)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{prospect.name}</TableCell>
                      <TableCell>{prospect.phone}</TableCell>
                      <TableCell>
                        {prospect.city || prospect.state ? (
                          <span className="text-sm text-muted-foreground">
                            {[prospect.city, prospect.state].filter(Boolean).join(", ")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {prospect.source ? (
                          <Badge variant="secondary">{prospect.source}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {prospect.is_company ? (
                          <Badge variant="outline" className="border-blue-500 text-blue-600">
                            <Building2 className="h-3 w-3 mr-1" />
                            Empresa
                          </Badge>
                        ) : (
                          <Badge variant="outline">Pessoa</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {prospect.converted_at ? (
                          <Badge className="bg-green-600">
                            <Check className="h-3 w-3 mr-1" />
                            Convertido
                          </Badge>
                        ) : (
                          <Badge variant="outline">Pendente</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(prospect.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setCallProspect(prospect)}>
                              <Phone className="h-4 w-4 mr-2" />
                              Registrar ligação
                            </DropdownMenuItem>
                            {!prospect.converted_at && (
                              <DropdownMenuItem onClick={() => openConvertDialog(prospect)}>
                                <ArrowRight className="h-4 w-4 mr-2" />
                                Converter para Negociação
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(prospect.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Add Prospect Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo Prospect</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="name">Nome *</Label>
                <Input
                  id="name"
                  value={newProspect.name}
                  onChange={(e) => setNewProspect(p => ({ ...p, name: e.target.value }))}
                  placeholder="Nome do prospect"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone *</Label>
                <Input
                  id="phone"
                  value={newProspect.phone}
                  onChange={(e) => setNewProspect(p => ({ ...p, phone: e.target.value }))}
                  placeholder="5511999999999"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source">Origem</Label>
                <Input
                  id="source"
                  value={newProspect.source}
                  onChange={(e) => setNewProspect(p => ({ ...p, source: e.target.value }))}
                  placeholder="Ex: Instagram"
                />
              </div>
            </div>
            
            {/* Address section */}
            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground mb-3">Endereço (opcional)</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="address">Endereço</Label>
                  <Input
                    id="address"
                    value={newProspect.address}
                    onChange={(e) => setNewProspect(p => ({ ...p, address: e.target.value }))}
                    placeholder="Rua, número, complemento"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Cidade</Label>
                  <Input
                    id="city"
                    value={newProspect.city}
                    onChange={(e) => setNewProspect(p => ({ ...p, city: e.target.value }))}
                    placeholder="São Paulo"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">Estado</Label>
                  <Input
                    id="state"
                    value={newProspect.state}
                    onChange={(e) => setNewProspect(p => ({ ...p, state: e.target.value }))}
                    placeholder="SP"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip_code">CEP</Label>
                  <Input
                    id="zip_code"
                    value={newProspect.zip_code}
                    onChange={(e) => setNewProspect(p => ({ ...p, zip_code: e.target.value }))}
                    placeholder="01234-567"
                  />
                </div>
              </div>
            </div>
            
            {/* Company checkbox */}
            <div className="flex items-center space-x-2 border-t pt-4">
              <Checkbox
                id="is_company"
                checked={newProspect.is_company}
                onCheckedChange={(checked) => setNewProspect(p => ({ ...p, is_company: checked as boolean }))}
              />
              <Label htmlFor="is_company" className="text-sm cursor-pointer">
                Este prospect é uma empresa (será criada automaticamente ao converter)
              </Label>
            </div>
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddProspect} disabled={createProspect.isPending}>
                {createProspect.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Convert to Deal Dialog */}
      <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Converter para Negociação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2">
                <strong className="text-sm">{convertingProspect?.name}</strong>
                {convertingProspect?.is_company && (
                  <Badge variant="outline" className="border-blue-500 text-blue-600 text-xs">
                    <Building2 className="h-3 w-3 mr-1" />
                    Empresa
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{convertingProspect?.phone}</p>
            </div>
            
            <div className="space-y-2">
              <Label>Funil *</Label>
              <select
                className="w-full p-2 border rounded-md bg-background"
                value={convertForm.funnel_id}
                onChange={(e) => setConvertForm(f => ({ ...f, funnel_id: e.target.value }))}
              >
                <option value="">Selecione um funil</option>
                {funnels?.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="deal-title">Título da Negociação</Label>
              <Input
                id="deal-title"
                value={convertForm.title}
                onChange={(e) => setConvertForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Título da negociação"
              />
            </div>
            
            {/* Create Company Option */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="create_company"
                  checked={convertForm.create_company}
                  onCheckedChange={(checked) => setConvertForm(f => ({ 
                    ...f, 
                    create_company: checked as boolean,
                    company_name: checked ? (f.company_name || convertingProspect?.name || "") : ""
                  }))}
                />
                <Label htmlFor="create_company" className="text-sm cursor-pointer">
                  Criar empresa no CRM
                </Label>
              </div>
              
              {convertForm.create_company && (
                <div className="space-y-2 ml-6">
                  <Label htmlFor="company_name">Nome da Empresa</Label>
                  <Input
                    id="company_name"
                    value={convertForm.company_name}
                    onChange={(e) => setConvertForm(f => ({ ...f, company_name: e.target.value }))}
                    placeholder="Nome da empresa"
                  />
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowConvertDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleConvert} disabled={convertToDeal.isPending}>
                {convertToDeal.isPending ? "Convertendo..." : "Converter"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Convert Dialog */}
      <Dialog open={showBulkConvertDialog} onOpenChange={setShowBulkConvertDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Converter Prospects Selecionados</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm">
                <strong>{selectedIds.length}</strong> prospects selecionados serão convertidos em negociações.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Prospects já convertidos serão ignorados.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Funil de Destino *</Label>
              <select
                className="w-full p-2 border rounded-md bg-background"
                value={bulkConvertFunnelId}
                onChange={(e) => setBulkConvertFunnelId(e.target.value)}
              >
                <option value="">Selecione um funil</option>
                {funnels?.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            
            {/* Create Companies Option */}
            <div className="flex items-center space-x-2 border-t pt-4">
              <Checkbox
                id="bulk_create_companies"
                checked={bulkCreateCompanies}
                onCheckedChange={(checked) => setBulkCreateCompanies(checked as boolean)}
              />
              <Label htmlFor="bulk_create_companies" className="text-sm cursor-pointer">
                <span className="flex items-center gap-1">
                  <Building2 className="h-4 w-4" />
                  Criar empresas para todos os prospects
                </span>
              </Label>
            </div>
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowBulkConvertDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleBulkConvert} disabled={bulkConvert.isPending}>
                {bulkConvert.isPending ? "Convertendo..." : `Converter ${selectedIds.length}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <ProspectImportDialog open={showImport} onOpenChange={setShowImport} />

      {callProspect && (
        <ProspectCallsDialog
          open={!!callProspect}
          onOpenChange={(open) => !open && setCallProspect(null)}
          prospectId={callProspect.id}
          prospectName={callProspect.name}
          prospectPhone={callProspect.phone}
        />
      )}
    </MainLayout>
  );
}
