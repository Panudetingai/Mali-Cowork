"use client";

import { CodeDiff, DiffWrapContext } from "@/components/diff/code-diff";
import type { FileDiff } from "@/components/diff/types";
import { checkpointDiff } from "@/features/checkpoints";
import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** Agent turn vs checkpoint, same line diff as the Git panel. */
export function TurnReviewDiff({
  checkpointId,
  path,
  rel,
}: {
  checkpointId: string;
  path: string;
  rel: string;
}) {
  const [diff, setDiff] = useState<FileDiff>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setDiff(undefined);
    setError(undefined);
    void checkpointDiff(checkpointId, path)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [checkpointId, path]);

  return (
    <DiffWrapContext.Provider value={true}>
      <div className="h-full overflow-auto bg-background">
        {error ? (
          <p className="whitespace-pre-wrap px-4 py-6 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : diff ? (
          <CodeDiff diff={diff} path={rel} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <LoaderIcon className="size-4 animate-spin" />
          </div>
        )}
      </div>
    </DiffWrapContext.Provider>
  );
}
