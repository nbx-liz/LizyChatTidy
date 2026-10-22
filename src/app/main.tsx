import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { targetTabIdFrom } from "./target";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("lizychattidy: missing #root element");
}
createRoot(container).render(
  <StrictMode>
    <App targetTabId={targetTabIdFrom(location.search)} />
  </StrictMode>,
);
