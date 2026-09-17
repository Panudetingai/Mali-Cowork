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
import type { AiModel } from "../models";

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
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent title="Select model">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList className="max-h-[min(18rem,50vh)]">
          <ModelSelectorEmpty>
            {loading ? "Loading OpenCode models…" : "No models found. Add one in Settings → Models."}
          </ModelSelectorEmpty>
          {groups.map(([group, items]) => (
            <ModelSelectorGroup key={group} heading={group}>
              {items.map((model) => {
                const active = model.id === selected.id;
                return (
                  <ModelSelectorItem
                    key={model.id}
                    value={`${model.group} ${model.name} ${model.id}`}
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
                    <ModelSelectorName className="min-w-0">{model.name}</ModelSelectorName>
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
  if (model.needsLogin) {
    return (
      <span
        title="Sign in to Cursor to use its models"
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

function groupModels(models: AiModel[]) {
  const groups = new Map<string, AiModel[]>();
  for (const model of models) {
    groups.set(model.group, [...(groups.get(model.group) ?? []), model]);
  }
  return [...groups];
}
