import { useState, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCRMSegments } from "@/hooks/use-crm-config";
import { CompanyDialog } from "@/components/crm/CompanyDialog";
import { CompanyImportDialog } from "@/components/crm/CompanyImportDialog";
import { useCRMCompanies, useCRMCompanyMutations, CRMCompany, useCRMFunnels } from "@/hooks/use-crm";
import { Plus, Search, MoreHorizontal, Building2, Phone, Mail, Trash2, Edit, Loader2, FileSpreadsheet, Tag, HandshakeIcon, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { DealFormDialog } from "@/components/crm/DealFormDialog";

export default function CRMEmpresas() {
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name_asc");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<CRMCompany | null>(null);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [selectedCompanyForDeal, setSelectedCompanyForDeal] = useState<CRMCompany | null>(null);

  const { data: companies, isLoading } = useCRMCompanies();
  const { importCompanies, deleteCompany } = useCRMCompanyMutations();
  const { data: funnels } = useCRMFunnels();
  const { data: segments = [] } = useCRMSegments();

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    (companies || []).forEach((company) => {
      if (company.owner_id && company.owner_name) map.set(company.owner_id, company.owner_name);
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [companies]);

  const states = useMemo(() => {
    const values = new Set((companies || []).map((company) => company.state?.trim()).filter(Boolean));
    return Array.from(values).sort();
  }, [companies]);

  // Client-side filters + sorting
  const filteredCompanies = useMemo(() => {
    let list = [...(companies || [])];
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter(c =>
        c.name?.toLowerCase().includes(s) ||
        c.cnpj?.toLowerCase().includes(s) ||
        c.email?.toLowerCase().includes(s) ||
        c.phone?.toLowerCase().includes(s) ||
        c.city?.toLowerCase().includes(s)
      );
    }
    if (segmentFilter !== 'all') list = list.filter((c) => c.segment_id === segmentFilter);
    if (ownerFilter !== 'all') list = list.filter((c) => c.owner_id === ownerFilter);
    if (stateFilter !== 'all') list = list.filter((c) => c.state === stateFilter);

    const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
    const sorters: Record<string, (a: CRMCompany, b: CRMCompany) => number> = {
      name_asc: (a, b) => collator.compare(a.name || '', b.name || ''),
      name_desc: (a, b) => collator.compare(b.name || '', a.name || ''),
      created_desc: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      created_asc: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      city_asc: (a, b) => collator.compare(a.city || '', b.city || ''),
      deals_desc: (a, b) => Number(b.deals_count || 0) - Number(a.deals_count || 0),
    };
    return list.sort(sorters[sortBy] || sorters.name_asc);
  }, [companies, search, segmentFilter, ownerFilter, stateFilter, sortBy]);

  const handleEdit = (company: CRMCompany) => {
    setEditingCompany(company);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingCompany(null);
    setDialogOpen(true);
  };

  const handleCreateDeal = (company: CRMCompany) => {
    setSelectedCompanyForDeal(company);
    setDealDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta empresa?")) {
      deleteCompany.mutate(id);
    }
  };

  const handleExport = () => {
    const source = filteredCompanies.length > 0 ? filteredCompanies : companies || [];
    if (source.length === 0) {
      toast.error("Nenhuma empresa para exportar");
      return;
    }
    const rows = source.map((company) => ({
      "Nome": company.name || "",
      "Razão Social": company.razao_social || "",
      "Nome Fantasia": company.nome_fantasia || "",
      "CNPJ": company.cnpj || "",
      "Inscrição Estadual": company.inscricao_estadual || "",
      "Inscrição Municipal": company.inscricao_municipal || "",
      "Porte": company.porte || "",
      "CNAE": company.cnae || "",
      "E-mail": company.email || "",
      "Telefone": company.phone || "",
      "Website": company.website || "",
      "Endereço": company.address || "",
      "Cidade": company.city || "",
      "Estado": company.state || "",
      "CEP": company.zip_code || "",
      "Observações": company.notes || "",
      "Responsável": company.owner_name || "",
      "Data de cadastro": company.created_at ? format(parseISO(company.created_at), "dd/MM/yyyy") : "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Empresas");
    XLSX.writeFile(workbook, `empresas_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast.success(`${rows.length} empresa(s) exportada(s)!`);
  };

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Empresas</h1>
            <p className="text-muted-foreground">Gerencie sua base de empresas</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled={isLoading}>
              <Download className="h-4 w-4 mr-2" />
              Exportar Excel
            </Button>
            <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Importar Excel
            </Button>
            <Button onClick={handleNew}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Empresa
          </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar empresas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={segmentFilter} onValueChange={setSegmentFilter}>
            <SelectTrigger><SelectValue placeholder="Segmento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os segmentos</SelectItem>
              {segments.map((segment) => (
                <SelectItem key={segment.id} value={segment.id}>{segment.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os responsáveis</SelectItem>
              {owners.map((owner) => (
                <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {states.map((state) => (
                <SelectItem key={state} value={state}>{state}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger><SelectValue placeholder="Ordenar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Nome (A–Z)</SelectItem>
              <SelectItem value="name_desc">Nome (Z–A)</SelectItem>
              <SelectItem value="created_desc">Mais recentes</SelectItem>
              <SelectItem value="created_asc">Mais antigas</SelectItem>
              <SelectItem value="city_asc">Cidade (A–Z)</SelectItem>
              <SelectItem value="deals_desc">Mais negociações</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !filteredCompanies.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {search ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada"}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {search ? "Tente outro termo de busca" : "Adicione empresas para vincular às suas negociações"}
                </p>
                {!search && (
                  <Button onClick={handleNew}>
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar Empresa
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead className="max-w-[250px]">Empresa</TableHead>
                     <TableHead>Segmento</TableHead>
                     <TableHead>Responsável</TableHead>
                     <TableHead>CNPJ</TableHead>
                     <TableHead>Contato</TableHead>
                     <TableHead>Negociações</TableHead>
                     <TableHead>Criado em</TableHead>
                     <TableHead className="w-[60px] sticky right-0 bg-background"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCompanies.map((company) => (
                    <TableRow key={company.id} className="cursor-pointer" onClick={() => handleEdit(company)}>
                      <TableCell className="max-w-[250px]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Building2 className="h-5 w-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{company.name}</p>
                            {company.city && (
                              <p className="text-sm text-muted-foreground truncate">
                                {company.city}{company.state ? `, ${company.state}` : ""}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {company.segment_name ? (
                          <Badge 
                            variant="outline" 
                            className="flex items-center gap-1 w-fit"
                            style={{ 
                              borderColor: company.segment_color,
                              color: company.segment_color 
                            }}
                          >
                            <div 
                              className="w-2 h-2 rounded-full" 
                              style={{ backgroundColor: company.segment_color }} 
                            />
                            {company.segment_name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {company.owner_name ? (
                          <span className="text-sm font-medium">{company.owner_name}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">
                          {company.cnpj || "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {company.phone && (
                            <div className="flex items-center gap-1 text-sm">
                              <Phone className="h-3 w-3" />
                              {company.phone}
                            </div>
                          )}
                          {company.email && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Mail className="h-3 w-3" />
                              {company.email}
                            </div>
                          )}
                          {!company.phone && !company.email && "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {company.deals_count || 0} negociações
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(parseISO(company.created_at), "dd/MM/yyyy")}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-background" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(company)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCreateDeal(company)}>
                              <HandshakeIcon className="h-4 w-4 mr-2" />
                              Criar Negociação
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDelete(company.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <CompanyDialog
        company={editingCompany}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <CompanyImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImport={async (companies) => {
          await importCompanies.mutateAsync(companies);
        }}
      />

      <DealFormDialog
        funnel={funnels?.[0] || null}
        open={dealDialogOpen}
        onOpenChange={setDealDialogOpen}
        initialCompany={selectedCompanyForDeal ? {
          id: selectedCompanyForDeal.id,
          name: selectedCompanyForDeal.name,
          phone: selectedCompanyForDeal.phone,
        } : null}
      />
    </MainLayout>
  );
}
