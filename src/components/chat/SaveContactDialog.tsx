import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookUser, Loader2, Plus } from "lucide-react";
import { useContacts, ContactList } from "@/hooks/use-contacts";
import { toast } from "sonner";

interface SaveContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
  contactPhone: string;
}

const NEW_LIST_VALUE = "__new__";

export function SaveContactDialog({ open, onOpenChange, contactName, contactPhone }: SaveContactDialogProps) {
  const { getLists, createList, addContact } = useContacts();
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedListId("");
    setNewListName("");
    setLoadingLists(true);
    getLists()
      .then((data) => {
        setLists(data);
        if (data.length > 0) setSelectedListId(data[0].id);
        else setSelectedListId(NEW_LIST_VALUE);
      })
      .catch(() => toast.error("Erro ao carregar listas de contatos"))
      .finally(() => setLoadingLists(false));
  }, [open, getLists]);

  const handleSave = async () => {
    if (selectedListId === NEW_LIST_VALUE && !newListName.trim()) {
      toast.error("Digite um nome para a nova lista");
      return;
    }

    setSaving(true);
    try {
      let listId = selectedListId;
      if (selectedListId === NEW_LIST_VALUE) {
        const created = await createList(newListName.trim());
        listId = created.id;
      }
      await addContact(listId, contactName || contactPhone, contactPhone);
      toast.success("Contato salvo na base de contatos");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar contato");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookUser className="h-5 w-5 text-primary" />
            Salvar contato
          </DialogTitle>
          <DialogDescription>
            Salva {contactName || contactPhone} ({contactPhone}) em uma lista de contatos do Gleego.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid gap-2">
            <Label>Lista de contatos</Label>
            {loadingLists ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando listas...
              </div>
            ) : (
              <Select value={selectedListId} onValueChange={setSelectedListId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma lista" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name} ({list.contact_count})
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_LIST_VALUE}>
                    <span className="flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5" />
                      Nova lista
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedListId === NEW_LIST_VALUE && (
            <div className="grid gap-2">
              <Label htmlFor="new-list-name">Nome da nova lista</Label>
              <Input
                id="new-list-name"
                placeholder="Ex: Contatos do WhatsApp"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || loadingLists}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
