/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module 'virtual:app-rules' {
  const rules: string;
  export default rules;
}
