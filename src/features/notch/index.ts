export * from "./types";
export * from "./settings";
export { startNotchRelay } from "./relay";
export { goToNotchMode, playMainReturn } from "./notch-mode";
export { getNotchLoginItem, onOpenTeam, setNotchLoginItem, type NotchScreen } from "./bridge";
export { checkMainAwake, mainAwake, onMainAwake, useMainAwake } from "./notch-mode";
