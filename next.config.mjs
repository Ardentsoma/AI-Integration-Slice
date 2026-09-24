/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the dev server's Hot Module Replacement websocket when the app is
  // opened from another device on the LAN (via the machine's network IP).
  allowedDevOrigins: ["10.173.26.91"],
};

export default nextConfig;