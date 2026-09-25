import type { UsageEvent } from "./ledger";

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

/** Sum the usage ledger, grouped by the model each reply was asked of. */
export function aggregateUsageEvents(events: UsageEvent[]) {
  const byModel = new Map<string, ModelUsageTotals>();
  const grand = emptyTotals();
  const add = (totals: UsageTotals, event: UsageEvent) => {
    totals.inputTokens += event.inputTokens;
    totals.outputTokens += event.outputTokens;
    totals.reasoningTokens += event.reasoningTokens;
    totals.cacheReadTokens += event.cacheReadTokens;
    totals.totalTokens += event.totalTokens;
    totals.cost += event.cost ?? 0;
  };

  for (const event of events) {
    const id = event.modelId.trim() || "unknown";
    let row = byModel.get(id);
    if (!row) {
      row = { modelId: id, turns: 0, ...emptyTotals() };
      byModel.set(id, row);
    }
    row.turns += 1;
    add(row, event);
    add(grand, event);
  }

  const models = [...byModel.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens || b.cost - a.cost || b.turns - a.turns,
  );

  return { totals: grand, byModel: models };
}
