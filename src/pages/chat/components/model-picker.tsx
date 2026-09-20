import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  type ModelSelectorLogoProps,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/animate-ui/primitives/radix/collapsible";
import {
  Tab,
  TabGroup,
  TabHighlight,
  TabHighlightItem,
  TabList,
  TabPanel,
  TabPanels,
} from "@/components/animate-ui/primitives/headless/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, KeyRoundIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { modelCategory, type AiModel, type ModelCategory } from "../models";

const CATEGORY_META: Record<ModelCategory, { label: string; hint: string }> = {
  agent: {
    label: "Agents",
    hint: "Works in a folder · tools, files and MCP",
  },
  model: {
    label: "Models",
    hint: "Called straight over its API with your key · billed per token",
  },
};

/** CLI agents come before OpenCode, which brings a long provider list. */
const GROUP_RANK = ["Cursor CLI", "Codex CLI", "Gemini CLI", "OpenCode"];

type Props = {
  models: AiModel[];
  selected: AiModel;
  loading?: boolean;
  onSelect: (model: AiModel) => void;
};

/** The single place to choose a model, OpenCode models included. */
/**
 * The agent in front of the model name for the CLIs, because their models are
 * named almost exactly like OpenCode's: picking "muse-spark-1.3-medium" from
 * the Cursor list and expecting OpenCode to answer is an easy mistake, and an
 * expensive one when the CLI runs on a different subscription.
 */
function agentLabel(model: AiModel) {
  if (model.source !== "cli") return model.name;
  return `${model.group.replace(/\s*CLI$/i, "")} · ${model.name}`;
}

export function ModelPicker({ models, selected, loading, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ModelCategory>(() => modelCategory(selected));
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  const byCategory = useMemo(() => splitByCategory(models), [models]);

  const categories = useMemo(() => {
    const list: ModelCategory[] = [];
    if (byCategory.agent.length > 0) list.push("agent");
    if (byCategory.model.length > 0) list.push("model");
    return list;
  }, [byCategory]);

  const categoryIndex = Math.max(0, categories.indexOf(category));

  const providerGroups = useMemo(
    () => sortGroups(groupByName(byCategory[category] ?? [])),
    [byCategory, category],
  );

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    const cat = modelCategory(selected);
    setCategory(categories.includes(cat) ? cat : (categories[0] ?? "agent"));
  }, [open, selected, categories]);

  useEffect(() => {
    if (!open) return;
    const initial = new Set<string>();
    for (const [name, items] of providerGroups) {
      if (groupIsConnected(items)) initial.add(name);
    }
    if (providerGroups.some(([name]) => name === selected.group)) {
      initial.add(selected.group);
    } else if (providerGroups[0]) {
      initial.add(providerGroups[0][0]);
    }
    setOpenGroups(initial);
  }, [open, category, providerGroups, selected.group]);

  const searching = search.trim().length > 0;

  const visibleModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!searching) return [];
    const all = (byCategory[category] ?? []).filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.group.toLowerCase().includes(q),
    );
    return sortModels(all);
  }, [byCategory, category, search, searching]);

  const toggleGroup = (name: string, next: boolean) => {
    setOpenGroups((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(name);
      else copy.delete(name);
      return copy;
    });
  };

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
          {modelIsConnected(selected) && <ConnectedDot />}
          <Logo provider={selected.provider} />
          <ModelSelectorName className="text-sm font-normal">
            {agentLabel(selected)}
          </ModelSelectorName>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        title="Select model"
        className="sm:max-w-lg"
        commandProps={{ shouldFilter: false }}
      >
        <TabGroup
          selectedIndex={categoryIndex}
          onChange={(index) => {
            setCategory(categories[index] ?? "agent");
            setSearch("");
          }}
        >
          {categories.length > 1 ? (
            <TabHighlight className="mx-2 mt-2 rounded-xl bg-muted/50 p-1">
              <TabList className="relative flex gap-0.5">
                {categories.map((id, index) => {
                  const connected = categoryHasConnected(byCategory[id]);
                  return (
                    <TabHighlightItem key={id} index={index} className="flex-1">
                      <Tab
                        index={index}
                        className={cn(
                          "flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                          "data-active:text-foreground",
                        )}
                      >
                        {connected && <ConnectedDot className="size-1.5" />}
                        {CATEGORY_META[id].label}
                      </Tab>
                    </TabHighlightItem>
                  );
                })}
              </TabList>
            </TabHighlight>
          ) : null}

          <ModelSelectorInput
            placeholder="Search in this list…"
            value={search}
            onValueChange={setSearch}
          />

          {categories.length > 1 ? (
            <TabPanels mode="auto-height" className="min-h-0">
              {categories.map((id) => (
                <TabPanel key={id} className="outline-none">
                  <CategoryPanel
                    id={id}
                    byCategory={byCategory}
                    loading={loading}
                    searching={searching}
                    category={category}
                    visibleModels={visibleModels}
                    openGroups={openGroups}
                    onToggleGroup={toggleGroup}
                    selected={selected}
                    onSelect={(model) => {
                      onSelect(model);
                      setOpen(false);
                    }}
                  />
                </TabPanel>
              ))}
            </TabPanels>
          ) : (
            <CategoryPanel
              id={categories[0] ?? "agent"}
              byCategory={byCategory}
              loading={loading}
              searching={searching}
              category={category}
              visibleModels={visibleModels}
              openGroups={openGroups}
              onToggleGroup={toggleGroup}
              selected={selected}
              onSelect={(model) => {
                onSelect(model);
                setOpen(false);
              }}
            />
          )}
        </TabGroup>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

