import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isGitHubPagesBuild = process.env.VITE_GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  plugins: [react()],
  base: isGitHubPagesBuild && repositoryName ? `/${repositoryName}/` : "/",
  server: {
    port: 5173,
  },
});
