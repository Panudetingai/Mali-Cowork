/**
 * Dev only (/dev/notch): the notch pill on a pretend screen, with every
 * state a click away, so it can be tuned without running an agent.
 */
import { BOTS, useCoworkBot, type BotState } from "@/features/cowork-bot";
import { hideNotch, sendNotchState, showNotch } from "@/features/notch/bridge";
import { shapeSize, windowSize } from "@/features/notch/layout";
import { NotchChat, type ChatPanel } from "@/features/notch/notch-chat";
import { useNotchCowork } from "@/features/notch/use-notch-cowork";
import { NotchIntro } from "@/features/notch/notch-intro";
import { NotchPill, type ActiveBot } from "@/features/notch/notch-pill";
import type { RosterBot } from "@/features/notch/team";
import type {
  NotchEdit,
  NotchGeometry,
  NotchLook,
  NotchPeek,
  NotchPhase,
  NotchSession,
  NotchSnapshot,
  NotchStep,
  NotchView,
} from "@/features/notch/types";
import { useNotchChat } from "@/features/notch/use-notch-chat";
import type { QuickTurn } from "@/features/quick";
import { cn } from "@/lib/utils";
import { useState } from "react";

const SCREENS: Record<string, NotchGeometry> = {
  "Mac with notch": { hasNotch: true, notchWidth: 185, barHeight: 32 },
  "Mac, no notch": { hasNotch: false, notchWidth: 0, barHeight: 24 },
  Windows: { hasNotch: false, notchWidth: 0, barHeight: 0 },
};

const STEP_TITLES = ["Start working", "Read quote.pdf", "Prep workspace", "Run npm test", "Edit billing.ts", "Copy final outputs"];

const ROSTER: RosterBot[] = [
  { id: "a", name: "Stripe", mascot: "sora", color: "#3aa3f5", role: "Billing", instructions: "", modelId: "" },
  { id: "b", name: "GitHub", mascot: "ichigo", color: "#f0443a", role: "Code & PRs", instructions: "", modelId: "" },
  { id: "c", name: "n8n", mascot: "mikan", color: "#ff9a2e", role: "Automations", instructions: "", modelId: "" },
  { id: "d", name: "Vercel", mascot: "petal", color: "#8b5cf6", role: "Deploys", instructions: "", modelId: "" },
];

const EDIT: NotchEdit = {
  id: "e1",
  path: "src/billing.ts",
  kind: "modified",
  additions: 12,
  deletions: 3,
  lines: [
    { tag: "ctx", text: "export function total(items: Item[]) {" },
    { tag: "del", text: "  return items.reduce((n, i) => n + i.price, 0);" },
    { tag: "add", text: "  const net = items.reduce((n, i) => n + i.price * i.qty, 0);" },
    { tag: "add", text: "  return Math.round(net * (1 + VAT) * 100) / 100;" },
  ],
};

const SESSIONS: NotchSession[] = [
  {
    id: "s1",
    title: "Redesign the desktop app settings pane",
    folder: "desktop-app",
    mode: "cowork",
    model: "Opus 5.5",
    asked: "Redesign the desktop app settings pane",
    running: true,
    waiting: false,
    failed: false,
    step: { kind: "Edit", title: "Edit src/settings/pane.tsx" },
    updatedAt: Date.now() - 20_000,
  },
  {
    id: "s2",
    title: "Refactor the agent runtime scheduler",
    folder: "agent-runtime",
    mode: "code",
    model: "Sonnet 5.5",
    asked: "Refactor the agent runtime scheduler",
    running: true,
    waiting: true,
    failed: false,
    step: { kind: "Bash", title: "Bash cargo test" },
    updatedAt: Date.now() - 50_000,
  },
  {
    id: "s3",
    title: "Ship the session routing update",
    folder: "vibe-island",
    mode: "chat",
    model: "GPT-5.6",
    asked: "Ship the session routing update",
    answer: "Shipped the session routing update.",
    running: false,
    waiting: false,
    failed: false,
    updatedAt: Date.now() - 5 * 60_000,
  },
];

const PEEKS: Record<string, NotchPeek> = {
  done: { id: "p1", tone: "done", title: "Mochi finished", detail: "Dock animated, built and signed" },
  failed: { id: "p2", tone: "failed", title: "Ichigo couldn't finish", detail: "Instagram rejected the video (format)" },
  team: {
    id: "p3",
    tone: "team",
    title: "GitHub takes over",
    detail: "Opening a PR",
    bot: { key: "b", mascot: "ichigo", name: "GitHub" },
  },
  edit: { id: "p4", tone: "edit", title: "Mochi edited a file", edit: EDIT },
};

const SAMPLE: QuickTurn[] = [
  {
    id: "t1",
    display: "What's the total on this quote?",
    request: {
      prompt: "What's the total on this quote?",
      attachments: [{ id: "f1", name: "quote.pdf", path: "", mime: "application/pdf", size: 1, kind: "file" }],
    },
    answer: "The total is **€1,240** excl. VAT (€1,488 incl. VAT) for Atelier Brun — valid until October 30.",
    status: "done",
    modelId: "preview",
  },
];

