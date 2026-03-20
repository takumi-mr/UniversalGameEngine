import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple';

// https://vite.dev/config/
export default defineConfig(() => {
  // 環境変数などでElectronモードかどうかを判定
  const isElectron = process.env.BUILD_TARGET === 'electron';
  return {
    plugins: [
      vue(),// Electronモードの時だけプラグインを有効化
      isElectron && electron({
        main: {
          // Mainプロセスのエントリーポイント
          entry: 'electron/main.ts',
          vite: {
            build: {
              rollupOptions: {
                external: [
                  '@grpc/grpc-js',
                  '@grpc/proto-loader'
                ],
              },
            },
          },
        },
        preload: {
          // Preloadスクリプトのエントリーポイント
          input: 'electron/preload.ts',
        },
        // RendererプロセスのNode.js統合機能など（基本はデフォルトでOK）
        renderer: {},
      }),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      server: {
        deps: {
          inline: ['vuetify']
        }
      }
    }
  }
})
