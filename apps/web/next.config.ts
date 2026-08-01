import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  reactStrictMode: true,
  // Internal packages ship TypeScript source rather than a build artifact, so
  // there is no build step between editing a package and seeing it in the app.
  transpilePackages: [
    "@kiln/ui", "@kiln/contracts", "@kiln/db", "@kiln/config", "@kiln/runtime",
    "@kiln/playbooks", "@kiln/agents", "@kiln/tools", "@kiln/quality",
    "@kiln/design-engine", "@kiln/observability", "@kiln/model-gateway",
    "@kiln/billing", "@kiln/mirror", "@kiln/jobs", "@kiln/mcp",
  ],
  // PGlite and libsodium are native/WASM and must not be bundled for RSC.
  serverExternalPackages: ["@electric-sql/pglite", "libsodium-wrappers", "postgres"],
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  webpack: (webpackConfig, { isServer }) => {
    // Workspace packages use NodeNext-style `.js` specifiers while shipping
    // TypeScript source. Teach webpack the same source substitution that tsx
    // and TypeScript already perform.
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    // `serverExternalPackages` does not currently externalise PGlite when the
    // import originates in a transpiled workspace package. Bundling it rewrites
    // its `import.meta.url` asset URLs and Node then rejects the resulting URL
    // object while loading the WASM bundle. Force the Node build to use the
    // package's CommonJS entrypoint unchanged.
    if (isServer) {
      webpackConfig.externals.push({
        "@electric-sql/pglite": "commonjs @electric-sql/pglite",
      });
    }
    return webpackConfig;
  },
  eslint: { ignoreDuringBuilds: true },
};

export default config;
