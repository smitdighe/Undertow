/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // transformers.js loads onnxruntime-node's native .node binary at runtime;
    // webpack must not try to bundle/parse it — load from node_modules instead.
    serverComponentsExternalPackages: ["@xenova/transformers", "onnxruntime-node", "sharp"],
  },
};

export default nextConfig;
