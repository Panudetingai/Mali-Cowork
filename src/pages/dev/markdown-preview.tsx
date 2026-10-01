/**
 * Dev only (`/dev/markdown`): one reply with every kind of markdown, as the
 * chat shows it and as the notch shows it, to tune their typography together.
 */
import { MessageResponse } from "@/components/ai-elements/message";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { TeamThread } from "@/pages/chat/components/message/team-thread";
import type { TeamHandoff } from "@/pages/chat/components/message/team-steps";

const step = (n: number, title: string, done = true) => ({
  id: `team:momo:gw1:step:prt_${n}`,
  kind: "tool",
  title,
  done,
  detail: "{}",
});

const HANDOFF: TeamHandoff = {
  type: "team",
  key: "momo:gw1",
  teammateId: "momo",
  brief: {
    id: "team:momo:gw1:brief",
    kind: "tool",
    title: "Brief: Momo Designer",
    done: true,
    detail:
      "Job from the lead: สร้างโปรโมชั่น/แบนเนอร์กาแฟสไตล์วินเทจ 90s ใน Canva ให้ผู้ใช้ 1 ชิ้น พร้อมลิงก์เปิดดูได้\n\nContext:\nผู้ใช้เป็นคนไทย พูดภาษาไทย ขอ \"อยากให้ออกแบบโปรโมชั่นกาแฟให้หน่อย style วิเทจ 90s\" — เป็นงานออกแบบกราฟิกใน Canva ล้วน อยู่ในขอบเขตของ Momo Designer โดยตรง ใช้ brand kit ถ้ามี และส่งลิงก์แก้ไขกลับมา",
  },
  report: {
    id: "team:momo:gw1",
    kind: "tool",
    title: "Team: Momo Designer",
    done: false,
    detail: "",
  },
  steps: [
    step(1, "mali_custom-canva-mcp_list-brand-kits"),
    step(2, "mali_custom-canva-mcp_create-design"),
    step(3, "mali_custom-canva-mcp_get-create-design-async-job", false),
  ],
};

export const SAMPLE = `## สรุปยอดขายไตรมาส 3

ยอดขายรวม **฿1,284,500** เพิ่มขึ้น *12.4%* จากไตรมาสก่อน ส่วนใหญ่มาจากสินค้าใหม่ \`HandCraft Pro\` และช่องทางออนไลน์

### ตัวเลขสำคัญ

| ช่องทาง | ยอดขาย (฿) | เทียบไตรมาสก่อน | สัดส่วน |
| --- | ---: | ---: | ---: |
| ออนไลน์ | 742,300 | +18.2% | 57.8% |
| หน้าร้าน | 401,900 | +4.1% | 31.3% |
| ตัวแทน | 140,300 | −2.7% | 10.9% |
| **รวม** | **1,284,500** | **+12.4%** | **100%** |

### สิ่งที่ทำได้ดี

1. **ออนไลน์โตเร็วที่สุด** — แคมเปญ 9.9 ดันยอดได้ 2 เท่า
2. ลูกค้ากลับมาซื้อซ้ำ 34% (เป้าคือ 30%)
   - กลุ่มอายุ 25–34 ซื้อซ้ำมากที่สุด
   - ค่าเฉลี่ยต่อบิล ฿1,180
3. ต้นทุนขนส่งลดลงหลังเปลี่ยนผู้ให้บริการ

> **ข้อควรระวัง:** ช่องทางตัวแทนลดลงสองไตรมาสติด ควรคุยเรื่องเงื่อนไขส่วนลดใหม่ก่อนสิ้นปี

### งานต่อไป

- [x] ส่งรายงานให้ฝ่ายบัญชี
- [ ] นัดคุยตัวแทน 3 รายหลัก
- [ ] ทำแผนแคมเปญ 11.11

คำนวณจากไฟล์ \`sales-q3.xlsx\` ด้วยสคริปต์นี้:

\`\`\`python
import pandas as pd

df = pd.read_excel("sales-q3.xlsx")
summary = df.groupby("channel")["amount"].sum().sort_values(ascending=False)
print(summary.apply(lambda x: f"฿{x:,.0f}"))
\`\`\`

---

ดูรายละเอียดเพิ่มที่ [แดชบอร์ดยอดขาย](https://example.com/dashboard) หรือถามต่อได้เลยครับ`;

export default function MarkdownPreviewPage() {
  return (
    <div className="flex min-h-full flex-col gap-8 overflow-y-auto p-8">
      <section className="mx-auto w-full max-w-3xl">
        <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Desktop chat</p>
        <MarkdownSurface>
          <MessageResponse className="text-[15px]">{SAMPLE}</MessageResponse>
        </MarkdownSurface>
      </section>
      <section className="mx-auto w-full max-w-3xl">
        <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Team chat</p>
        <TeamThread handoff={HANDOFF} />
        <TeamThread handoff={{ ...HANDOFF, key: "done", report: { ...HANDOFF.report!, done: true, detail: "Report from Momo Designer:\n\n**เสร็จแล้ว** — ดีไซน์โปรโมชั่นกาแฟ Vintage 90s 1 ชิ้น [เปิดใน Canva](https://canva.com)" }, steps: HANDOFF.steps.map((s) => ({ ...s, done: true })) }} />
      </section>
      <section className="dark mx-auto w-full max-w-[616px] rounded-[28px] bg-black p-4 text-white">
        <p className="mb-3 text-xs font-medium tracking-wide text-white/40 uppercase">Notch</p>
        <div className="rounded-[20px] bg-white/[0.04] px-4 py-3">
          <MarkdownSurface>
            <MessageResponse className="notch-markdown text-[14px] text-white/90">{SAMPLE}</MessageResponse>
          </MarkdownSurface>
        </div>
      </section>
    </div>
  );
}
