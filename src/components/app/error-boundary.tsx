import { Button } from "@/components/ui/button";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** "page": one page failed, the app around it still works. "app": the last resort. */
  scope: "page" | "app";
  /** After a failure, a new value (the next page) clears it. Unused otherwise, so nothing remounts. */
  resetKey?: string;
};

type State = { error: Error | null };

/**
 * Without this, one component throwing while it renders unmounts the whole
 * app and leaves a blank white window with nothing to click. A page that
 * fails shows what went wrong and a way back instead; the sidebar stays.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.scope}] render failed:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const app = this.props.scope === "app";
    return (
      <div className={app ? "flex h-svh items-center justify-center bg-background p-6" : "flex flex-1 items-center justify-center p-6"}>
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangleIcon className="size-5" />
          </span>
          <h2 className="text-base font-semibold">
            {app ? "Mali ran into a problem" : "This page ran into a problem"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {app
              ? "Your chats and files are safe. Reload to carry on."
              : "Your chats and files are safe. Try again, or open another page from the sidebar."}
          </p>
          <pre className="max-h-32 w-full overflow-auto rounded-lg bg-muted px-3 py-2 text-left text-[11px] whitespace-pre-wrap text-muted-foreground">
            {error.message || String(error)}
          </pre>
          <div className="flex gap-2">
            {!app && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={this.reset}>
                <RotateCcwIcon className="size-3.5" />
                Try again
              </Button>
            )}
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload Mali
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
