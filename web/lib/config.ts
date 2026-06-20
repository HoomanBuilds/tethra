import { getFullnodeUrl } from "@mysten/sui/client";

// Addresses from deployments/testnet.json (Sui testnet). The vault Move module is
// `vault`; the share coin type is `${PACKAGE}::vault::VAULT`.
export const NETWORK = "testnet" as const;
export const RPC_URL = getFullnodeUrl("testnet");

// Public DeepBook Predict indexer (read-only event/state surface).
export const PREDICT_INDEXER = "https://predict-server.testnet.mystenlabs.com";

export const PACKAGE =
  "0x2765b4a30258ef4660ec7d24fef8b0b32a700633c6dc1a57a80f988de6bc1d9e";
export const VAULT_ID =
  "0x21528665ba5731f9ffa2a7fe3024f87b77b86660a615118e2e3d1d150299aeb0";
export const PREDICT_OBJECT =
  "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";
export const DUSDC_TYPE =
  "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
export const SHARE_TYPE = `${PACKAGE}::vault::VAULT`;
export const CLOCK = "0x6";

export const DUSDC_DECIMALS = 6;
export const SHARE_DECIMALS = 9;
export const VIRTUAL = 1_000_000n;
export const BPS = 10_000;

export const EXPLORER = "https://suiscan.xyz/testnet";
export const explorerTx = (digest: string) => `${EXPLORER}/tx/${digest}`;
export const explorerObject = (id: string) => `${EXPLORER}/object/${id}`;
export const explorerAddress = (a: string) => `${EXPLORER}/account/${a}`;

// DUSDC test tokens are provided through the DeepBook Predict (Tally) faucet.
export const FAUCET_URL = "https://faucet.testnet.sui.io";
