import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Две точки входа. Админка собирается в отдельный бандл, поэтому её код
      // не попадает в тот, который грузят все участники Mini App, а на странице
      // админки нет логики initData участников.
      input: {
        main: 'index.html',
        admin: 'admin.html',
      },
    },
  },
})
