import "./styles/app.css";
import "./styles/overrides.css";
import { initRemote } from "./boot";
import { attachDockKeyboardUX } from "./components/dock-keyboard";
import { installIosAppShell } from "./components/ios-app-shell";

installIosAppShell();
initRemote();
attachDockKeyboardUX();
