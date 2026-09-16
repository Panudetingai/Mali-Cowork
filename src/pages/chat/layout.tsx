import { useState } from "react";
import { chatGenerateStream } from "@/lib/api/chat";
import ChatTitle from "./components/chat-title";
import { ChatMessages } from "./components/chat-messages";
import PromptInput from "./components/prompt";
import type { ChatMessage } from "./types";

export default function ChatLayout() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const hasMessages = messages.length > 0 || isLoading;

  return (
    <div className="flex h-full flex-col items-center gap-6 px-4 py-6">
      {!hasMessages && <ChatTitle />}

      <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-auto">
        <ChatMessages messages={messages} isLoading={isLoading} />
      </div>

      <div className="w-full max-w-3xl shrink-0">
        <PromptInput
          isLoading={isLoading}
          onSubmit={async ({ prompt, modelId }) => {
            const userMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: "user",
              content: prompt,
            };
            const assistantId = crypto.randomUUID();
            // กัน error ซ้ำ: ถ้า backend ส่งทั้ง channel error + throw จะได้ไม่ขึ้น 2 ครั้ง
            let hasErrored = false;

            setMessages((prev) => [
              ...prev,
              userMessage,
              {
                id: assistantId,
                role: "assistant",
                content: "",
                modelId,
                isStreaming: true,
              },
            ]);
            setIsLoading(true);

            try {
              await chatGenerateStream(
                { prompt, modelId },
                {
                  onChunk: (text) => {
                    setMessages((prev) =>
                      prev.map((message) =>
                        message.id === assistantId
                          ? {
                              ...message,
                              content: message.content + text,
                            }
                          : message,
                      ),
                    );
                  },
                  onDone: (doneModelId) => {
                    setMessages((prev) =>
                      prev.map((message) =>
                        message.id === assistantId
                          ? {
                              ...message,
                              modelId: doneModelId,
                              isStreaming: false,
                            }
                          : message,
                      ),
                    );
                  },
                  onError: (message) => {
                    if (hasErrored) return;
                    hasErrored = true;
                    setMessages((prev) => [
                      ...prev.filter((item) => item.id !== assistantId),
                      {
                        id: crypto.randomUUID(),
                        role: "error",
                        content: message,
                      },
                    ]);
                  },
                },
              );
            } catch (error) {
              if (hasErrored) return;
              hasErrored = true;
              const raw = error instanceof Error ? error.message : String(error);
              // 429 บ่อยกับ free model — ทำข้อความให้อ่านง่าย
              const friendly =
                raw.includes("429") || raw.includes("Too Many Requests")
                  ? "429 Too Many Requests — โมเดลนี้ถูกเรียกถี่เกินไป ลองรอสักครู่แล้วส่งใหม่ หรือสลับโมเดล"
                  : raw;
              setMessages((prev) => [
                ...prev.filter((item) => item.id !== assistantId),
                {
                  id: crypto.randomUUID(),
                  role: "error",
                  content: friendly,
                },
              ]);
            } finally {
              setIsLoading(false);
            }
          }}
        />
      </div>
    </div>
  );
}
