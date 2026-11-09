// One-command VR launch on the PC the headset is connected to.
// Builds the app, serves it on http://localhost (WebXR requires a secure context; localhost counts),
// and opens it in Microsoft Edge or Google Chrome. SteamVR must be running with the PS VR2 connected.
// Usage: npm run vr
import { build, preview } from "vite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT) || 4180;

console.log("Building MARS: FRONTIER (VR)…");
await build({ root, logLevel: "warn" });
const server = await preview({ root, preview: { host: "127.0.0.1", port: PORT, strictPort: false } });
const port = server.config.preview.port ?? PORT;
const url = `http://localhost:${port}/`;

console.log(`\nRunning at ${url}\n`);
console.log("1. Make sure SteamVR is running and shows the PS VR2 headset and both Sense controllers.");
console.log("2. In the browser, press  Enter VR  (or the VR button top-right), then put the headset on.");
console.log("Press Ctrl+C here to stop.\n");

// Open the page in a WebXR-capable browser (Windows): Edge first, then Chrome, else the default browser.
if (process.platform === "win32" && !process.env.NO_OPEN) {
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${local}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  const exe = candidates.find((p) => existsSync(p));
  // The URL is passed as an argument array (no shell), so nothing is interpolated into a command line.
  if (exe) spawn(exe, ["--new-window", url], { detached: true, stdio: "ignore" }).unref();
  else spawn("explorer.exe", [url], { detached: true, stdio: "ignore" }).unref();
}
