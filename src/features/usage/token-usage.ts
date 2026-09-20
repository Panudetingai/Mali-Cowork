import type { ChatSession } from "@/features/chat-history";
import type { AgentUsage } from "@/pages/chat/types";

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
};

export type ModelUsageTotals = UsageTotals & {
  modelId: string;
  /** Replies attributed to this model (for sorting tie-breaks). */
  turns: number;
};

const emptyTotals = (): UsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  cost: 0,
});

function addUsage(totals: UsageTotals, usage: AgentUsage) {
  totals.inputTokens += usage.inputTokens ?? 0;
  totals.outputTokens += usage.outputTokens ?? 0;
  totals.reasoningTokens += usage.reasoningTokens ?? 0;
  totals.cacheReadTokens += usage.cacheReadTokens ?? 0;
  totals.cost += usage.cost ?? 0;
  const reported = usage.totalTokens;
  const sum =
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.reasoningTokens ?? 0);
  totals.totalTokens += reported && reported > 0 ? reported : sum;
}

/** Sum reported usage across every chat, grouped by the model that produced each reply. */
export function aggregateTokenUsage(sessions: ChatSession[]) {
  const byModel = new Map<string, ModelUsageTotals>();
  const grand = emptyTotals();

  for (const session of sessions) {
    for (let i = 0; i < session.messages.length; i++) {
      const message = session.messages[i];
      if (message.role !== "assistant" || !message.usage) continue;
      const id =
        message.modelId?.trim() ||
        session.messages[i - 1]?.resend?.modelId?.trim() ||
        "unknown";
      let row = byModel.get(id);
      if (!row) {
        row = { modelId: id, turns: 0, ...emptyTotals() };
        byModel.set(id, row);
      }
      row.turns += 1;
      addUsage(row, message.usage);
      addUsage(grand, message.usage);
    }
  }

  const models = [...byModel.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens || b.cost - a.cost || b.turns - a.turns,
  );

  return { totals: grand, byModel: models };
}
