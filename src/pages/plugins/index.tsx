import { Button } from "@/components/ui/button";
import { requestCompose } from "@/features/command-palette";
import { useTranslation } from "@/features/i18n";
import {
  handlePanelMessage,
  isPanelMessage,
  panelUrl,
  usePlugins,
  type InstalledPlugin,
  type PluginPanel,
} from "@/features/plugins";
import { EmptyState, PageHeader, Tile, TileGrid } from "@/pages/settings/ui";
import { settingsPath } from "@/pages/settings/route";
import { LayoutPanelLeftIcon, PuzzleIcon, Settings2Icon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";

/**
 * `/plugins`: the panels plugins show, and `/plugins/:pluginId/:panelId`:
 * one of them, full size.
 */
export default function PluginsPage() {
  const { pluginId, panelId } = useParams();
  const { plugins } = usePlugins();
  const navigate = useNavigate();
  const plugin = plugins.find((p) => p.id === pluginId);
  const panel = plugin?.panels.find((p) => p.id === panelId);

  if (plugin && panel) return <PanelView plugin={plugin} panel={panel} />;

  const withPanels = plugins.filter((p) => p.enabled && p.panels.length);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        title="Plugins"
        description="Pages your plugins show. Each runs on its own, away from your files, keys and the internet."
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(settingsPath("plugins"))}>
            <Settings2Icon className="size-4" />
            Manage plugins
          </Button>
        }
      />
      {withPanels.length === 0 ? (
        <EmptyState
          icon={<PuzzleIcon />}
          title="No panels yet"
          description="Plugins that come with a page of their own show it here. Add plugins in Settings → Plugins."
        />
      ) : (
        <TileGrid>
          {withPanels.flatMap((p) =>
            p.panels.map((panel) => (
              <Tile
                key={`${p.id}/${panel.id}`}
                icon={<LayoutPanelLeftIcon className="text-violet-500" />}
                title={panel.title}
                description={p.name}
                onOpen={() => navigate(`/plugins/${encodeURIComponent(p.id)}/${encodeURIComponent(panel.id)}`)}
              />
            )),
          )}
        </TileGrid>
      )}
    </div>
  );
}

/**
 * One panel in a sandboxed frame. `allow-scripts` without `allow-same-origin`
 * gives it an opaque origin: no cookies, storage or Mali commands, and its
 * page's own policy blocks the network. It speaks to the app by message only.
 */
function PanelView({ plugin, panel }: { plugin: InstalledPlugin; panel: PluginPanel }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { lang: language } = useTranslation();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  const live = useRef({ theme, language, plugin });
  live.current = { theme, language, plugin };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only this panel's frame is listened to, whatever else posts messages.
      if (!frame.current || event.source !== frame.current.contentWindow || !isPanelMessage(event.data)) return;
      handlePanelMessage(event.data, {
        plugin: live.current.plugin,
        reply: (message) => frame.current?.contentWindow?.postMessage(message, "*"),
        theme: () => live.current.theme,
        locale: () => live.current.language,
        startChat: (text, mode) => {
          navigate(`/?mode=${mode}`);
          // Once the chat box is there; nothing is sent until the user presses Enter.
          window.setTimeout(() => requestCompose({ text }), 150);
        },
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  // The theme follows the app's.
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ mali: 1, type: "theme", theme }, "*");
  }, [theme]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <LayoutPanelLeftIcon className="size-4 text-violet-500" />
        <span className="truncate text-sm font-medium">{panel.title}</span>
        <span className="truncate text-xs text-muted-foreground">· {plugin.name}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => navigate(settingsPath("plugins", plugin.id))}
        >
          About
        </Button>
      </div>
      {plugin.enabled ? (
        <iframe
          ref={frame}
          key={`${plugin.id}/${panel.id}`}
          title={`${panel.title} — ${plugin.name}`}
          src={panelUrl(plugin.id, panel.entry)}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-background"
        />
      ) : (
        <div className="p-6">
          <EmptyState
            icon={<PuzzleIcon />}
            title={`${plugin.name} is off`}
            description="Turn it on in Settings → Plugins to use its panels."
          />
        </div>
      )}
    </div>
  );
}
