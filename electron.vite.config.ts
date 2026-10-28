import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

const core = { '@core': resolve(__dirname, 'src/core') }

export default defineConfig(({ mode }) => {
  // Khóa Google đọc từ file .env (không commit). Client ID/secret của app desktop không thật sự bí mật
  // (Google coi app cài trên máy là public client), nhưng vẫn không đưa vào git.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: core },
      define: {
        __GOOGLE_CLIENT_ID__: JSON.stringify(env.GOOGLE_CLIENT_ID ?? ''),
        __GOOGLE_CLIENT_SECRET__: JSON.stringify(env.GOOGLE_CLIENT_SECRET ?? '')
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: core }
    },
    renderer: {
      root: 'src/renderer',
      plugins: [react()],
      resolve: { alias: core }
    }
  }
})
