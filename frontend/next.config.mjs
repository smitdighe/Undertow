/** @type {import('next').NextConfig} */

// The backend is a separate Next app (backend/, default port 3001). Proxying
// /api/* through this app keeps everything same-origin from the browser's point
// of view, which is what makes NextAuth work across the split:
//   - the session cookie is set on THIS origin, so middleware.ts's getToken()
//     can read it (a direct cross-origin backend would break that),
//   - the GitHub OAuth callback URL stays on this origin, so the OAuth App
//     settings need no change.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
