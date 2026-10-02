import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// IBM Plex: Sans for the interface, Mono for live numeric readouts only.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
// Devanagari and Telugu for the SMS previews.
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-telugu/400.css";

import "./theme.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
