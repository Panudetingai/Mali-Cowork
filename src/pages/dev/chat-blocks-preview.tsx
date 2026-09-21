import { ChatRichBlocks } from "@/components/chat-blocks/chat-rich-blocks";
import { SectionHeader, SettingsSection } from "@/pages/settings/ui";
import type { AuthActionBlock, MediaPreviewBlock } from "@/features/chat-blocks";
import { Link } from "react-router-dom";

const DEMO_AUTH: AuthActionBlock[] = [
  {
    title: "Gmail",
    service: "Gmail",
    description: "กรุณากดยืนยันสิทธิ์การเข้าถึง Gmail ของคุณก่อนใช้งานเครื่องมือนี้",
    url: "https://accounts.google.com/o/oauth2/v2/auth",
    actionLabel: "Authorize Gmail",
  },
  {
    title: "Notion",
    service: "Notion",
    description: "Connect your workspace so the agent can read pages you allow.",
    url: "https://mcp.notion.com/authorize",
    actionLabel: "Sign in to Notion",
  },
];

const DEMO_MEDIA: MediaPreviewBlock[] = [
  {
    kind: "image",
    url: "https://picsum.photos/seed/mali-cowork/800/450",
    title: "MCP tool result (image)",
    description: "ตัวอย่าง preview รูปจากผลลัพธ์เครื่องมือ — ผู้ใช้เห็นภาพในแชทโดยไม่ต้องเปิดลิงก์",
  },
  {
    kind: "video",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
    title: "Screen recording",
    description: "ตัวอย่างวิดีโอสั้นจาก MCP / agent",
    thumbnail: "https://picsum.photos/seed/mali-video/640/360",
  },
  {
    kind: "link",
    url: "https://modelcontextprotocol.io",
    title: "MCP documentation",
    description: "ลิงก์พร้อม hover preview ในแชท",
  },
];

export default function ChatBlocksPreviewPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <SectionHeader
        title="Chat UI blocks (preview)"
        description={
          <>
            ตัวอย่างการ์ด sign-in และ media preview สำหรับข้อความจาก agent / MCP — ใช้ในแชทจริงเมื่อมี{" "}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">```auth</code> /{" "}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">```preview</code> หรือลิงก์ Authorize
            ใน markdown
          </>
        }
        actions={
          <Link
            to="/"
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Back to chat
          </Link>
        }
      />

      <SettingsSection className="mt-8">
        <h3 className="text-sm font-medium text-foreground">Sign-in / OAuth</h3>
        <ChatRichBlocks authActions={DEMO_AUTH} mediaPreviews={[]} />
      </SettingsSection>

      <SettingsSection className="mt-10">
        <h3 className="text-sm font-medium text-foreground">MCP media & links</h3>
        <ChatRichBlocks authActions={[]} mediaPreviews={DEMO_MEDIA} />
      </SettingsSection>

      <SettingsSection className="mt-10 rounded-xl border border-dashed border-border/80 bg-muted/20 p-4">
        <h3 className="text-sm font-medium">Block format (for agents)</h3>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">{`\`\`\`auth
{"title":"Gmail","description":"…","url":"https://…","actionLabel":"Authorize Gmail"}
\`\`\`

\`\`\`preview
{"kind":"image","url":"https://…","title":"Result","description":"…"}
\`\`\``}</pre>
      </SettingsSection>
    </div>
  );
}
