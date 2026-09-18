import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  type ModelSelectorLogoProps,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, KeyRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { AiModel, ModelSource } from "../models";

/** How each source is labelled, so API models and CLI agents read apart. */
const SOURCES: Record<ModelSource, { tag: string; hint: string; className: string }> = {
  api: {
    tag: "API",
    hint: "Your API key · billed per token",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  },
  local: {
    tag: "Local",
    hint: "Runs on this computer",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  cli: {
    tag: "CLI",
    hint: "Agent app on this computer · uses your signed-in plan",
    className: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  },
  opencode: {
    tag: "OpenCode",
    hint: "Through OpenCode",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
};

type Props = {
  models: AiModel[];
  selected: AiModel;
  loading?: boolean;
  onSelect: (model: AiModel) => void;
};

/** The single place to choose a model, OpenCode models included. */
export function ModelPicker({ models, selected, loading, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupModels(models), [models]);

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="max-w-56 min-w-0 gap-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Select AI model"
        >
          <Logo provider={selected.provider} />
          <ModelSelectorName className="text-sm font-normal">
            {selected.name}
          </ModelSelectorName>
          <SourceTag source={selected.source} />
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent title="Select model">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList className="max-h-[min(18rem,50vh)]">
          <ModelSelectorEmpty>
            {loading ? "Loading OpenCode models…" : "No models found. Add one in Settings → Models."}
          </ModelSelectorEmpty>
          {groups.map(({ key, source, group, items }) => (
            <ModelSelectorGroup key={key} heading={<GroupHeading source={source} group={group} />}>
              {items.map((model) => {
                const active = model.id === selected.id;
                return (
                  <ModelSelectorItem
                    key={model.id}
                    value={`${SOURCES[model.source].tag} ${model.group} ${model.name} ${model.id}`}
                    disabled={!!model.coworkIssue}
                    onSelect={() => {
                      onSelect(model);
                      setOpen(false);
                    }}
                    className={cn(
                      "min-w-0 gap-2 py-2 [&>svg:last-child]:hidden",
                      active && "bg-muted",
                    )}
                  >
                    <Logo provider={model.provider} />
                    {model.coworkIssue ? (
                      // Disabled items get no pointer events, so the reason is spelled out.
                      <div className="flex min-w-0 flex-1 flex-col">
                        <ModelSelectorName className="min-w-0">{model.name}</ModelSelectorName>
                        <span className="truncate text-[11px] text-muted-foreground">{model.coworkIssue}</span>
                      </div>
                    ) : (
                      <ModelSelectorName className="min-w-0">{model.name}</ModelSelectorName>
                    )}
                    <ModelBadge model={model} />
                    {active && <CheckIcon className="size-4 shrink-0 text-foreground" />}
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

function ModelBadge({ model }: { model: AiModel }) {
  if (model.coworkIssue) {
    return (
      <span className="ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
        Not for Cowork
      </span>
    );
  }
  if (model.needsLogin) {
    return (
      <span
        title={`Sign in to ${model.group} to use its models`}
        className="ml-auto flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        <KeyRoundIcon className="size-2.5" />
        Sign in
      </span>
    );
  }
  if (model.needsKey) {
    return (
      <span
        title="Needs an API key — you'll be asked to add one"
        className="ml-auto flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        <KeyRoundIcon className="size-2.5" />
        Key
      </span>
    );
  }
  if (model.free) {
    return (
      <span className="ml-auto shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        Free
      </span>
    );
  }
  return <span className="ml-auto" />;
}

function SourceTag({ source }: { source: ModelSource }) {
  const { tag, className } = SOURCES[source];
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 py-px text-[10px] font-medium leading-4",
        className,
      )}
    >
      {tag}
    </span>
  );
}

function GroupHeading({ source, group }: { source: ModelSource; group: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <SourceTag source={source} />
      <span className="truncate font-medium text-foreground">{group}</span>
      <span className="truncate font-normal">· {SOURCES[source].hint}</span>
    </span>
  );
}

function Logo({ provider }: { provider: string }) {
  return (
    <ModelSelectorLogo
      provider={provider as ModelSelectorLogoProps["provider"]}
      className="size-4 shrink-0"
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

/**
 * Models by source and group, with the ones unfit for Cowork last in each.
 * Keyed by source too, so e.g. the Gemini API and Gemini CLI never merge.
 */
function groupModels(models: AiModel[]) {
  const groups = new Map<string, { key: string; source: ModelSource; group: string; items: AiModel[] }>();
  for (const model of models) {
    const key = `${model.source}:${model.group}`;
    const entry = groups.get(key) ?? { key, source: model.source, group: model.group, items: [] };
    entry.items.push(model);
    groups.set(key, entry);
  }
  return [...groups.values()].map((entry) => ({
    ...entry,
    items: [...entry.items].sort((a, b) => Number(!!a.coworkIssue) - Number(!!b.coworkIssue)),
  }));
}
