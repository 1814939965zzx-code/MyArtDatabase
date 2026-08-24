import { createRoot } from "react-dom/client";
import { AuthGate } from "./AuthGate";
import "./globals.css";

createRoot(document.getElementById("root")!).render(<AuthGate />);
