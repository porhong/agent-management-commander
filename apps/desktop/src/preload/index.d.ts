import type { ChannelOutput, IpcResult } from '../shared/ipc-contract';

export interface AmcApi {
  system: {
    probe(): Promise<IpcResult<ChannelOutput<'system.probe'>>>;
  };
}

declare global {
  interface Window {
    amc: AmcApi;
  }
}
