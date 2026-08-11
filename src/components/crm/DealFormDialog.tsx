import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CRMFunnel, useCRMDealMutations, useCRMCompanies, useCRMFunnel, useCRMGroups } from "@/hooks/use-crm";
import { Slider } from "@/components/ui/slider";
import { Building2, User, Search, Loader2, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { api, API_URL, getAuthToken } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CompanyDialog } from "./CompanyDialog";
import { useCRMLeadSources, useCRMLeadSourceMutations } from "@/hooks/use-crm-config";

interface DealFormDialogProps {
  funnel: CRMFunnel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useMyGroups() {
  return useQuery({
    queryKey: ["crm-my-groups"],
    queryFn: () => api<{ id: string; name: string; is_supervisor: boolean }[]>("/api/crm/groups/me"),
  });
}

export function DealFormDialog({ funnel, open, onOpenChange }: DealFormDialogProps) {
  const { user } = useAuth();
  const canManage = user?.role && ['owner', 'admin', 'manager'].includes(user.role);

  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companySearchQuery, setCompanySearchQuery] = useState("");
  const [companySearchOpen, setCompanySearchOpen] = useState(false);
  const [selectedCompanyName, setSelectedCompanyName] = useState("");
  const [stageId, setStageId] = useState("");
  const [value, setValue] = useState("");
  const [probability, setProbability] = useState(50);
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("");
  
  const [mode, setMode] = useState<"company" | "contact">("company");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [showCompanyDialog, setShowCompanyDialog] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [leadSourceId, setLeadSourceId] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [showNewSource, setShowNewSource] = useState(false);

