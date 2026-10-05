"use client";

/**
 * ⌘K / Ctrl+K from anywhere (PRD v0.3 Q1): start a chat, jump to a chat or a
 * page, call a skill or template, open a Settings section, switch theme or
 * language — all by typing a few letters.
 */
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { isListedChat, newChatHomeUrl, useChatSessions } from "@/features/chat-history";
import { useTranslation, type TranslationKey } from "@/features/i18n";
import { skillSlug, useInstructions } from "@/features/instructions";
import { useProjects } from "@/features/projects";
import {
  BarChart3Icon,
  BookOpenIcon,
  Code2Icon,
  FileTextIcon,
  FolderKanbanIcon,
  GhostIcon,
  ImageIcon,
  InboxIcon,
  LanguagesIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PackageIcon,
  SettingsIcon,
  SparklesIcon,
  SunMoonIcon,
  UsersIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { requestCompose } from "./compose";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const SETTINGS: { id: string; label: TranslationKey }[] = [
  { id: "general", label: "tabGeneral" },
  { id: "quick", label: "tabQuick" },
  { id: "receipt", label: "tabReceipt" },
  { id: "models", label: "tabModels" },
  { id: "instructions", label: "tabInstructions" },
  { id: "skills", label: "tabSkills" },
  { id: "templates", label: "tabTemplates" },
  { id: "mcp", label: "tabMcp" },
  { id: "folders", label: "tabFolders" },
];

/** Most recent chats offered; typing searches all of them. */
const MAX_CHATS = 200;

function Row({ icon, children, hint }: { icon: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint}
    </>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t, lang, toggleLanguage } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const sessions = useChatSessions();
  const projects = useProjects();
  const { skills } = useInstructions();
  const th = lang === "th";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chats = useMemo(
    () =>
      sessions
        .filter(isListedChat)
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_CHATS),
    [sessions],
  );
  const usable = useMemo(() => skills.filter((s) => s.enabled && s.name.trim()), [skills]);

  const run = (action: () => void) => {
    setOpen(false);
    // Let the dialog close (and give focus back) before the page changes.
    requestAnimationFrame(action);
  };

  /** Skills go into the chat box as a badge; from outside a chat, a new Cowork chat opens first. */
  const callSkill = (slug: string) =>
    run(() => {
      if (pathname === "/" || pathname.startsWith("/chat/")) {
        requestCompose({ skill: slug });
      } else {
        navigate("/?mode=cowork");
        window.setTimeout(() => requestCompose({ skill: slug }), 150);
      }
    });

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={th ? "ค้นหาคำสั่ง" : "Command palette"}
      description={th ? "พิมพ์เพื่อค้นหาแชท หน้า skill หรือคำสั่ง" : "Search chats, pages, skills and commands"}
      className="sm:max-w-xl"
    >
      <CommandInput placeholder={th ? "ค้นหาแชท หน้า skill หรือคำสั่ง…" : "Search chats, pages, skills, commands…"} />
      <CommandList className="max-h-[26rem] min-h-0 shrink">
        <CommandEmpty>{th ? "ไม่พบรายการที่ตรงกัน" : "Nothing matches."}</CommandEmpty>

        <CommandGroup heading={th ? "เริ่มใหม่" : "Start"}>
          <CommandItem value="new chat แชทใหม่" onSelect={() => run(() => navigate("/?mode=chat"))}>
            <Row icon={<MessageSquareIcon />}>{t("newChat")}</Row>
          </CommandItem>
          <CommandItem
            value="temporary chat แชทชั่วคราว private"
            onSelect={() => run(() => navigate(newChatHomeUrl("chat", { temporary: true })))}
          >
            <Row icon={<GhostIcon />}>{t("newTemporaryChat")}</Row>
          </CommandItem>
          <CommandItem value="new cowork งานใหม่ cowork" onSelect={() => run(() => navigate("/?mode=cowork"))}>
            <Row icon={<UsersIcon />}>{th ? "Cowork ใหม่" : "New Cowork"}</Row>
          </CommandItem>
          <CommandItem value="new code โค้ด" onSelect={() => run(() => navigate("/?mode=code"))}>
            <Row icon={<Code2Icon />}>{th ? "Code ใหม่" : "New Code"}</Row>
          </CommandItem>
        </CommandGroup>

        {chats.length > 0 && (
          <CommandGroup heading={th ? "แชท" : "Chats"}>
            {chats.map((chat) => (
              <CommandItem
                key={chat.id}
                value={`chat ${chat.title} ${chat.id}`}
                onSelect={() => run(() => navigate(`/chat/${chat.id}`))}
              >
                <Row icon={<MessagesSquareIcon />}>{chat.title || (th ? "แชทไม่มีชื่อ" : "Untitled chat")}</Row>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {usable.length > 0 && (
          <CommandGroup heading={th ? "Skill และแม่แบบเอกสาร" : "Skills & templates"}>
            {usable.map((skill) => {
              const template = skill.source?.startsWith("template:") || /fill_template/.test(skill.instructions);
              return (
                <CommandItem
                  key={skill.id}
                  value={`skill /${skillSlug(skill)} ${skill.name} ${skill.description}`}
                  onSelect={() => callSkill(skillSlug(skill))}
                >
                  <Row
                    icon={template ? <FileTextIcon /> : <SparklesIcon />}
                    hint={<CommandShortcut>/{skillSlug(skill)}</CommandShortcut>}
                  >
                    {skill.name}
                  </Row>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {projects.length > 0 && (
          <CommandGroup heading={t("projects")}>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={`project ${project.name}`}
                onSelect={() => run(() => navigate(`/projects/${project.id}`))}
              >
                <Row icon={<FolderKanbanIcon />}>{project.name}</Row>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={th ? "ไปที่" : "Go to"}>
          {[
            { to: "/inbox", label: t("inbox"), icon: <InboxIcon />, key: "inbox" },
            { to: "/outputs", label: t("outputs"), icon: <PackageIcon />, key: "outputs" },
            { to: "/usage", label: t("usage"), icon: <BarChart3Icon />, key: "usage" },
            { to: "/visual", label: t("visual"), icon: <ImageIcon />, key: "visual" },
            { to: "/projects", label: t("projects"), icon: <FolderKanbanIcon />, key: "projects" },
          ].map((page) => (
            <CommandItem key={page.to} value={`go ${page.key} ${page.label}`} onSelect={() => run(() => navigate(page.to))}>
              <Row icon={page.icon}>{page.label}</Row>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading={t("settings")}>
          {SETTINGS.map((tab) => (
            <CommandItem
              key={tab.id}
              value={`settings ${tab.id} ${t(tab.label)}`}
              onSelect={() => run(() => navigate(tab.id === "general" ? "/settings" : `/settings?tab=${tab.id}`))}
            >
              <Row icon={tab.id === "skills" ? <BookOpenIcon /> : <SettingsIcon />}>
                {t("settings")} · {t(tab.label)}
              </Row>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading={th ? "การแสดงผล" : "Appearance"}>
          <CommandItem
            value="theme dark light ธีม มืด สว่าง"
            onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
          >
            <Row icon={<SunMoonIcon />}>
              {resolvedTheme === "dark" ? (th ? "เปลี่ยนเป็นธีมสว่าง" : "Switch to light theme") : th ? "เปลี่ยนเป็นธีมมืด" : "Switch to dark theme"}
            </Row>
          </CommandItem>
          <CommandItem value="language ภาษา thai english ไทย อังกฤษ" onSelect={() => run(toggleLanguage)}>
            <Row icon={<LanguagesIcon />}>{th ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"}</Row>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        <span>{th ? "↑↓ เลือก · ↵ เปิด · esc ปิด" : "↑↓ to move · ↵ to open · esc to close"}</span>
        <span>{MOD}K</span>
      </div>
    </CommandDialog>
  );
}
