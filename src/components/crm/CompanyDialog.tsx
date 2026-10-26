import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CRMCompany, useCRMCompanyMutations, useCRMGroups } from "@/hooks/use-crm";
import { useCRMSegments } from "@/hooks/use-crm-config";
import { useContacts, Contact, ContactList } from "@/hooks/use-contacts";
import { Tag, User, Plus, Trash2, Phone, Search, Check, UserPlus, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface CompanyContact {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  role?: string;
  is_primary?: boolean;
}

interface CompanyDialogProps {
  company: CRMCompany | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (company: { id: string; name: string }) => void;
}

export function CompanyDialog({ company, open, onOpenChange, onCreated }: CompanyDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    razao_social: "",
    nome_fantasia: "",
    cnpj: "",
    inscricao_estadual: "",
    inscricao_municipal: "",
    porte: "",
    cnae: "",
    email: "",
    phone: "",
    website: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    notes: "",
    more_info: "",
    segment_id: "",
    owner_id: "",
    group_id: "",
  });

  const [contacts, setContacts] = useState<CompanyContact[]>([]);
  const [newContact, setNewContact] = useState({ name: "", phone: "", email: "", role: "" });
  const [contactMode, setContactMode] = useState<"new" | "existing">("new");
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listContacts, setListContacts] = useState<Contact[]>([]);
  const [searchContact, setSearchContact] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);

  const { createCompany, updateCompany } = useCRMCompanyMutations();
  const { data: segments } = useCRMSegments();
  const { data: groups } = useCRMGroups();
  const { data: orgMembers } = useQuery({
    queryKey: ["org-members-for-company"],
    queryFn: async () => {
      try {
        const viaMap = await api<any[]>('/api/crm/map-users');
        if (Array.isArray(viaMap) && viaMap.length) {
          return viaMap
            .map((m: any) => ({ id: m.id || m.user_id, name: m.name || m.email || m.full_name }))
            .filter((m: any) => m.id);
        }
      } catch (e) {
        console.error('[CompanyDialog] map-users failed:', e);
      }
      try {
        const orgs = await api<any[]>('/api/organizations');
        const orgId = orgs?.[0]?.id || sessionStorage.getItem('user_org_id') || localStorage.getItem('user_org_id');
        if (orgId) {
          const members = await api<any[]>(`/api/organizations/${orgId}/members`);
          if (Array.isArray(members) && members.length) {
            return members
              .map((m: any) => ({ id: m.user_id || m.id, name: m.name || m.email || m.full_name }))
              .filter((m: any) => m.id);
          }
        }
      } catch (e) {
        console.error('[CompanyDialog] org-members failed:', e);
      }
      return [];
    },
    staleTime: 0,
  });
  const contactsApi = useContacts();

  useEffect(() => {
    contactsApi.getLists().then(setContactLists).catch(console.error);
  }, []);

  // Load contacts when list is selected
  useEffect(() => {
    if (selectedListId) {
      contactsApi.getContacts(selectedListId).then(setListContacts).catch(console.error);
    }
  }, [selectedListId]);

  useEffect(() => {
    if (company) {
      setFormData({
        name: company.name || "",
        razao_social: company.razao_social || "",
        nome_fantasia: company.nome_fantasia || "",
        cnpj: company.cnpj || "",
        inscricao_estadual: company.inscricao_estadual || "",
        inscricao_municipal: company.inscricao_municipal || "",
        porte: company.porte || "",
        cnae: company.cnae || "",
        email: company.email || "",
        phone: company.phone || "",
        website: company.website || "",
        address: company.address || "",
        city: company.city || "",
        state: company.state || "",
        zip_code: company.zip_code || "",
        notes: company.notes || "",
        more_info: company.more_info || "",
        segment_id: company.segment_id || "",
        owner_id: company.owner_id || "",
        group_id: company.group_id || "",
      });
      // TODO: Load existing contacts from API
      setContacts([]);
    } else {
      setFormData({
        name: "",
        razao_social: "",
        nome_fantasia: "",
        cnpj: "",
        inscricao_estadual: "",
        inscricao_municipal: "",
        porte: "",
        cnae: "",
        email: "",
        phone: "",
        website: "",
        address: "",
        city: "",
        state: "",
        zip_code: "",
        notes: "",
        more_info: "",
        segment_id: "",
        owner_id: "",
        group_id: "",
      });
      setContacts([]);
    }
  }, [company, open]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCnpjLookup = async () => {
    const cnpj = formData.cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) {
      toast.error("CNPJ deve ter 14 dígitos");
      return;
    }
    setLookingUpCnpj(true);
    try {
      const data = await api<any>(`/api/crm/cnpj/${cnpj}`);
      const emp = data.empresa || {};
      const est = data.estabelecimento || {};
      const socios = data.socios || [];

      // Build "Mais Informações" content
      const moreInfoParts: string[] = [];

      // Sócios
      if (socios.length > 0) {
        moreInfoParts.push(`═══ SÓCIOS ═══`);
        socios.forEach((s: any) => {
          const parts = [s.nome_socio];
          if (s.qualificacao_descricao) parts.push(`(${s.qualificacao_descricao})`);
          if (s.cpf_cnpj_socio) parts.push(`- CPF/CNPJ: ${s.cpf_cnpj_socio}`);
          if (s.data_entrada) parts.push(`- Entrada: ${s.data_entrada}`);
          moreInfoParts.push(`• ${parts.join(' ')}`);
        });
      }

      // CNAEs secundários
      const cnaesSecundarios = est.cnaes_secundarios || est.atividades_secundarias || [];
      if (cnaesSecundarios.length > 0) {
        moreInfoParts.push(`\n═══ CNAEs SECUNDÁRIOS ═══`);
        cnaesSecundarios.forEach((c: any) => {
          const code = c.codigo || c.id || c.cnae || '';
          const desc = c.descricao || c.description || '';
          moreInfoParts.push(`• ${code}${desc ? ` - ${desc}` : ''}`);
        });
      }

      // Capital Social
      if (emp.capital_social) {
        moreInfoParts.push(`\n═══ DADOS ADICIONAIS ═══`);
        moreInfoParts.push(`Capital Social: R$ ${parseFloat(emp.capital_social).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      }

      // Situação cadastral
      if (est.situacao_cadastral) {
        const sit = est.situacao_cadastral === '02' ? 'Ativa' : est.situacao_cadastral === '08' ? 'Baixada' : est.situacao_cadastral;
        moreInfoParts.push(`Situação Cadastral: ${sit}`);
      }

      // Data início atividade
      if (est.data_inicio_atividade) {
        const d = est.data_inicio_atividade;
        const formatted = d.includes('-') ? d.split('-').reverse().join('/') : `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`;
        moreInfoParts.push(`Início Atividade: ${formatted}`);
      }

      // Natureza jurídica
      if (emp.natureza_juridica || emp.natureza_descricao) {
        moreInfoParts.push(`Natureza Jurídica: ${emp.natureza_descricao || emp.natureza_juridica}`);
      }

      // Email do estabelecimento
      if (est.email) {
        moreInfoParts.push(`Email (Receita): ${est.email}`);
      }

      // Telefones do estabelecimento
      const tels = [est.ddd1 && est.telefone1 ? `(${est.ddd1}) ${est.telefone1}` : null, est.ddd2 && est.telefone2 ? `(${est.ddd2}) ${est.telefone2}` : null].filter(Boolean);
      if (tels.length > 0) {
        moreInfoParts.push(`Telefone(s) (Receita): ${tels.join(', ')}`);
      }

      const address = [est.logradouro, est.numero, est.complemento, est.bairro].filter(Boolean).join(', ');

      setFormData(prev => ({
        ...prev,
        name: prev.name || est.nome_fantasia || emp.razao_social || '',
        razao_social: prev.razao_social || emp.razao_social || '',
        nome_fantasia: prev.nome_fantasia || est.nome_fantasia || '',
        porte: prev.porte || emp.porte_descricao || emp.natureza_descricao || '',
        cnae: prev.cnae || (est.cnae_principal ? `${est.cnae_principal.codigo || est.cnae_principal} - ${est.cnae_principal.descricao || ''}`.trim() : ''),
        address: prev.address || address,
        city: prev.city || est.municipio_nome || est.cidade?.nome || '',
        state: prev.state || est.uf || est.estado?.sigla || '',
        zip_code: prev.zip_code || (est.cep ? est.cep.replace(/(\d{5})(\d{3})/, '$1-$2') : ''),
        email: prev.email || est.email || '',
        phone: prev.phone || (est.ddd1 && est.telefone1 ? `(${est.ddd1}) ${est.telefone1}` : prev.phone),
        more_info: moreInfoParts.length > 0 ? moreInfoParts.join('\n') : prev.more_info,
      }));

      toast.success("Dados do CNPJ preenchidos!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao consultar CNPJ");
    } finally {
      setLookingUpCnpj(false);
    }
  };

  const handleAddContact = () => {
    if (!newContact.name.trim() || !newContact.phone.trim()) return;
    
    setContacts((prev) => [
      ...prev,
      {
        ...newContact,
        id: crypto.randomUUID(),
        is_primary: prev.length === 0, // First contact is primary
      },
    ]);
    setNewContact({ name: "", phone: "", email: "", role: "" });
  };

  const handleRemoveContact = (id: string) => {
    setContacts((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      // If we removed the primary, make first one primary
      if (filtered.length > 0 && !filtered.some((c) => c.is_primary)) {
        filtered[0].is_primary = true;
      }
      return filtered;
    });
  };

  const handleSetPrimary = (id: string) => {
    setContacts((prev) =>
      prev.map((c) => ({ ...c, is_primary: c.id === id }))
    );
  };

  const handleSave = async () => {
    const data = {
      ...formData,
      segment_id: formData.segment_id || undefined,
      owner_id: formData.owner_id || undefined,
      group_id: formData.group_id || undefined,
      contacts: contacts.length > 0 ? contacts : undefined,
    };
    if (company) {
      updateCompany.mutate({ id: company.id, ...data } as any);
    } else {
      try {
        const result = await createCompany.mutateAsync(data as any);
        if (result?.id && onCreated) {
          onCreated({ id: result.id, name: formData.name });
        }
      } catch {
        // error handled by mutation
      }
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" aria-describedby={undefined}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{company ? "Editar Empresa" : "Nova Empresa"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mr-4 pr-4">
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>CNPJ</Label>
                <div className="flex gap-2">
                  <Input
                    value={formData.cnpj}
                    onChange={(e) => handleChange("cnpj", e.target.value)}
                    placeholder="00.000.000/0000-00"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleCnpjLookup}
                    disabled={lookingUpCnpj || !formData.cnpj.replace(/\D/g, '').length}
                    title="Consultar CNPJ"
                  >
                    {lookingUpCnpj ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Razão Social</Label>
                <Input
                  value={formData.razao_social}
                  onChange={(e) => handleChange("razao_social", e.target.value)}
                  placeholder="Razão social da empresa"
                />
              </div>
              <div className="space-y-2">
                <Label>Nome Fantasia</Label>
                <Input
                  value={formData.nome_fantasia}
                  onChange={(e) => handleChange("nome_fantasia", e.target.value)}
                  placeholder="Nome fantasia"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nome da empresa *</Label>
              <Input
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="Nome de exibição da empresa"
              />
            </div>

            {/* Segmento */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Segmento
              </Label>
              <Select
                value={formData.segment_id || "none"}
                onValueChange={(value) => handleChange("segment_id", value === "none" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um segmento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {segments?.map((segment) => (
                    <SelectItem key={segment.id} value={segment.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: segment.color }}
                        />
                        {segment.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Porte / Tipo</Label>
                <Input
                  value={formData.porte}
                  onChange={(e) => handleChange("porte", e.target.value)}
                  placeholder="MEI, ME, EPP, Ltda, SA..."
                />
              </div>
              <div className="space-y-2">
                <Label>CNAE / Atividade</Label>
                <Input
                  value={formData.cnae}
                  onChange={(e) => handleChange("cnae", e.target.value)}
                  placeholder="Código ou descrição"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Inscrição Estadual</Label>
                <Input
                  value={formData.inscricao_estadual}
                  onChange={(e) => handleChange("inscricao_estadual", e.target.value)}
                  placeholder="IE"
                />
              </div>
              <div className="space-y-2">
                <Label>Inscrição Municipal</Label>
                <Input
                  value={formData.inscricao_municipal}
                  onChange={(e) => handleChange("inscricao_municipal", e.target.value)}
                  placeholder="IM"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  placeholder="email@empresa.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Website</Label>
                <Input
                  value={formData.website}
                  onChange={(e) => handleChange("website", e.target.value)}
                  placeholder="https://empresa.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Endereço</Label>
              <Input
                value={formData.address}
                onChange={(e) => handleChange("address", e.target.value)}
                placeholder="Rua, número, bairro"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input
                  value={formData.city}
                  onChange={(e) => handleChange("city", e.target.value)}
                  placeholder="Cidade"
                />
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <Input
                  value={formData.state}
                  onChange={(e) => handleChange("state", e.target.value)}
                  placeholder="UF"
                  maxLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label>CEP</Label>
                <Input
                  value={formData.zip_code}
                  onChange={(e) => handleChange("zip_code", e.target.value)}
                  placeholder="00000-000"
                />
              </div>
            </div>

            {/* Responsável e Grupo */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Vendedor Responsável
                </Label>
                <Select
                  value={formData.owner_id || "none"}
                  onValueChange={(value) => handleChange("owner_id", value === "none" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {orgMembers?.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Grupo
                </Label>
                <Select
                  value={formData.group_id || "none"}
                  onValueChange={(value) => handleChange("group_id", value === "none" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
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
            </div>

            {/* Contacts Section */}
            <div className="space-y-3 border-t pt-4">
              <Label className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Contatos da Empresa
              </Label>

              {/* Tabs for adding contacts */}
              <Tabs value={contactMode} onValueChange={(v) => setContactMode(v as "new" | "existing")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="new">
                    <Plus className="h-4 w-4 mr-2" />
                    Novo Contato
                  </TabsTrigger>
                  <TabsTrigger value="existing">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Vincular Existente
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="new" className="mt-3">
                  <Card className="p-3">
                    <div className="grid grid-cols-4 gap-2">
                      <Input
                        value={newContact.name}
                        onChange={(e) => setNewContact((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Nome"
                      />
                      <Input
                        value={newContact.phone}
                        onChange={(e) => setNewContact((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="Telefone"
                      />
                      <Input
                        value={newContact.role}
                        onChange={(e) => setNewContact((p) => ({ ...p, role: e.target.value }))}
                        placeholder="Cargo"
                      />
                      <Button
                        variant="outline"
                        onClick={handleAddContact}
                        disabled={!newContact.name.trim() || !newContact.phone.trim()}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                </TabsContent>

                <TabsContent value="existing" className="mt-3">
                  <Card className="p-3 space-y-3">
                    {/* Select contact list first */}
                    <div className="space-y-2">
                      <Label className="text-sm">Lista de Contatos</Label>
                      <Select
                        value={selectedListId || "none"}
                        onValueChange={(v) => setSelectedListId(v === "none" ? null : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma lista" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Selecione...</SelectItem>
                          {contactLists.map((list) => (
                            <SelectItem key={list.id} value={list.id}>
                              {list.name} ({list.contact_count} contatos)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Search and select contacts from list */}
                    {selectedListId && (
                      <div className="space-y-2">
                        <Label className="text-sm">Buscar Contato</Label>
                        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              className="w-full justify-between"
                            >
                              <span className="flex items-center gap-2">
                                <Search className="h-4 w-4" />
                                Buscar na lista...
                              </span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[400px] p-0" align="start">
                            <Command>
                              <CommandInput
                                placeholder="Buscar por nome ou telefone..."
                                value={searchContact}
                                onValueChange={setSearchContact}
                              />
                              <CommandList>
                                <CommandEmpty>Nenhum contato encontrado.</CommandEmpty>
                                <CommandGroup>
                                  {listContacts
                                    .filter((c) => {
                                      const search = searchContact.toLowerCase();
                                      return (
                                        c.name.toLowerCase().includes(search) ||
                                        c.phone.includes(search)
                                      );
                                    })
                                    .filter((c) => !contacts.some((cc) => cc.phone === c.phone))
                                    .slice(0, 10)
                                    .map((contact) => (
                                      <CommandItem
                                        key={contact.id}
                                        value={`${contact.name} ${contact.phone}`}
                                        onSelect={() => {
                                          setContacts((prev) => [
                                            ...prev,
                                            {
                                              id: contact.id,
                                              name: contact.name,
                                              phone: contact.phone,
                                              is_primary: prev.length === 0,
                                            },
                                          ]);
                                          setPopoverOpen(false);
                                          setSearchContact("");
                                        }}
                                      >
                                        <div className="flex items-center gap-2">
                                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                            <User className="h-4 w-4" />
                                          </div>
                                          <div>
                                            <p className="font-medium">{contact.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                              {contact.phone}
                                            </p>
                                          </div>
                                        </div>
                                      </CommandItem>
                                    ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Contacts List */}
              {contacts.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">
                    {contacts.length} contato{contacts.length > 1 ? "s" : ""} vinculado{contacts.length > 1 ? "s" : ""}
                  </Label>
                  {contacts.map((contact) => (
                    <Card key={contact.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-sm flex items-center gap-2">
                              {contact.name}
                              {contact.is_primary && (
                                <Badge variant="secondary" className="text-[10px]">Principal</Badge>
                              )}
                              {contact.role && (
                                <span className="text-muted-foreground font-normal">• {contact.role}</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {contact.phone}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {!contact.is_primary && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSetPrimary(contact.id!)}
                            >
                              Definir principal
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveContact(contact.id!)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label className="text-base font-semibold">📋 Mais Informações</Label>
              <p className="text-xs text-muted-foreground">Sócios, CNAEs secundários, capital social e outros dados preenchidos automaticamente pela consulta CNPJ</p>
              <Textarea
                value={formData.more_info}
                onChange={(e) => handleChange("more_info", e.target.value)}
                placeholder="Informações adicionais da empresa (preenchido automaticamente ao consultar CNPJ)..."
                rows={8}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                placeholder="Anotações sobre a empresa..."
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!formData.name.trim()}>
            {company ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
