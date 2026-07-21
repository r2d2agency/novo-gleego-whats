import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

export function SoundToggle() {
  const { settings, updateSettings } = useNotificationSound();
  const enabled = settings.soundEnabled;

  const toggle = () => {
    const next = !enabled;
    updateSettings({ soundEnabled: next });
    toast.success(next ? "Notificações de som ativadas" : "Notificações de som silenciadas");
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={enabled ? "Silenciar notificações" : "Ativar notificações"}
            className="h-8 w-8"
          >
            {enabled ? (
              <Bell className="h-4 w-4 text-muted-foreground" />
            ) : (
              <BellOff className="h-4 w-4 text-destructive" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {enabled ? "Silenciar som das notificações" : "Ativar som das notificações"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}