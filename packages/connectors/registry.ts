import { LiveConnectorStub } from "./live.js";
import { MockConnector } from "./mock.js";
import {
  ConnectorProvider,
  type Connector,
  type RotationPolicy,
} from "./types.js";

const ROTATION: Readonly<Record<ConnectorProvider, RotationPolicy>> = {
  shopify: "supported",
  stripe: "reissue-only",
  analytics: "reissue-only",
  resend: "supported",
  "cal-com": "manual",
  ads: "manual",
};

export class ConnectorRegistry {
  readonly #mock = new Map<ConnectorProvider, Connector>();
  readonly #live = new Map<ConnectorProvider, Connector>();

  register(connector: Connector): this {
    const target = connector.mode === "mock" ? this.#mock : this.#live;
    target.set(connector.provider, connector);
    return this;
  }

  resolve(providerInput: string, sandbox: boolean): Connector {
    const provider = ConnectorProvider.parse(providerInput);
    const connector = (sandbox ? this.#mock : this.#live).get(provider);
    if (!connector) throw new Error(`No ${sandbox ? "mock" : "live"} connector registered for ${provider}`);
    return connector;
  }
}

export function createConnectorRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  for (const provider of ConnectorProvider.options) {
    registry.register(new MockConnector(provider));
    registry.register(new LiveConnectorStub(provider, ROTATION[provider]));
  }
  return registry;
}
