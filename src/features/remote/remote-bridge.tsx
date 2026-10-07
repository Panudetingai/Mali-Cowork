/**
 * Mounted once in the main window: runs the mobile remote while it is on.
 * The model lists come from hooks, so the relay lives in a component.
 */
import type { WorkMode } from "@/features/opencode";
import { useModelCatalog } from "@/pages/chat/hooks/use-model-catalog";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { startRemoteRelay } from "./relay";
import { refreshRemoteStatus, shareRemoteDomainToken, startRemote, useRemoteEnabled } from "./settings";

export function RemoteBridge() {
  const enabled = useRemoteEnabled();
  useEffect(() => {
    if (enabled) void startRemote().then(shareRemoteDomainToken).catch(() => undefined);
  }, [enabled]);
  return enabled ? <RemoteRelay /> : null;
}

function RemoteRelay() {
  const navigate = useNavigate();
  const chat = useModelCatalog("chat");
  const cowork = useModelCatalog("cowork");
  const catalogs = useRef({ chat, cowork });
  catalogs.current = { chat, cowork };

  useEffect(
    () =>
      startRemoteRelay((mode: WorkMode) => {
        const { catalog } = catalogs.current[mode];
        return catalog;
      }),
    [],
  );

  useEffect(() => {
    let clients = 0;
    const stops = [
      listen<number>("remote:clients", (event) => {
        const next = event.payload;
        if (clients === 0 && next > 0) {
          navigate("/settings?tab=mobile");
          toast.success("Phone connected to Mali remote");
        }
        clients = next;
      }),
      listen<string>("remote:pending_ip", () => {
        void refreshRemoteStatus();
        navigate("/settings?tab=mobile");
        toast.message("A phone needs approval", { description: "Open Mobile settings to allow its IP." });
      }),
      listen<string>("remote:ip_allowed", () => void refreshRemoteStatus()),
      // The domain's certificate job started or finished.
      listen("remote:domain", () => void refreshRemoteStatus()),
    ];
    return () => {
      stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
    };
  }, [navigate]);

  return null;
}
