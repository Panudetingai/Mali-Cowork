import { createStore } from "@/lib/local-store";
import { DEFAULT_TIME_SAVED_RATES } from "./receipt";
import type { TimeSavedRates } from "./types";

type StoredSettings = {
  rates: TimeSavedRates;
};

const store = createStore<StoredSettings>(
  { rates: DEFAULT_TIME_SAVED_RATES },
  {
    key: "mali_work_receipt_settings",
    revive: (value) => ({
      rates: {
        perFileCreated: Number(value?.rates?.perFileCreated) || DEFAULT_TIME_SAVED_RATES.perFileCreated,
        perFileModified: Number(value?.rates?.perFileModified) || DEFAULT_TIME_SAVED_RATES.perFileModified,
        perCommand: Number(value?.rates?.perCommand) || DEFAULT_TIME_SAVED_RATES.perCommand,
        perConnectorCall: Number(value?.rates?.perConnectorCall) || DEFAULT_TIME_SAVED_RATES.perConnectorCall,
      },
    }),
  },
);

export const getTimeSavedRates = () => store.get().rates;
export const useTimeSavedRates = () => store.use().rates;

export function setTimeSavedRate<K extends keyof TimeSavedRates>(key: K, value: number) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return;
  store.set((s) => ({ ...s, rates: { ...s.rates, [key]: num } }));
}

export function resetTimeSavedRates() {
  store.set((s) => ({ ...s, rates: DEFAULT_TIME_SAVED_RATES }));
}
