import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'


var link = "https://2f9d9a532e38.ngrok-free.app/"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: [link.replace("https://","").replace("/","")],
  },
})
