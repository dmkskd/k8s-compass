import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'production' && visualizer({
      filename: 'dist/bundle-stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
    mode === 'production' && visualizer({
      filename: 'dist/bundle-stats.json',
      template: 'raw-data',
      gzipSize: true,
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Stub out troika-three-text to prevent worker issues in single-file mode (production only)
      ...(mode === 'production' ? {
        'troika-three-text': path.resolve(__dirname, './src/shared/stubs/troika-stub.ts'),
      } : {}),
    },
  },
  // Use relative paths for assets so the build works from file:// or any host
  base: mode === 'production' ? './' : '/',
  build: {
    outDir: 'dist',
    sourcemap: mode !== 'production',
    // Keep CSS separate (not inlined into JS)
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Single JS bundle
        manualChunks: undefined,
        // Ensure everything is in one file
        inlineDynamicImports: true,
      },
    },
  },
  publicDir: 'public',
}))
