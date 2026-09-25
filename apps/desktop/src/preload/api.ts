import type {
  Channel,
  ChannelInput,
  ChannelOutput,
  EventName,
  EventPayload,
  IpcResult,
} from '../shared/ipc-contract';

/** `system.probe` → `{ system: { probe(...) } }`, derived from the contract's channel names. */
type Group<C extends Channel> = C extends `${infer G}.${string}` ? G : never;
type Method<C extends Channel, G extends string> = C extends `${G}.${infer M}` ? M : never;
type ChannelOf<G extends string, M extends string> = Extract<Channel, `${G}.${M}`>;

type Callable<C extends Channel> =
  void extends ChannelInput<C>
    ? () => Promise<IpcResult<ChannelOutput<C>>>
    : (input: ChannelInput<C>) => Promise<IpcResult<ChannelOutput<C>>>;

export type AmcApi = {
  [G in Group<Channel>]: {
    [M in Method<Channel, G>]: Callable<ChannelOf<G, M>>;
  };
} & {
  /** Subscribes to every main → renderer event; returns an unsubscribe function. */
  on(listener: (event: AmcEvent) => void): () => void;
};

export type AmcEvent = { [E in EventName]: { name: E; payload: EventPayload<E> } }[EventName];

declare global {
  interface Window {
    amc: AmcApi;
  }
}