  const { data: companies } = useCRMCompanies(companySearchQuery.length >= 2 ? companySearchQuery : undefined);
  const { data: funnelData } = useCRMFunnel(funnel?.id || null);
  const { data: groups } = useCRMGroups();
  const { data: myGroups } = useMyGroups();
  const { createDeal } = useCRMDealMutations();
  const { data: leadSources } = useCRMLeadSources();
  const { createLeadSource } = useCRMLeadSourceMutations();
  const { data: orgMembers } = useQuery({
    queryKey: ["org-members-for-deal"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/crm/map-users`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) return [];
      return res.json() as Promise<{ id: string; name: string }[]>;
    },
  });

  // Auto-fill group for non-managers
  useEffect(() => {
    if (!canManage && myGroups?.length && !groupId) {
      setGroupId(myGroups[0].id);
    }
  }, [canManage, myGroups, groupId]);

  useEffect(() => {
    if (open && funnelData?.stages?.length) {
      const firstStage = funnelData.stages.find((s) => !s.is_final);
      if (firstStage?.id) {
        setStageId(firstStage.id);
      }
    }
  }, [open, funnelData]);

  const handleSave = () => {
    if (!funnel || !title.trim() || !stageId) return;
    if (mode === "company" && !companyId) return;
    if (mode === "contact" && (!contactName.trim() || !contactPhone.trim())) return;

    createDeal.mutate({
      funnel_id: funnel.id,
      stage_id: stageId,
      company_id: mode === "company" ? companyId : undefined,
      title,
      value: Number(value) || 0,
      probability,
      expected_close_date: expectedCloseDate || undefined,
      description,
      group_id: groupId || undefined,
      owner_id: ownerId || undefined,
      lead_source_id: leadSourceId || undefined,
      contact_name: mode === "contact" ? contactName : undefined,
      contact_phone: mode === "contact" ? contactPhone : undefined,
    } as any);

    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setTitle("");
    setCompanyId("");
    setCompanySearchQuery("");
    setSelectedCompanyName("");
    setCompanySearchOpen(false);
    setValue("");
    setProbability(50);
    setExpectedCloseDate("");
    setDescription("");
    setGroupId("");
    setContactName("");
    setContactPhone("");
    setMode("company");
    setOwnerId("");
    setLeadSourceId("");
    setNewSourceName("");
    setShowNewSource(false);
  };

  const handleCreateSource = async () => {
    const name = newSourceName.trim();
    if (!name) return;
    try {
      const created = await createLeadSource.mutateAsync({ name });
      if (created?.id) setLeadSourceId(created.id);
      setNewSourceName("");
      setShowNewSource(false);
    } catch {/* toast handled */}
  };

  const isValid = () => {
    if (!title.trim() || !stageId) return false;
    if (mode === "company") return !!companyId;
    if (mode === "contact") return !!contactName.trim() && !!contactPhone.trim();
    return false;
  };

  // Derive group name for display
  const userGroupName = !canManage && myGroups?.length
    ? myGroups.map(g => g.name).join(", ")
    : null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] !flex !flex-col overflow-hidden" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Nova Negociação</DialogTitle>
          <p className="sr-only">Formulário para criar uma nova negociação</p>
        </DialogHeader>

        <div className="-mr-3 max-h-[calc(100dvh-12rem)] overflow-y-auto pr-3 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          <div className="space-y-4 p-1">
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título da negociação"
              />
            </div>

            {/* Company or Contact Selection */}
            <div className="space-y-2">
              <Label>Vincular a *</Label>
              <Tabs value={mode} onValueChange={(v) => setMode(v as "company" | "contact")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="company" className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Empresa
                  </TabsTrigger>
                  <TabsTrigger value="contact" className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Contato
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="company" className="mt-3 space-y-2">
                  <Popover open={companySearchOpen} onOpenChange={setCompanySearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between h-10 font-normal"
                      >
                        {selectedCompanyName || "Buscar empresa por nome ou CNPJ..."}
                        <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <div className="p-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Digite nome ou CNPJ..."
                            value={companySearchQuery}
                            onChange={(e) => setCompanySearchQuery(e.target.value)}
                            className="pl-8"
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {companySearchQuery.length < 2 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            Digite pelo menos 2 caracteres...
                          </p>
                        ) : !companies?.length ? (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            Nenhuma empresa encontrada
                          </p>
                        ) : (
                          companies.map((company) => (
                            <button
                              key={company.id}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 cursor-pointer"
                              onClick={() => {
                                setCompanyId(company.id);
                                setSelectedCompanyName(company.name + (company.cnpj ? ` (${company.cnpj})` : ''));
                                setCompanySearchOpen(false);
                              }}
                            >
                              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="truncate font-medium">{company.name}</p>
                                {company.cnpj && (
                                  <p className="text-xs text-muted-foreground">{company.cnpj}</p>
                                )}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => setShowCompanyDialog(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Criar nova empresa
                  </Button>
                </TabsContent>

                <TabsContent value="contact" className="mt-3 space-y-3">
                  <Input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Nome do contato"
                  />
                  <Input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="Telefone (WhatsApp)"
                  />
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-2">
              <Label>Etapa *</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a etapa" />
                </SelectTrigger>
                <SelectContent>
                  {funnelData?.stages
                    ?.filter((s) => !s.is_final)
                    .map((stage) => (
                      <SelectItem key={stage.id} value={stage.id!}>
                        {stage.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valor (R$)</Label>
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0,00"
                  min={0}
                  step={0.01}
                />
              </div>
              <div className="space-y-2">
                <Label>Fechamento previsto</Label>
                <Input
                  type="date"
                  value={expectedCloseDate}
                  onChange={(e) => setExpectedCloseDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Probabilidade de fechamento: {probability}%</Label>
              <Slider
                value={[probability]}
                onValueChange={([val]) => setProbability(val)}
                min={0}
                max={100}
                step={5}
              />
            </div>

            {/* Group: managers can select, vendedores see auto-filled read-only */}
            {canManage ? (
              <div className="space-y-2">
                <Label>Grupo</Label>
                <Select value={groupId || "none"} onValueChange={(val) => setGroupId(val === "none" ? "" : val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um grupo (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {groups?.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : userGroupName ? (
              <div className="space-y-2">
                <Label>Grupo</Label>
                <Input value={userGroupName} disabled className="bg-muted" />
              </div>
            ) : null}

            {/* Vendedor responsável */}
            {canManage && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <User className="h-4 w-4" /> Vendedor responsável
                </Label>
                <Select value={ownerId || "none"} onValueChange={(v) => setOwnerId(v === "none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Atribuir a um vendedor (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Eu mesmo</SelectItem>
                    {orgMembers?.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Origem */}
            <div className="space-y-2">
              <Label>Origem</Label>
              {showNewSource ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                    placeholder="Ex: Feira, BNI, Indicação..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleCreateSource(); }
                      if (e.key === "Escape") { setShowNewSource(false); setNewSourceName(""); }
                    }}
                  />
                  <Button type="button" size="sm" onClick={handleCreateSource} disabled={!newSourceName.trim() || createLeadSource.isPending}>
                    Salvar
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setShowNewSource(false); setNewSourceName(""); }}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Select value={leadSourceId || "none"} onValueChange={(v) => setLeadSourceId(v === "none" ? "" : v)}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecione uma origem (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {leadSources?.filter(s => s.is_active).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" title="Nova origem" onClick={() => setShowNewSource(true)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalhes da negociação..."
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!isValid()}
          >
            Criar Negociação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <CompanyDialog
        company={null}
        open={showCompanyDialog}
        onOpenChange={setShowCompanyDialog}
        onCreated={(newCompany) => {
          setCompanyId(newCompany.id);
          setSelectedCompanyName(newCompany.name);
          setShowCompanyDialog(false);
        }}
      />
    </>
  );
}