function CategoryPanel({
  id,
  byCategory,
  loading,
  searching,
  category,
  visibleModels,
  openGroups,
  onToggleGroup,
  selected,
  onSelect,
}: {
  id: ModelCategory;
  byCategory: ReturnType<typeof splitByCategory>;
  loading?: boolean;
  searching: boolean;
  category: ModelCategory;
  visibleModels: AiModel[];
  openGroups: Set<string>;
  onToggleGroup: (name: string, open: boolean) => void;
  selected: AiModel;
  onSelect: (model: AiModel) => void;
}) {
  const emptyMessage =
    id === "agent"
      ? loading
        ? "Loading agents…"
        : "No agents available. Sign in to a CLI in Settings → Agents, or start the OpenCode server."
      : "No models yet. Add an API key in Settings → Models.";

  return (
    <>
      <p className="border-b px-3 py-2 text-[11px] text-muted-foreground">
        {CATEGORY_META[id].hint}
      </p>
      <ModelPickerBody
        groups={sortGroups(groupByName(byCategory[id] ?? []))}
        searching={searching && id === category}
        visibleModels={id === category ? visibleModels : []}
        emptyMessage={emptyMessage}
        openGroups={openGroups}
        onToggleGroup={onToggleGroup}
        selected={selected}
        onSelect={onSelect}
      />
    </>
  );
}

