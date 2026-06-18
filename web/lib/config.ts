import { getFullnodeUrl } from "@mysten/sui/client";

// Addresses from deployments/testnet.json (Sui testnet). The vault Move module is
// `vault`; the share coin type is `${PACKAGE}::vault::VAULT`.
export const NETWORK = "testnet" as const;
export const RPC_URL = getFullnodeUrl("testnet");

export const PACKAGE =
  "0xc5af7e1c3bf297aa38acc3804b3935cdb440e8955c4eb3d4ec153c21b4890db8";
export const VAULT_ID =
  "0x5ed0b38cd386fd9e7503dc4bea482087e24c3e86c0599baa196b6be0fecf9f86";
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
