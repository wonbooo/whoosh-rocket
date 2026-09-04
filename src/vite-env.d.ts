/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_KD_SERVER_URL: string;
  readonly VITE_KD_ACCT_ID: string;
  readonly VITE_KD_USERNAME: string;
  readonly VITE_KD_APP_ID: string;
  readonly VITE_KD_APP_SEC: string;
  readonly VITE_KD_LCID: string;
  readonly VITE_KD_ORG_NUM: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