function ModelPickerBody({
  groups,
  searching,
  visibleModels,
  emptyMessage,
  openGroups,
  onToggleGroup,
  selected,
  onSelect,
}: {
  groups: [string, AiModel[]][];
  searching: boolean;
  visibleModels: AiModel[];
  emptyMessage: string;
  openGroups: Set<string>;
  onToggleGroup: (name: string, open: boolean) => void;
  selected: AiModel;
  onSelect: (model: AiModel) => void;
}) {
  if (searching) {
    return (
      <ModelSelectorList className="max-h-[min(16rem,45vh)]">
        <ModelSelectorEmpty>
          {visibleModels.length === 0 ? "No models match your search." : null}
        </ModelSelectorEmpty>
        {visibleModels.map((model) => (
          <ModelRow key={model.id} model={model} selected={selected} onSelect={onSelect} />
        ))}
      </ModelSelectorList>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <ModelSelectorList className="max-h-[min(16rem,45vh)] px-1 py-1">
      {groups.map(([name, items]) => (
        <ProviderSection
          key={name}
          name={name}
          items={sortModels(items)}
          isOpen={openGroups.has(name)}
          onOpenChange={(next) => onToggleGroup(name, next)}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </ModelSelectorList>
  );
}

function ProviderSection({
  name,
  items,
  isOpen,
  onOpenChange,
  selected,
  onSelect,
}: {
  name: string;
  items: AiModel[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selected: AiModel;
  onSelect: (model: AiModel) => void;
}) {
  const connected = groupIsConnected(items);
  const logo = items[0]?.provider ?? "opencode";

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange} className="mb-0.5">
      <CollapsibleTrigger
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/70"
      >
        {connected && <ConnectedDot title="Provider connected" />}
        {!connected && <span className="size-2 shrink-0" aria-hidden />}
        <Logo provider={logo} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
          {items.length}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-in-out",
            isOpen && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-1 pb-1">
        <div className="flex flex-col gap-0.5 pt-0.5">
          {items.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              selected={selected}
              onSelect={onSelect}
              compact
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
  compact,
}: {
  model: AiModel;
  selected: AiModel;
  onSelect: (model: AiModel) => void;
  compact?: boolean;
}) {
  const active = model.id === selected.id;
  const connected = modelIsConnected(model);

  return (
    <ModelSelectorItem
      value={model.id}
      disabled={!!model.coworkIssue}
      onSelect={() => onSelect(model)}
      className={cn(
        "min-w-0 gap-2 py-2 [&>svg:last-child]:hidden",
        compact && "ml-3 rounded-md",
        active && "bg-muted",
      )}
    >
      {connected ? (
        <ConnectedDot title="Ready to use" />
      ) : (
        <span className="size-2 shrink-0" aria-hidden />
      )}
      <Logo provider={model.provider} />
      {model.coworkIssue ? (
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
}

function ConnectedDot({
  className,
  title = "Connected",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "size-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_1px_rgba(16,185,129,0.45)] ring-2 ring-background",
        className,
      )}
    />
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

function modelIsConnected(model: AiModel) {
  return !model.needsKey && !model.needsLogin;
}

function groupIsConnected(items: AiModel[]) {
  return items.some(modelIsConnected);
}

function categoryHasConnected(models: AiModel[]) {
  return models.some(modelIsConnected);
}

function splitByCategory(models: AiModel[]) {
  const agent: AiModel[] = [];
  const model: AiModel[] = [];
  for (const entry of models) {
    if (modelCategory(entry) === "agent") agent.push(entry);
    else model.push(entry);
  }
  return { agent, model };
}

function groupByName(models: AiModel[]): [string, AiModel[]][] {
  const map = new Map<string, AiModel[]>();
  for (const model of models) {
    const list = map.get(model.group) ?? [];
    list.push(model);
    map.set(model.group, list);
  }
  return [...map.entries()];
}

/** CLI agents first in a fixed order, then connected groups, then A–Z. */
function sortGroups(groups: [string, AiModel[]][]): [string, AiModel[]][] {
  const rank = (name: string) => {
    const index = GROUP_RANK.indexOf(name);
    return index === -1 ? GROUP_RANK.length : index;
  };
  return [...groups].sort((a, b) => {
    const ra = rank(a[0]);
    const rb = rank(b[0]);
    if (ra !== rb) return ra - rb;
    const ca = groupIsConnected(a[1]);
    const cb = groupIsConnected(b[1]);
    if (ca !== cb) return ca ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });
}

function sortModels(items: AiModel[]): AiModel[] {
  return [...items].sort((a, b) => {
    const ca = modelIsConnected(a);
    const cb = modelIsConnected(b);
    if (ca !== cb) return ca ? -1 : 1;
    return Number(!!a.coworkIssue) - Number(!!b.coworkIssue) || a.name.localeCompare(b.name);
  });
}
