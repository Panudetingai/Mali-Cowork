/**
 * Epic D (docs/PRD-delight-v0.3.md §6.5): Agent Arena — the same prompt to
 * 2–3 models or agents at once, then keep the best answer.
 */
export type ArenaContender = {
  chatId: string;
  modelId: string;
  modelName: string;
  /** models.dev logo id. */
  provider: string;
};

export type ArenaRound = {
  id: string;
  prompt: string;
  mode: "chat" | "cowork";
  createdAt: number;
  contenders: ArenaContender[];
  /** Set once the user picks; the other contenders' chats are deleted. */
  winnerChatId?: string;
};
