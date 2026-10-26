import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/app.css";
import { checkShaders } from "./map/terrain/gl";

// for the console: builds every shader program and lists any errors
(window as unknown as { checkShaders: () => string[] }).checkShaders = checkShaders;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
