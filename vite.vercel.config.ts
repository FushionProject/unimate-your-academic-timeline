import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

// Opt-in hosting adapter. The default vite.config.ts and Wrangler preview
// remain the Cloudflare path; both include the same custom API/SSR entry.
// Nitro's documented Vite integration is currently version 3 (beta), pinned
// in package.json. Lovable 2.6.2 also requires Nitro 3; upgrading that wrapper
// would not remove this dependency and would change the Cloudflare build too.
export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  plugins: [
    nitro({
      preset: "vercel",
      vercel: {
        functions: { runtime: "nodejs22.x", maxDuration: 120 },
      },
    }),
  ],
});
