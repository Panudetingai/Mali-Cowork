import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import type { AiModel } from "@/pages/chat/models";
import { ModelBrandIcon } from "@/features/providers";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * The model that will draw. Grouped by provider, because that is what decides
 * both the bill and the house style, and there is nothing else to say about a
 * picture model — no context window, no tools, no agent.
 */
export function VisualModelSelect({
  models,
  selected,
  onSelect,
  disabled,
}: {
  models: AiModel[];
  selected?: AiModel;
  onSelect: (model: AiModel) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const byProvider = new Map<string, AiModel[]>();
    for (const model of models) {
      if (query && !`${model.name} ${model.group}`.toLowerCase().includes(query)) continue;
      const list = byProvider.get(model.group) ?? [];
      list.push(model);
      byProvider.set(model.group, list);
    }
    return [...byProvider.entries()].map(([group, items]) => ({
      group,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [models, query]);

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || models.length === 0}
          className="h-8 max-w-64 min-w-0 gap-1.5 rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Select the model that draws"
        >
          {selected && <ModelBrandIcon model={selected} className="size-4" />}
          <ModelSelectorName className="text-sm font-normal">
            {selected?.name ?? (models.length === 0 ? "No model yet" : "Choose a model")}
          </ModelSelectorName>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        title="Select model"
        className="max-h-[min(28rem,80svh)] sm:max-w-md"
        commandProps={{ shouldFilter: false }}
      >
        <ModelSelectorInput
          placeholder="Search models…"
          value={search}
          onValueChange={setSearch}
        />
        {groups.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            {query ? "No models match your search." : "Nothing here yet."}
          </p>
        ) : (
          <ModelSelectorList className="max-h-[22rem] px-1 py-1">
            {groups.map(({ group, items }) => (
              <div key={group}>
                <p className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {group}
                </p>
                {items.map((model) => (
                  <ModelSelectorItem
                    key={model.id}
                    value={model.id}
                    onSelect={() => {
                      onSelect(model);
                      setOpen(false);
                    }}
                    className={cn(
                      "min-w-0 gap-2 py-2 [&>svg:last-child]:hidden",
                      model.id === selected?.id && "bg-muted",
                    )}
                  >
                    <ModelBrandIcon model={model} className="size-4" />
                    <ModelSelectorName className="min-w-0">{model.name}</ModelSelectorName>
                    {model.id === selected?.id && (
                      <CheckIcon className="ml-auto size-4 shrink-0 text-foreground" />
                    )}
                  </ModelSelectorItem>
                ))}
              </div>
            ))}
          </ModelSelectorList>
        )}
      </ModelSelectorContent>
    </ModelSelector>
  );
}

