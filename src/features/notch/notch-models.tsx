/**
 * Picking the model in the notch: the same models as the chat box offers in
 * Chat mode (API keys, Cursor, Antigravity, OpenCode), searchable, inside the
 * pill rather than in a popover the small window would cut off.
 */
import { ModelBrandIcon } from "@/features/providers";
import { cn } from "@/lib/utils";
import { chatIssueOf, OPENCODE_DEFAULT_ID, type AiModel, type ModelSource } from "@/pages/chat/models";
import { CheckIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { useNotchText } from "./text";

type Props = {
  catalog: AiModel[];
  /** Chat-only models (e.g. OpenCode Zen free) need a folder before they can run. */
  inFolder: boolean;
  loading: boolean;
  /** The model in use; `null` when following the Quick bar's. */
  selected: string | null;
  /** What following the Quick bar means right now. */
  defaultName: string;
  onPick: (id: string | null) => void;
  onClose: () => void;
};

/** Filters over the list; CLI agents come first, since they're easy to lose under many API models. */
const KINDS: { id: "all" | ModelSource; label: string }[] = [
  { id: "all", label: "" },
  { id: "cli", label: "CLI" },
  { id: "api", label: "API" },
  { id: "opencode", label: "OpenCode" },
];
const ORDER: Record<ModelSource, number> = { cli: 0, api: 1, local: 2, opencode: 3 };

export function NotchModels({ catalog, inFolder, loading, selected, defaultName, onPick, onClose }: Props) {
  const t = useNotchText();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("all");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const models = catalog
      .filter((m) => !m.issue && (kind === "all" || m.source === kind))
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.group.toLowerCase().includes(q))
      .sort((a, b) => ORDER[a.source] - ORDER[b.source]);
    const byGroup = new Map<string, AiModel[]>();
    for (const model of models) byGroup.set(model.group, [...(byGroup.get(model.group) ?? []), model]);
    return [...byGroup.entries()];
  }, [catalog, query, kind]);

  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] bg-white/[0.04]"
      initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 8, filter: "blur(4px)" }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <SearchIcon className="size-3.5 text-white/40" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          placeholder={t("searchModels")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35"
          spellCheck={false}
        />
        {loading && <Loader2Icon className="size-3.5 animate-spin text-white/40" />}
        <div className="flex shrink-0 gap-0.5 rounded-full bg-white/[0.06] p-0.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                kind === k.id ? "bg-white/[0.16] text-white" : "text-white/45 hover:text-white/80",
              )}
            >
              {k.label || t("all")}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!query && kind === "all" && (
          <Item
            active={selected === null}
            onClick={() => onPick(null)}
            name={defaultName}
            hint={inFolder ? t("coworksModel") : t("quickBarSettings")}
          />
        )}
        {groups.map(([group, models]) => (
          <div key={group} className="mt-1.5">
            <p className="px-2.5 pb-1 text-[10.5px] font-medium tracking-wide text-white/35 uppercase">{group}</p>
            {models.map((model) => (
              <Item
                key={model.id}
                active={selected === model.id}
                disabled={model.needsKey || model.needsLogin}
                onClick={() => onPick(model.id)}
                name={model.id === OPENCODE_DEFAULT_ID ? "Auto — OpenCode picks" : model.name}
                model={model}
                hint={
                  model.needsKey
                    ? t("addKey")
                    : model.needsLogin
                      ? t("signIn")
                      : !inFolder && chatIssueOf(model)
                        ? t("pickFolder")
                        : model.free
                          ? t("free")
                          : undefined
                }
              />
            ))}
          </div>
        ))}
        {!loading && groups.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-white/40">
            {query ? t("noMatch", { q: query }) : t("noModels")}
          </p>
        )}
      </div>
    </motion.div>
  );
}

function Item({
  name,
  model,
  hint,
  active,
  disabled,
  onClick,
}: {
  name: string;
  model?: AiModel;
  hint?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[13px] transition-colors",
        active ? "bg-white/[0.1] text-white" : "text-white/75 hover:bg-white/[0.06] hover:text-white",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:text-white">
        {model ? <ModelBrandIcon model={model} size={14} /> : <span className="size-1.5 rounded-full bg-white/50" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {hint && <span className="shrink-0 text-[11px] text-white/35">{hint}</span>}
      {active && <CheckIcon className="size-3.5 shrink-0 text-white/80" />}
    </button>
  );
}