export default function NotchPreviewPage() {
  const { bot } = useCoworkBot();
  const [screen, setScreen] = useState("Mac with notch");
  const [view, setView] = useState<NotchView>("collapsed");
  const [phase, setPhase] = useState<NotchPhase>("working");
  const [count, setCount] = useState(3);
  const [team, setTeam] = useState(4);
  const [swap, setSwap] = useState(false);
  const [todos, setTodos] = useState(true);
  const [thread, setThread] = useState(true);
  const [welcome, setWelcome] = useState<BotState>("thinking");
  const [drop, setDrop] = useState<"over" | "taken">("over");
  const [answering, setAnswering] = useState<"once" | "reject">();
  const [input, setInput] = useState("");
  const [intro, setIntro] = useState(0);
  const [panel, setPanel] = useState<ChatPanel>(null);
  const [model, setModel] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [peekKind, setPeekKind] = useState("edit");
  const [look, setLook] = useState<NotchLook>("black");
  const [teamOpen, setTeamOpen] = useState(true);
  const [session, setSession] = useState<NotchSession>();
  const cowork = useNotchCowork(null);
  const chat = useNotchChat(SAMPLE);
  const shownChat = thread ? chat : { ...chat, turns: [] };
  const geometry = SCREENS[screen];
  const roster = ROSTER.slice(0, team);

  const steps: NotchStep[] = STEP_TITLES.slice(0, count).map((title, i) => ({
    id: `s${i}`,
    kind: "tool",
    title,
    done: i < count - 1,
  }));
  const snapshot: NotchSnapshot = {
    phase: view === "permission" ? "permission" : view === "done" ? "done" : phase,
    chatId: "preview",
    title: "Quote for Atelier Brun",
    steps,
    todos: todos
      ? [
          { text: "Read the quote", status: "completed" },
          { text: "Draft the invoice", status: "in_progress" },
          { text: "Copy final outputs", status: "pending" },
        ]
      : [],
    team: swap ? [{ ...ROSTER[1], status: "Opening a PR", done: false }] : [],
    permission:
      view === "permission"
        ? { id: "p", directory: "/repo", permission: "bash", patterns: ["git push origin main"], title: "git push origin main" }
        : undefined,
    command: "git push origin main",
    edits: [EDIT],
    startedAt: Date.now() - 9000,
    folder: "/Users/me/tv-launcher",
    showcase: [
      {
        source: "canva",
        title: "Launch posts",
        url: "https://www.canva.com/",
        items: [1, 2, 3, 4].map((n) => ({
          image: `https://picsum.photos/seed/mali-post-${n}/540/675`,
          width: 1080,
          height: 1350,
        })),
      },
    ],
    waiting: 1,
    running: 1,
  };
  const leadName = BOTS.find((b) => b.id === bot)?.name ?? "Mali";
  const peek = PEEKS[peekKind];
  const active: ActiveBot =
    view === "peek" && peek.bot
      ? { key: peek.bot.key, bot: peek.bot.mascot, name: peek.bot.name }
      : swap && phase === "working"
      ? { key: ROSTER[1].id, bot: ROSTER[1].mascot, name: ROSTER[1].name }
      : { key: "lead", bot, name: leadName };
  const shape = shapeSize(view, geometry, {
    thread: shownChat.turns.length > 0 || !!panel || !!session,
    files: false,
    peek: peek.tone,
    sessions: SESSIONS.length,
    models: 3,
    team: roster.length,
    teamOpen,
  });
  const win = windowSize(view, shape);
  const button = "rounded-md border px-2 py-1";

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex flex-wrap gap-2 text-sm">
        <Group label="Screen" options={Object.keys(SCREENS)} value={screen} onChange={setScreen} />
        <Group
          label="View"
          options={["collapsed", "home", "chat", "sessions", "recap", "peek", "permission", "drop", "welcome", "done"]}
          value={view}
          onChange={(v) => setView(v as NotchView)}
        />
        <Group label="Phase" options={["working", "done", "idle"]} value={phase} onChange={(v) => setPhase(v as NotchPhase)} />
        <Group label="Peek" options={Object.keys(PEEKS)} value={peekKind} onChange={setPeekKind} />
        <Group label="Look" options={["black", "glass", "light"]} value={look} onChange={(v) => setLook(v as NotchLook)} />
        <button className={button} onClick={() => setCount((c) => (c % STEP_TITLES.length) + 1)}>
          Next step ({count})
        </button>
        <button className={button} onClick={() => setTeam((t) => (t === 4 ? 0 : t === 2 ? 4 : t + 1))}>
          Team {team}
        </button>
        <button className={button} onClick={() => setSwap((t) => !t)}>
          Bot steps in {swap ? "on" : "off"}
        </button>
        <button className={button} onClick={() => setTodos((t) => !t)}>
          Todos {todos ? "on" : "off"}
        </button>
        <button className={button} onClick={() => setThread((t) => !t)}>
          Thread {thread ? "on" : "off"}
        </button>
        <button className={button} onClick={() => setWelcome((w) => (w === "thinking" ? "idle" : "thinking"))}>
          Welcome: {welcome}
        </button>
        <button className={button} onClick={() => setDrop((d) => (d === "over" ? "taken" : "over"))}>
          Drop: {drop}
        </button>
        <button className={button} onClick={() => setIntro((n) => n + 1)}>
          Play fly-in
        </button>
        {/* The real window: switch to another app within 3s to see it above the menu bar. */}
        <button
          className={button}
          onClick={() =>
            setTimeout(
              () =>
                void showNotch(snapshot.phase === "permission")
                  .then(() => sendNotchState(snapshot))
                  .catch(console.warn),
              3000,
            )
          }
        >
          Send to notch in 3s
        </button>
        <button className={button} onClick={() => void hideNotch().catch(console.warn)}>
          Hide notch
        </button>
      </div>
      {/* A pretend screen: wallpaper, menu bar and notch. */}
      <div
        className="relative h-[460px] w-[900px] shrink-0 overflow-hidden rounded-xl"
        style={{ background: "radial-gradient(120% 90% at 70% 100%, #3b3f5c 0%, #1b1d29 55%, #0e0f15 100%)" }}
      >
        <div className="absolute inset-x-0 top-0 bg-white/10 backdrop-blur" style={{ height: geometry.barHeight }} />
        {geometry.hasNotch && (
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-[10px] bg-black"
            style={{ width: geometry.notchWidth, height: geometry.barHeight }}
          />
        )}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 outline outline-dashed outline-white/10"
          style={{ width: win.width, height: win.height }}
        >
          <NotchPill
            snapshot={snapshot}
            view={view}
            geometry={geometry}
            shape={shape}
            lead={bot}
            active={active}
            roster={roster}
            answering={answering}
            onReply={(reply) => {
              setAnswering(reply);
              setTimeout(() => {
                setAnswering(undefined);
                setView("collapsed");
              }, 700);
            }}
            onOpenChat={() => undefined}
            onPress={() => setView("home")}
            onEnter={() => undefined}
            onLeave={() => undefined}
            onSettled={() => undefined}
            onDismiss={() => setView("collapsed")}
            onHome={() => setView("home")}
            onChat={() => setView("chat")}
            onNewChat={() => setView("chat")}
            onPickBot={() => setView("chat")}
            onBotDropped={() => setView("chat")}
            onCapturePick={() => setView("chat")}
            onAddBot={() => undefined}
            peek={peek}
            onPeekClose={() => setView("collapsed")}
            sessions={SESSIONS}
            onSessions={() => setView("sessions")}
            onPickSession={(picked) => {
              setSession(picked);
              setView("chat");
            }}
            teamOpen={teamOpen}
            onTeamOpen={setTeamOpen}
            look={look}
            usage={{ runs: 12, seconds: 3840, files: 23, tokens: 48200, cost: 0.42, days: [3, 5, 2, 8, 4, 0, 12] }}
            recap={{
              week: 0,
              from: Date.now() - 4 * 86_400_000,
              to: Date.now() + 3 * 86_400_000,
              tasks: 18,
              chats: 7,
              created: 67,
              edited: 131,
              commands: 61,
              seconds: 1980,
              tokens: 2_200_000,
              cost: 0,
              models: [
                { name: "muse-spark-1.3-contributor-free", tasks: 9 },
                { name: "mimo-v2.6-flash-free", tasks: 5 },
                { name: "big-pickle", tasks: 4 },
              ],
              days: [2, 5, 3, 0, 8, 0, 0],
            }}
            onRecap={() => setView("recap")}
            welcomeState={welcome}
            drop={drop}
            chat={
              <NotchChat
                chat={shownChat}
                geometry={geometry}
                input={input}
                onInput={setInput}
                onClearBot={() => undefined}
                onClose={() => setView("collapsed")}
                cowork={cowork}
                folder={folder}
                onFolder={setFolder}
                modelId={model ?? undefined}
                pickedModel={model}
                onPickModel={setModel}
                panel={panel}
                onPanel={setPanel}
                onOpenChat={() => undefined}
                session={session}
                onLeaveSession={() => setSession(undefined)}
              />
            }
          />
        </div>
        {/* The real thing sits on the camera; here it's drawn on top to check the clearance. */}
        {geometry.hasNotch && (
          <div
            className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-b-[10px] bg-red-500/25 outline outline-red-400/60"
            style={{ width: geometry.notchWidth, height: geometry.barHeight }}
          />
        )}
      </div>
      {intro > 0 && (
        <div className="relative h-[420px] w-[900px] shrink-0 overflow-hidden rounded-xl bg-[#14151d]">
          <NotchIntro key={intro} from={{ x: 300, y: 300 }} color="#f5c518" onDone={() => undefined} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        The dashed box is the window; the pill animates inside it; red is where the camera is. Window{" "}
        {Math.round(win.width)}×{Math.round(win.height)}.
      </p>
    </div>
  );
}

function Group({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border p-1">
      <span className="px-1 text-xs text-muted-foreground">{label}</span>
      {options.map((option) => (
        <button
          key={option}
          className={cn("rounded-md px-2 py-0.5", option === value && "bg-foreground text-background")}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
