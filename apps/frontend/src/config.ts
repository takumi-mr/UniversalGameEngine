/**
 * バックエンド（HTTP API / Socket.IO）の接続先。
 * ビルド時に VITE_API_BASE_URL で上書きする（docker-compose.yml / Dockerfile 参照）。
 * 未指定ならローカル開発用のバックエンドを指す。
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3000";
