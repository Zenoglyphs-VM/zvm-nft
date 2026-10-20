// Every fixed address on this stack, NoM and ZVM side, with a name and what
// it's for — the explorer's answer to "what is 0xDeaD…0002".
//
// NoM's embedded contracts only ever appear in their z1… spelling, so those
// entries are keyed on that form and converted to hex once, below.
// Source of truth: go-zenon/common/types/address.go.
//
// The ZVM side has two kinds of fixed address. Genesis predeploys (real
// deployed code) are also named server-side as `info.predeploy`
// (internal/l2/genesis.go) and shown as a badge on that address's own page;
// repeating them here additionally labels them wherever AddressLink renders
// them inline (tx tables, transfer lists, …), which the backend field does
// not reach. System accounts with no code — the OP-Stack depositors and fee
// vaults — aren't genesis predeploys at all and have no label anywhere else.
// Source of truth: internal/rollup/params.go and internal/l2/genesis.go.
// (Deliberately excluded: rollup.Vault, the bridge's NoM-side custody
// account — it's derived per-deployment, not a network-wide constant.)

import {nomToHex} from './address'

interface KnownAddress {
  name: string
  description: string
}

const ZVM_ADDRESSES: Record<string, KnownAddress> = {
  '0xDeaDDEaDDeAdDeAdDEAdDEaddeAddEAdDEAd0001': {
    name: 'L1InfoDepositor',
    description: 'System sender for the deposit tx that sets each block’s L1Block values.',
  },
  '0xDeaDDEaDDeAdDeAdDEAdDEaddeAddEAdDEAd0002': {
    name: 'SystemDepositor',
    description: "System sender for the bridge's derived deposit calls.",
  },
  '0x4200000000000000000000000000000000000011': {
    name: 'SequencerFeeVault',
    description: "Accumulates the sequencer's share of transaction fees.",
  },
  '0x4200000000000000000000000000000000000015': {
    name: 'L1Block',
    description: 'Predeploy holding the latest known L1 block’s attributes.',
  },
  '0x4200000000000000000000000000000000000016': {
    name: 'L2ToL1MessagePasser',
    description: 'Predeploy whose storage root is committed to each block’s withdrawalsRoot.',
  },
  '0x4200000000000000000000000000000000000019': {
    name: 'BaseFeeVault',
    description: 'Accumulates the base fee burned by transactions on this chain.',
  },
  '0x420000000000000000000000000000000000001a': {
    name: 'L1FeeVault',
    description: 'Accumulates the L1 data-posting fee charged to transactions.',
  },
  '0x4200000000000000000000000000000000000100': {
    name: 'ZVMBridge',
    description: 'Locks and releases value moving between the ZVM and Zenon.',
  },
  '0x4200000000000000000000000000000000000101': {
    name: 'WrappedQSR',
    description: 'The ZVM’s ERC-20 wrapper for QSR bridged from Zenon.',
  },
  '0x000000000022D473030F116dDEE9F6B43aC78BA3': {
    name: 'Permit2',
    description: "Uniswap's shared token-approval contract.",
  },
  '0x0000000071727De22E5E9d8BAf0edAc6f37da032': {
    name: 'EntryPoint_v07',
    description: 'ERC-4337 account-abstraction entry point, v0.7.',
  },
  '0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C': {
    name: 'SenderCreator_v07',
    description: 'Deploys ERC-4337 smart accounts on their first user operation.',
  },
  '0xcA11bde05977b3631167028862bE2a173976CA11': {
    name: 'Multicall3',
    description: 'Batches many read calls into one, standard across EVM chains.',
  },
  '0x4e59b44847b379578588920cA78FbF26c0B4956C': {
    name: 'Create2Deployer_Arachnid',
    description: 'The standard deterministic CREATE2 factory used by most tooling.',
  },
  '0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7': {
    name: 'SafeSingletonFactory',
    description: 'The CREATE2 factory Safe wallets deploy through.',
  },
  '0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02': {
    name: 'BeaconRoots (EIP-4788)',
    description: "Ethereum protocol predeploy storing recent beacon block roots.",
  },
  '0x0000F90827F1C53a10cb7A02335B175320002935': {
    name: 'HistoryStorage (EIP-2935)',
    description: 'Ethereum protocol predeploy storing recent block hashes.',
  },
  '0x000000000000000000000000000000000000dEaD': {
    name: 'Burn',
    description: 'A conventional unspendable address; tokens sent here are gone.',
  },
}

const NOM_CONTRACTS: Record<string, KnownAddress> = {
  'z1qxemdeddedxpyllarxxxxxxxxxxxxxxxsy3fmg': {
    name: 'Pillar',
    description: 'Registers pillars and runs delegation, the block-producing rotation.',
  },
  'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp': {
    name: 'Plasma',
    description: 'Fuses QSR into plasma, the fee an account spends to send transactions.',
  },
  'z1qxemdeddedxstakexxxxxxxxxxxxxxxxjv8v62': {
    name: 'Stake',
    description: 'Locks ZNN for a term in exchange for QSR rewards.',
  },
  'z1qxemdeddedxsp0rkxxxxxxxxxxxxxxxx956u48': {
    name: 'Spork',
    description: 'Activates protocol upgrades once enough pillars have upgraded.',
  },
  'z1qxemdeddedxt0kenxxxxxxxxxxxxxxxxh9amk0': {
    name: 'Token',
    description: 'Issues and manages ZTS tokens, including ZNN and QSR themselves.',
  },
  'z1qxemdeddedxsentynelxxxxxxxxxxxxxwy0r2r': {
    name: 'Sentinel',
    description: 'Registers sentinels, the nodes that watch for and report liveness issues.',
  },
  'z1qxemdeddedxswapxxxxxxxxxxxxxxxxxxl4yww': {
    name: 'Swap',
    description: "Redeems the pre-mainnet ICO's pledged ZNN and QSR.",
  },
  'z1qxemdeddedxlyquydytyxxxxxxxxxxxxflaaae': {
    name: 'Liquidity',
    description: 'Distributes ZNN and QSR rewards to registered liquidity providers.',
  },
  'z1qxemdeddedxaccelerat0rxxxxxxxxxxp4tk22': {
    name: 'Accelerator',
    description: "Holds and disburses the network's grant/funding treasury.",
  },
  'z1qxemdeddedxhtlcxxxxxxxxxxxxxxxxxygecvw': {
    name: 'Htlc',
    description: 'Hash time-locked contracts, used by cross-chain swaps.',
  },
  'z1qxemdeddedxdrydgexxxxxxxxxxxxxxxmqgr0d': {
    name: 'Bridge',
    description: 'Locks and releases wrapped assets moving to and from other chains.',
  },
}

const byHex = new Map<string, KnownAddress>()
for (const [nom, info] of Object.entries(NOM_CONTRACTS)) byHex.set(nomToHex(nom), info)
for (const [hex, info] of Object.entries(ZVM_ADDRESSES)) byHex.set(hex.toLowerCase(), info)

/** A NoM embedded contract's name and purpose, keyed by either address spelling. */
export function knownAddress(address?: string | null): KnownAddress | null {
  if (!address) return null
  const hex = address.startsWith('z1') ? tryNomToHex(address) : address.toLowerCase()
  return hex ? byHex.get(hex) ?? null : null
}

function tryNomToHex(s: string): string | null {
  try {
    return nomToHex(s)
  } catch {
    return null
  }
}
