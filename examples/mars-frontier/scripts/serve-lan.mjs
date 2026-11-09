// One-command phone access: builds the production app and serves it on your Wi-Fi.
// Usage: npm run phone   (then open one of the printed addresses on your iPhone)
import { build, preview } from "vite";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

console.log("Building MARS: FRONTIER…");
await build({ root, logLevel: "warn" });

const server = await preview({ root, preview: { host: "0.0.0.0", port: PORT, strictPort: false } });
const actual = server.config.preview.port ?? PORT;

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n.address);

console.log("\nMARS: FRONTIER is running.\n");
console.log("  On this computer:  http://localhost:" + actual + "/");
for (const ip of lan) console.log("  On your iPhone:    http://" + ip + ":" + actual + "/");
console.log("\nSame Wi-Fi as the iPhone required. Press Ctrl+C to stop.");
console.log("If the phone can't connect, allow Node.js on Private networks in Windows Firewall (see README).\n");
