import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `three` powers exactly one thing: the hero's signature WebGL field (D7).
  // It is reached only through a runtime `import("./heroScene")` inside an
  // effect, so it is never evaluated during SSR and lands in an async chunk the
  // browser fetches after hydration. Listing it here keeps it unbundled on the
  // server side as well, which costs nothing and guarantees no WebGL code can
  // find its way into a Route Handler or a server render.
  //
  // Deliberately NOT `next/dynamic` with `ssr: false`, which would split the
  // bundle just as well but replace the server-rendered `<canvas>` with a
  // `BAILOUT_TO_CLIENT_SIDE_RENDERING` placeholder. See the header of
  // `src/components/site/heroScene.ts` for the reasoning and for what that
  // choice was once, incorrectly, blamed for.
  serverExternalPackages: ["three"],
};

export default nextConfig;
