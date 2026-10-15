import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Identifies this build; the running app compares it with /version.json to
// notice when a newer version has been deployed.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())

const versionFile = (): Plugin => ({
  name: 'version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
})
