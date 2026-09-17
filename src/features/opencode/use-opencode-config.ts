import { useCallback, useEffect, useState } from "react";
import {
  opencodeCheck,
  opencodeDefaultCwd,
  opencodeListModels,
} from "./api";
import type {
  OpencodeCheckResult,
  OpencodeConfig,
  OpencodeModelsResult,
} from "./types";

const STORAGE_KEYS = {
  cwd: "opencode_cwd",
  model: "opencode_model",
  thinking: "opencode_thinking",
  autoApprove: "opencode_auto_approve",
} as const;

function loadConfig(): Partial<OpencodeConfig> {
  try {
    return {
      cwd: localStorage.getItem(STORAGE_KEYS.cwd) || undefined,
      model: localStorage.getItem(STORAGE_KEYS.model) || undefined,
      thinking: localStorage.getItem(STORAGE_KEYS.thinking) === "true",
      autoApprove:
        localStorage.getItem(STORAGE_KEYS.autoApprove) === "true",
    };
  } catch {
    return {};
  }
}

function saveConfig(config: Partial<OpencodeConfig>) {
  try {
    if (config.cwd !== undefined) {
      localStorage.setItem(STORAGE_KEYS.cwd, config.cwd);
    }
    if (config.model !== undefined) {
      localStorage.setItem(STORAGE_KEYS.model, config.model);
    }
    if (config.thinking !== undefined) {
      localStorage.setItem(STORAGE_KEYS.thinking, String(config.thinking));
    }
    if (config.autoApprove !== undefined) {
      localStorage.setItem(
        STORAGE_KEYS.autoApprove,
        String(config.autoApprove),
      );
    }
  } catch {
    // ignore storage errors (e.g. private mode)
  }
}

export type OpencodeConfigState = OpencodeConfig & {
  check: OpencodeCheckResult | null;
  models: OpencodeModelsResult | null;
  loading: boolean;
  setCwd: (cwd: string) => void;
  setModel: (model: string) => void;
  setThinking: (enabled: boolean) => void;
  setAutoApprove: (enabled: boolean) => void;
  refresh: () => Promise<void>;
};

export function useOpencodeConfig(): OpencodeConfigState {
  const saved = loadConfig();
  const [cwd, setCwdState] = useState(saved.cwd ?? "");
  const [model, setModelState] = useState(saved.model ?? "");
  const [thinking, setThinkingState] = useState(saved.thinking ?? false);
  const [autoApprove, setAutoApproveState] = useState(saved.autoApprove ?? false);
  const [check, setCheck] = useState<OpencodeCheckResult | null>(null);
  const [models, setModels] = useState<OpencodeModelsResult | null>(null);
  const [loading, setLoading] = useState(false);

  const setCwd = useCallback((value: string) => {
    setCwdState(value);
    saveConfig({ cwd: value });
  }, []);

  const setModel = useCallback((value: string) => {
    setModelState(value);
    saveConfig({ model: value });
  }, []);

  const setThinking = useCallback((value: boolean) => {
    setThinkingState(value);
    saveConfig({ thinking: value });
  }, []);

  const setAutoApprove = useCallback((value: boolean) => {
    setAutoApproveState(value);
    saveConfig({ autoApprove: value });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [checkRes, defaultCwd, modelsRes] = await Promise.all([
        opencodeCheck(),
        opencodeDefaultCwd(),
        opencodeListModels(),
      ]);
      setCheck(checkRes);
      setModels(modelsRes);
      if (!cwd) {
        setCwdState(defaultCwd);
        saveConfig({ cwd: defaultCwd });
      }
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    refresh();
  }, []);

  return {
    cwd,
    model,
    thinking,
    autoApprove,
    check,
    models,
    loading,
    setCwd,
    setModel,
    setThinking,
    setAutoApprove,
    refresh,
  };
}
