"use client";

import {
    ModelSelector,
    ModelSelectorContent,
    ModelSelectorEmpty,
    ModelSelectorGroup,
    ModelSelectorInput,
    ModelSelectorItem,
    ModelSelectorList,
    ModelSelectorLogo,
    ModelSelectorName,
    ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import {
    ToggleGroup,
    ToggleGroupHighlight,
    ToggleGroupHighlightItem,
    ToggleGroupItem,
} from "@/components/animate-ui/primitives/radix/toggle-group";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
    ArrowRightIcon,
    ChevronDownIcon,
    Link,
    PlusIcon,
} from "lucide-react";
import React, { useState, type FormEvent } from "react";
import { useOpencodeConfig, OpencodeConfigPanel } from "@/features/opencode";

export type AiModel = {
  id: string;
  name: string;
  provider: "anthropic" | "openai" | "google" | "openrouter" | "groq" | "opencode" | "cursor" | "codex" | "socket";
  group: string;
};

export const AI_MODELS: AiModel[] = [
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    group: "Anthropic",
  },
  {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    provider: "anthropic",
    group: "Anthropic",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    group: "OpenAI",
  },
  {
    id: "o3-mini",
    name: "o3-mini",
    provider: "openai",
    group: "OpenAI",
  },
  {
    id: "gemini-2-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    group: "Google",
  },
  {
    id: "gemini-2-pro",
    name: "Gemini 2.0 Pro",
    provider: "google",
    group: "Google",
  },
  {
    id: "z-ai/glm-5.2:free",
    name: "Z-AI GLM 5.2",
    provider: "openrouter",
    group: "OpenRouter",
  },
  {
    id: "groq/gpt-oss-120b",
    name: "Groq GPT-OSS 120B",
    provider: "groq",
    group: "Groq",
  },
  {
    id: "cli:opencode",
    name: "OpenCode (local CLI)",
    provider: "opencode",
    group: "Local CLI",
  },
  {
    id: "cli:cursor",
    name: "Cursor Agent",
    provider: "cursor",
    group: "Local CLI",
  },
  {
    id: "cli:codex",
    name: "Codex (local CLI)",
    provider: "codex",
    group: "Local CLI",
  },
  {
    id: "socket:local",
    name: "Local Agent Server (SSE)",
    provider: "socket",
    group: "Local Socket",
  },
  {
    id: "socket:ws",
    name: "Local Agent Server (WebSocket)",
    provider: "socket",
    group: "Local Socket",
  },
  {
    id: "socket:tcp",
    name: "Local Agent Server (TCP)",
    provider: "socket",
    group: "Local Socket",
  }
];

const MODEL_GROUPS = [...new Set(AI_MODELS.map((m) => m.group))];

type PromptInputProps = {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  isLoading?: boolean;
  onSubmit: (payload: { prompt: string; modelId: string }) => void | Promise<void>;
};

export default function PromptInput({ ref, isLoading, onSubmit }: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0]);

  // opencode feature module: folder + model + thinking + auto-approve
  const opencodeConfig = useOpencodeConfig();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;

    await onSubmit({ prompt: trimmed, modelId: selectedModel.id });
    setPrompt("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative mx-auto w-full max-w-3xl rounded-xl border bg-card p-3 shadow-sm transition-colors focus-within:shadow-amber-300 focus-within:ring-1 focus-within:ring-amber-300"
    >
      <Textarea
        ref={ref}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="How can I help you today?"
        rows={3}
        disabled={isLoading}
        className="max-h-40 min-h-15 resize-none border-0 bg-transparent p-0 text-[15px] shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {/* OpenCode feature module: folder + model + thinking + auto-approve */}
      {selectedModel.provider === "opencode" && (
        <OpencodeConfigPanel config={opencodeConfig} />
      )}

      <div className="mt-2 flex items-center justify-between gap-2 pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DropdownAddFile />
          <TagsWorkspaceAI />
        </div>
        <ModelSelect selected={selectedModel} onSelect={setSelectedModel} />
        <ButtonSend isLoading={isLoading} disabled={!prompt.trim() || (selectedModel.provider === "opencode" && !!opencodeConfig.check && !opencodeConfig.check.available)} />
      </div>
    </form>
  );
}

function ModelSelect({
  selected,
  onSelect,
}: {
  selected: AiModel;
  onSelect: (model: AiModel) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild className="border-none shadow-none">
        <Button
          type="button"
          variant="ghost"
          className="max-w-44 shrink bg-background hover:bg-accent"
          aria-label="Select AI model"
        >
          <ModelSelectorLogo provider={selected.provider} />
          <ModelSelectorName className="text-sm font-normal">
            {selected.name}
          </ModelSelectorName>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent title="Select model">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {MODEL_GROUPS.map((group) => (
            <ModelSelectorGroup key={group} heading={group}>
              {AI_MODELS.filter((model) => model.group === group).map(
                (model) => (
                  <ModelSelectorItem
                    key={model.id}
                    value={model.id}
                    data-checked={selected.id === model.id}
                    onSelect={() => {
                      onSelect(model);
                      setOpen(false);
                    }}
                    className={cn(selected.id === model.id && "bg-muted")}
                  >
                    <ModelSelectorLogo provider={model.provider} />
                    <ModelSelectorName>{model.name}</ModelSelectorName>
                  </ModelSelectorItem>
                ),
              )}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

function TagsWorkspaceAI() {
  return (
    <ToggleGroup
      type="single"
      defaultValue="chat"
      className="flex w-fit items-center gap-2 rounded-md bg-foreground/5"
    >
      <ToggleGroupHighlight className="rounded-md bg-primary p-2">
        <ToggleGroupHighlightItem value="chat">
          <ToggleGroupItem value="chat" className="w-16 rounded-md p-1">
            <span className="text-sm">Chat</span>
          </ToggleGroupItem>
        </ToggleGroupHighlightItem>
        <ToggleGroupHighlightItem value="cowork">
          <ToggleGroupItem value="cowork" className="w-16 rounded-md p-1">
            <span className="text-sm">Cowork</span>
          </ToggleGroupItem>
        </ToggleGroupHighlightItem>
      </ToggleGroupHighlight>
    </ToggleGroup>
  );
}

function DropdownAddFile() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shrink-0 rounded-full border-border bg-background hover:bg-accent"
          aria-label="Add file"
          title="Add a file to the workspace"
        >
          <PlusIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="z-50 min-w-45 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <DropdownMenuItem
          onSelect={() => console.log("Add file")}
          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
        >
          <Link className="size-4" />
          <span className="text-sm">Add file or Photos</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ButtonSend({
  isLoading,
  disabled,
}: {
  isLoading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button type="submit" disabled={disabled || isLoading}>
      {isLoading ? "Sending..." : "Let's go"}
      <ArrowRightIcon />
    </Button>
  );
}
