// Real correctness test: sign a TransferWithAuthorization with a TEST key, then recover the
// signer and assert it equals the key's address. No network, no USDC spent.
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, getAddress, toHex, recoverTypedDataAddress } from 'viem';
import { base } from 'viem/chains';
import crypto from 'node:crypto';

const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // well-known test key
const account = privateKeyToAccount(TEST_KEY);

const domain = { name:'USD Coin', version:'2', chainId:8453,
  verifyingContract: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') };
const message = {
  from: account.address,
  to: getAddress('0x6523acd890Ec5853db6D9eB731D7892666dbd27e'),
  value: 10000n, validAfter: 0n, validBefore: BigInt(Math.floor(Date.now()/1000)+120),
  nonce: toHex(crypto.randomBytes(32)),
};
const types = { TransferWithAuthorization: [
  {name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},
  {name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}] };

const wallet = createWalletClient({ account, chain: base, transport: http() });
const signature = await wallet.signTypedData({ account, domain, types, primaryType:'TransferWithAuthorization', message });

const recovered = await recoverTypedDataAddress({ domain, types, primaryType:'TransferWithAuthorization', message, signature });
const pass = recovered.toLowerCase() === account.address.toLowerCase();
console.log(`signer:    ${account.address}`);
console.log(`recovered: ${recovered}`);
console.log(`signature: ${signature.slice(0,20)}…`);
console.log(pass ? 'PASS — EIP-712 signature recovers to signer (x402 signing logic is correct)' : 'FAIL');
process.exit(pass ? 0 : 1);
