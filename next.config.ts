import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        // The 3D committee room was retired. Old links live on in browser history,
        // bookmarks and search results, so send them somewhere useful instead of a 404.
        source: "/committee",
        destination: "/",
        permanent: true
      }
    ];
  }
};

export default nextConfig;
