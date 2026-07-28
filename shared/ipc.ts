export const IPC_CHANNELS = {
  getAppVersion: 'app:get-version',
} as const;

export interface AppApi {
  getAppVersion: () => Promise<string>;
}
