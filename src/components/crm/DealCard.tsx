import { forwardRef, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CRMDeal } from "@/hooks/use-crm";
import { cn } from "@/lib/utils";
import { Building2, User, Clock, AlertTriangle, CheckSquare, Trophy, XCircle, Pause, Video, CalendarClock, Flame, Thermometer, Snowflake, TrendingUp, TrendingDown, Activity, FolderKanban, Webhook, MessageSquareWarning, ThumbsUp, ThumbsDown, Play, Zap, FileText } from "lucide-react";
import { differenceInHours, parseISO } from "date-fns";
import { analyzeDeal } from "./PredictiveAnalytics";

interface DealCardProps {
  deal: CRMDeal & { lead_score?: number; lead_score_label?: string };
  isDragging?: boolean;
  onClick: (e: React.MouseEvent) => void;
  isNewWin?: boolean;
   onStatusChange?: (dealId: string, status: 'won' | 'lost' | 'paused' | 'open', dealTitle?: string, stageId?: string) => void;
}

export const DealCard = forwardRef<HTMLDivElement, DealCardProps>(
  function DealCard({ deal, isDragging, onClick, isNewWin, onStatusChange }, ref) {
    // Calculate inactivity
    const hoursInactive = differenceInHours(new Date(), parseISO(deal.last_activity_at));
    const isInactive = deal.inactivity_hours && hoursInactive >= deal.inactivity_hours;
    
    // Convert pending_tasks to number (comes as string from API)
    const pendingTasksCount = Number(deal.pending_tasks) || 0;
    const hasPendingTasks = pendingTasksCount > 0;
    
    // Upcoming meetings count
    const upcomingMeetingsCount = Number(deal.upcoming_meetings) || 0;
    const hasUpcomingMeetings = upcomingMeetingsCount > 0;
    
    // Scheduled WhatsApp messages count
    const scheduledMessagesCount = Number(deal.scheduled_messages) || 0;
    const hasScheduledMessages = scheduledMessagesCount > 0;

    // Projects count
    const projectCount = Number(deal.project_count) || 0;
    const hasProjects = projectCount > 0;

    // Calculate predictive insights
    const predictiveInsights = useMemo(() => {
      return analyzeDeal({
        id: deal.id,
        title: deal.title,
        value: deal.value,
        status: deal.status,
        created_at: deal.created_at,
        updated_at: deal.last_activity_at,
        last_activity_at: deal.last_activity_at,
        tasks_pending: pendingTasksCount,
        meetings_scheduled: upcomingMeetingsCount,
      });
    }, [deal, pendingTasksCount, upcomingMeetingsCount]);

    const formatCurrency = (value: number) => {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 0,
      }).format(value);
    };

    const primaryContact = deal.contacts?.find((c) => c.is_primary);

    // Status-based styling
    const isWon = deal.status === 'won';
    const isLost = deal.status === 'lost';
    const isPaused = deal.status === 'paused';

    // Determine border/ring color based on status
    const getStatusStyles = () => {
      if (isWon) return "ring-2 ring-green-500 border-green-500 bg-green-50/50 dark:bg-green-950/20";
      if (isLost) return "ring-2 ring-red-500 border-red-500 bg-red-50/50 dark:bg-red-950/20";
      if (isPaused) return "ring-2 ring-gray-400 border-gray-400 bg-gray-100/50 dark:bg-gray-800/50 opacity-70";
      return "";
    };

    // Determine left border color priority: status > inactivity > tasks > none
    const getBorderColor = () => {
      if (isWon) return "#22c55e";
      if (isLost) return "#ef4444";
      if (isPaused) return "#9ca3af";
      if (isInactive) return deal.inactivity_color || "#ef4444";
      if (hasPendingTasks) return "#f59e0b";
      return undefined;
    };

    const borderColor = getBorderColor();

    const cardStyle = {
      borderLeftColor: borderColor,
    };

    // Status badge
    const getStatusBadge = () => {
      if (isWon) {
        return (
          <Badge className="bg-green-500 text-white text-[10px] px-1.5 flex items-center gap-0.5">
            <Trophy className="h-3 w-3" />
            Ganho
          </Badge>
        );
      }
      if (isLost) {
        return (
          <Badge className="bg-red-500 text-white text-[10px] px-1.5 flex items-center gap-0.5">
            <XCircle className="h-3 w-3" />
            Perdido
          </Badge>
        );
      }
      if (isPaused) {
        return (
          <Badge className="bg-gray-500 text-white text-[10px] px-1.5 flex items-center gap-0.5">
            <Pause className="h-3 w-3" />
            Pausado
          </Badge>
        );
      }
      return null;
    };

    return (
      <Card
        ref={ref}
        style={cardStyle}
        onClick={onClick}
        role="article"
        aria-label={`Negociação: ${deal.title}, ${formatCurrency(deal.value)}${isWon ? ', ganho' : isLost ? ', perdido' : isPaused ? ', pausado' : ''}`}
        className={cn(
          "p-3 cursor-grab active:cursor-grabbing overflow-hidden group",
          "transition-all duration-200 ease-out",
          "hover:shadow-md hover:-translate-y-0.5",
          isDragging && "shadow-2xl scale-105 rotate-2 ring-2 ring-primary/50 cursor-grabbing",
          borderColor && "border-l-4",
          getStatusStyles(),
          isNewWin && "animate-scale-in"
        )}
      >
        {/* Status Badge + Quick Action Buttons */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1">
            {getStatusBadge() || <span />}
            {Number(deal.proposal_count || 0) > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="text-[10px] px-1.5 flex items-center gap-0.5">
                    <FileText className="h-3 w-3" /> {deal.proposal_count}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{deal.proposal_count} proposta(s) nesta negociação</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Quick status buttons */}
          {onStatusChange && (
            <div 
              className={cn(
                "flex items-center gap-1 transition-opacity",
                isDragging ? "opacity-0" : "opacity-0 group-hover:opacity-100"
              )}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {deal.status !== 'won' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full hover:bg-green-100 dark:hover:bg-green-900/30 text-green-500 hover:text-green-600 hover:scale-110 transition-all"
                      onClick={(e) => { e.stopPropagation(); onStatusChange(deal.id, 'won'); }}
                    >
                      <ThumbsUp className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>Ganhou</p></TooltipContent>
                </Tooltip>
              )}
              {deal.status !== 'lost' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 hover:text-red-600 hover:scale-110 transition-all"
                      onClick={(e) => { e.stopPropagation(); onStatusChange(deal.id, 'lost'); }}
                    >
                      <ThumbsDown className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>Perdeu</p></TooltipContent>
                </Tooltip>
              )}
              {deal.status === 'open' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-600 hover:scale-110 transition-all"
                      onClick={(e) => { e.stopPropagation(); onStatusChange(deal.id, 'paused'); }}
                    >
                      <Pause className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>Pausar</p></TooltipContent>
                </Tooltip>
              )}
              {(deal.status === 'paused' || deal.status === 'won' || deal.status === 'lost') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500 hover:text-blue-600 hover:scale-110 transition-all"
                      onClick={(e) => { e.stopPropagation(); onStatusChange(deal.id, 'open'); }}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>Reabrir</p></TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>

        {/* Title & Value */}
        <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
          <h4 className={cn(
            "font-medium text-sm break-words min-w-0 flex-1",
            isPaused && "text-muted-foreground"
          )}>
            {deal.title}
          </h4>
          <Badge variant="outline" className={cn(
            "shrink-0 text-xs whitespace-nowrap",
            isWon && "border-green-500 text-green-600",
            isLost && "border-red-500 text-red-600 line-through",
            isPaused && "border-gray-400 text-gray-500"
          )}>
            {formatCurrency(deal.value)}
          </Badge>
        </div>

        {/* Company & Source */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
          <Building2 className="h-3 w-3" />
          <span className="truncate">{deal.company_name}</span>
          {deal.source && (
            <Badge variant="outline" className="ml-auto text-[10px] px-1 py-0 gap-0.5 shrink-0">
              <Webhook className="h-2.5 w-2.5" />
              {deal.source.replace('Webhook: ', '')}
            </Badge>
          )}
        </div>

        {/* Contact */}
        {primaryContact && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            <User className="h-3 w-3" />
            <span className="truncate">{primaryContact.name}</span>
          </div>
        )}

        {/* Loss Reason */}
        {isLost && deal.lost_reason && (
          <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 mb-2 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1.5">
            <MessageSquareWarning className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{deal.lost_reason}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t mt-2 gap-1 flex-wrap">
          <div className="flex items-center gap-2">
            {/* Owner */}
            {deal.automation_active && !isWon && !isLost && !isPaused && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="secondary" 
                    className="text-[10px] px-1.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 flex items-center gap-0.5 animate-pulse shrink-0"
                  >
                    <Zap className="h-3 w-3 fill-current" />
                    <span>Auto</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Automação ativa aguardando resposta</p>
                </TooltipContent>
              </Tooltip>
            )}

            {deal.owner_name && (
              <div className="flex items-center gap-1">
                <div className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium",
                  isWon ? "bg-green-200 text-green-700" :
                  isLost ? "bg-red-200 text-red-700" :
                  isPaused ? "bg-gray-200 text-gray-600" :
                  "bg-primary/20"
                )}>
                  {deal.owner_name.charAt(0).toUpperCase()}
                </div>
              </div>
            )}

            {/* Lead Score - show for all open deals */}
            {!isWon && !isLost && deal.lead_score !== undefined && deal.lead_score > 0 && (
              <Badge 
                variant="secondary"
                className={cn(
                  "text-[10px] px-1.5 flex items-center gap-0.5",
                  deal.lead_score_label === 'hot' && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                  deal.lead_score_label === 'warm' && "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                  deal.lead_score_label === 'cold' && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                )}
              >
                {deal.lead_score_label === 'hot' && <Flame className="h-3 w-3" />}
                {deal.lead_score_label === 'warm' && <Thermometer className="h-3 w-3" />}
                {deal.lead_score_label === 'cold' && <Snowflake className="h-3 w-3" />}
                <span>{deal.lead_score}</span>
              </Badge>
            )}

            {/* Health Score (Predictive) - show for open deals without lead score */}
            {!isWon && !isLost && (!deal.lead_score || deal.lead_score === 0) && (
              <Badge 
                variant="secondary"
                className={cn(
                  "text-[10px] px-1.5 flex items-center gap-0.5",
                  predictiveInsights.healthScore >= 70 && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                  predictiveInsights.healthScore >= 40 && predictiveInsights.healthScore < 70 && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                  predictiveInsights.healthScore < 40 && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}
                title={`Health Score: ${predictiveInsights.healthScore}% | Prob. Fechamento: ${predictiveInsights.closeProbability}%`}
              >
                {predictiveInsights.healthScore >= 70 && <TrendingUp className="h-3 w-3" />}
                {predictiveInsights.healthScore >= 40 && predictiveInsights.healthScore < 70 && <Activity className="h-3 w-3" />}
                {predictiveInsights.healthScore < 40 && <TrendingDown className="h-3 w-3" />}
                <span>{predictiveInsights.healthScore}%</span>
              </Badge>
            )}

            {!isWon && !isLost && (
              <Badge 
                variant="secondary" 
                className={cn(
                  "text-[10px] px-1.5",
                  deal.probability >= 70 && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                  deal.probability >= 40 && deal.probability < 70 && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                  deal.probability < 40 && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}
              >
                {deal.probability}%
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
            {/* Projects linked */}
            {hasProjects && (
              <Badge 
                variant="secondary" 
                className="text-[10px] px-1.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 flex items-center gap-0.5"
                title={`${projectCount} projeto(s) vinculado(s)`}
              >
                <FolderKanban className="h-3 w-3" />
                <span>{projectCount}</span>
              </Badge>
            )}

            {/* Scheduled WhatsApp messages - highlighted */}
            {hasScheduledMessages && !isWon && !isLost && (
              <Badge 
                variant="secondary" 
                className="text-[10px] px-1.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-0.5"
                title={`${scheduledMessagesCount} mensagem(ns) WhatsApp agendada(s)`}
              >
                <CalendarClock className="h-3 w-3" />
                <span>{scheduledMessagesCount}</span>
              </Badge>
            )}

            {/* Upcoming meetings - highlighted */}
            {hasUpcomingMeetings && !isWon && !isLost && (
              <Badge 
                variant="secondary" 
                className="text-[10px] px-1.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 flex items-center gap-0.5"
                title={`${upcomingMeetingsCount} reunião(ões) agendada(s)`}
              >
                <Video className="h-3 w-3" />
                <span>{upcomingMeetingsCount}</span>
              </Badge>
            )}

            {/* Pending tasks - highlighted */}
            {hasPendingTasks && !isWon && !isLost && (
              <Badge 
                variant="secondary" 
                className="text-[10px] px-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-0.5"
              >
                <CheckSquare className="h-3 w-3" />
                <span>{pendingTasksCount}</span>
              </Badge>
            )}

            {/* Inactivity warning - hide for closed deals */}
             {isInactive && !isWon && !isLost && !isPaused && (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-label="Negociação inativa" />
            )}

            {/* Time indicator */}
            <div className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              <span>{hoursInactive}h</span>
            </div>
          </div>
        </div>
      </Card>
    );
  }
);
