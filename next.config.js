/** @type {import('next').NextConfig} */
const { version } = require("./package.json");

module.exports = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: __dirname,
  env: { NEXT_PUBLIC_APP_VERSION: version },
};
