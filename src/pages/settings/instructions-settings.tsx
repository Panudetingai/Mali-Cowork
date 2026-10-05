import { Textarea } from "@/components/ui/textarea";
import { setCustomInstructions, useInstructions } from "@/features/instructions";
import { CheckIcon, ChevronRightIcon, Package } from "lucide-react";
import { useId } from "react";
import { useNavigate } from "react-router-dom";
import { settingsPath } from "./route";
import { SectionHeader, SettingsGroup, SettingsPage, Tile, TileButton } from "./ui";

/** A few lines that show what custom instructions are for. */
const IDEAS = [
  "I’m a product designer at a small studio.",
  "Answer in Thai unless I write in English.",
  "Keep answers short; use bullet points.",
  "Explain technical terms simply.",
];

export function InstructionsSettings() {
  const { custom, skills } = useInstructions();
  const navigate = useNavigate();
  const toSkills = () => navigate(settingsPath("skills"));
  const customId = useId();
  const add = (line: string) => setCustomInstructions(custom.trim() ? `${custom.trimEnd()}\n${line}` : line);

  return (
    <SettingsPage>
      <SectionHeader
        title="Instructions"
        description="Teach the AI how you like to work. Applies to every model and both modes."
      />

      <SettingsGroup
        title="Always keep in mind"
        description="About you, your work and how you want answers. Saved as you type."
      >
        <div className="flex flex-col gap-3 py-3.5">
          <div className="overflow-hidden rounded-xl border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <Textarea
              id={customId}
              aria-label="Custom instructions"
              value={custom}
              onChange={(event) => setCustomInstructions(event.target.value)}
              placeholder={"e.g. I'm a product designer. Keep answers short, use bullet points,\nand explain technical terms simply."}
              className="min-h-40 resize-y rounded-none border-0 text-sm leading-relaxed shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                {custom.trim() && <CheckIcon className="size-3 text-emerald-600" />}
                {custom.trim() ? "Saved" : "Nothing yet"}
              </span>
              <span className="tabular-nums">{custom.length} characters</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Ideas:</span>
            {IDEAS.filter((idea) => !custom.includes(idea)).map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => add(idea)}
                className="rounded-full border border-border/80 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                + {idea}
              </button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Skills"
        description="Instructions apply to everything. A skill applies to one kind of task — a weekly report, the way your team reviews code — and the AI picks it up when the task matches."
      >
        <div className="py-3.5">
          <Tile
            className="max-w-sm"
            icon={
              <span className="flex size-8 items-center justify-center rounded-lg">
                <Package style={{ width: 16, height: 16 }} />
              </span>
            }
            title={skills.length > 0 ? `Your skills · ${skills.length}` : "Add your first skill"}
            description="Write one, install one from GitHub, or start from a template."
            onOpen={toSkills}
            action={
              <TileButton label="Open Skills" onClick={toSkills}>
                <ChevronRightIcon />
              </TileButton>
            }
          />
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}
