import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GraduationCapIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { acceptProposal, declineProposal, freeMascot, TOOL_SCOPES, useTeam, type Proposal } from "./store";
import { defaultTeamModel, useTeamModels } from "./use-team-models";

/**
 * A bot the lead would like on the team. It joins only when the user takes it
 * on — as it is, or after a look in the editor (`onReview`).
 */
export function ProposalCard({
  proposal,
  onReview,
  className,
}: {
  proposal: Proposal;
  onReview?: (proposal: Proposal) => void;
  className?: string;
}) {
  const { mates } = useTeam();
  const models = useTeamModels();
  const model = defaultTeamModel(models);
  const scope = TOOL_SCOPES.find((s) => s.value === proposal.tools)?.label;
  const coached = proposal.updates ? mates.find((m) => m.id === proposal.updates) : undefined;
  if (proposal.updates) return <CoachingCard proposal={proposal} mascot={coached?.mascot} gone={!coached} className={className} />;

  return (
    <div className={cn("flex gap-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-3.5", className)}>
      <CoworkBot bot={freeMascot(mates)} state="welcome" size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-violet-700 uppercase dark:text-violet-300">
          <SparklesIcon className="size-3" />{" "}
          {proposal.fromNotebook ? "Learned from your work — a new bot for it" : "The lead proposes a new bot"}
        </p>
        <p className="text-sm font-semibold">{proposal.name}</p>
        <p className="text-sm text-foreground/85">{proposal.role}</p>
        {proposal.reason && <p className="text-xs leading-relaxed text-muted-foreground">{proposal.reason}</p>}
        <p className="text-[11px] text-muted-foreground">
          {scope}
          {proposal.connectors.length > 0 && ` · connectors: ${proposal.connectors.join(", ")}`}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            disabled={!model}
            title={model ? `Runs on ${model.replace(/^api:/, "")}; change it any time in Settings → Team` : "Add an API model first"}
            onClick={() => model && acceptProposal(proposal.id, model)}
          >
            Take it on
          </Button>
          {onReview && (
            <Button size="sm" variant="outline" onClick={() => onReview(proposal)}>
              Review first
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => declineProposal(proposal.id)}>
            No thanks
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The coach rewrote how a bot on the team works; the bot keeps its old way until the user takes the new one. */
function CoachingCard({
  proposal,
  mascot,
  gone,
  className,
}: {
  proposal: Proposal;
  mascot?: Parameters<typeof CoworkBot>[0]["bot"];
  gone: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("flex gap-3 rounded-xl border border-sky-500/25 bg-sky-500/[0.05] p-3.5", className)}>
      <CoworkBot bot={mascot} state="thinking" size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-sky-700 uppercase dark:text-sky-300">
          <GraduationCapIcon className="size-3" /> The coach has a better way for {proposal.name}
        </p>
        {proposal.reason && <p className="text-sm text-foreground/85">{proposal.reason}</p>}
        <button type="button" onClick={() => setOpen((v) => !v)} className="self-start text-xs text-muted-foreground hover:text-foreground">
          {open ? "Hide the new instructions" : "Show the new instructions"}
        </button>
        {open && (
          <pre className="max-h-56 overflow-auto rounded-lg border border-border/60 bg-background px-3 py-2 text-xs whitespace-pre-wrap">
            {proposal.instructions}
          </pre>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Button size="sm" disabled={gone} onClick={() => acceptProposal(proposal.id, "")}>
            {gone ? "That bot is gone" : "Use the new way"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => declineProposal(proposal.id)}>
            Keep the old way
          </Button>
        </div>
      </div>
    </div>
  );
}
