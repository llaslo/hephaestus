import type { NextConfig } from "next";

const config: NextConfig = {
  // The DB driver must run on the server only.
  serverExternalPackages: ["postgres"],
};

export default config;
