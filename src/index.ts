// Bitcoin Faces NFT - x402 Gated NFT Minting Service
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  uintCV,
  stringAsciiCV,
  principalCV,
} from '@stacks/transactions';

interface Env {
  PAYMENT_ADDRESS: string;
  MINTER_PRIVATE_KEY?: string; // Hot wallet for minting
}

const app = new Hono<{ Bindings: Env }>();

// Payment configuration
const CONTRACT = {
  address: 'SPP5ZMH9NQDFD2K5CEQZ6P02AP8YPWMQ75TJW20M',
  name: 'simple-oracle',
};
const MINT_PRICE = 1; // 1 microSTX for testing

// NFT Contract (deployed)
const NFT_CONTRACT = {
  address: 'SP2QXPFF4M72QYZWXE7S5321XJDJ2DD32DGEMN5QA',
  name: 'bitcoin-faces-nft',
};

const HIRO_API = 'https://api.hiro.so';
const BITCOIN_FACES_API = 'https://bitcoinfaces.xyz/api';

app.use('*', cors());

// Verify x402 payment
async function verifyPayment(txid: string): Promise<{ valid: boolean; sender?: string; error?: string }> {
  try {
    const normalizedTxid = txid.startsWith('0x') ? txid : `0x${txid}`;
    const response = await fetch(`${HIRO_API}/extended/v1/tx/${normalizedTxid}`);

    if (!response.ok) {
      return { valid: false, error: 'Transaction not found' };
    }

    const tx = await response.json() as any;

    if (tx.tx_status !== 'success') {
      return { valid: false, error: `Transaction status: ${tx.tx_status}` };
    }

    if (tx.tx_type !== 'contract_call') {
      return { valid: false, error: 'Not a contract call' };
    }

    const expectedContract = `${CONTRACT.address}.${CONTRACT.name}`;
    if (tx.contract_call?.contract_id !== expectedContract) {
      return { valid: false, error: 'Wrong contract' };
    }

    return { valid: true, sender: tx.sender_address };
  } catch (error) {
    return { valid: false, error: `Verification failed: ${error}` };
  }
}

// Fetch Bitcoin Face SVG from API
async function fetchBitcoinFace(name: string): Promise<{ svg: string; hash?: number[] }> {
  const [svgResponse, hashResponse] = await Promise.all([
    fetch(`${BITCOIN_FACES_API}/get-svg-code?name=${encodeURIComponent(name)}`),
    fetch(`${BITCOIN_FACES_API}/get-hash-array?name=${encodeURIComponent(name)}`),
  ]);

  const svg = await svgResponse.text();
  let hash: number[] | undefined;

  try {
    const hashData = await hashResponse.json() as any;
    hash = hashData.hashArray || hashData;
  } catch {
    // Hash not critical
  }

  return { svg, hash };
}

// Generate metadata for the NFT
function generateMetadata(address: string, hash?: number[]) {
  return {
    name: `Bitcoin Face #${address.slice(-8)}`,
    description: `A unique Bitcoin Face generated from Stacks address ${address}`,
    image: `https://bitcoinfaces.xyz/api/get-image?name=${address}`,
    external_url: `https://bitcoinfaces.xyz/img/${address}`,
    attributes: [
      { trait_type: 'Source', value: 'Stacks Address' },
      { trait_type: 'Address', value: address },
      ...(hash ? [{ trait_type: 'Hash Seed', value: hash.join(',') }] : []),
    ],
  };
}

// Health check & API info
app.get('/', (c) => {
  return c.json({
    service: 'Bitcoin Faces NFT',
    version: '1.0.0',
    description: 'Mint unique Bitcoin Face NFTs based on your Stacks address',
    protocol: 'x402',
    endpoints: {
      'GET /': 'API info and pricing',
      'GET /preview/:address': 'Preview your Bitcoin Face (free)',
      'GET /metadata/:address': 'Get NFT metadata (free)',
      'POST /mint': 'Mint Bitcoin Face NFT to sender (x402 payment required)',
    },
    pricing: {
      '/mint': {
        price: MINT_PRICE,
        token: 'STX',
        display: `${MINT_PRICE / 1_000_000} STX`,
        description: 'Mint a unique Bitcoin Face NFT to your wallet',
      },
    },
    payment: {
      contract: `${CONTRACT.address}.${CONTRACT.name}`,
      header: 'X-Payment',
      network: 'mainnet',
    },
    nft_contract: `${NFT_CONTRACT.address}.${NFT_CONTRACT.name}`,
    powered_by: ['x402', 'bitcoinfaces.xyz', 'stacks'],
  });
});

// Preview Bitcoin Face (FREE)
app.get('/preview/:address', async (c) => {
  const address = c.req.param('address');

  // Validate Stacks address format
  if (!address.match(/^S[PM][A-Z0-9]{38,40}$/)) {
    return c.json({ error: 'Invalid Stacks address format' }, 400);
  }

  const { svg, hash } = await fetchBitcoinFace(address);

  // Return SVG directly
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
      'X-Bitcoin-Face-Address': address,
    },
  });
});

// Get NFT metadata (FREE)
app.get('/metadata/:address', async (c) => {
  const address = c.req.param('address');

  if (!address.match(/^S[PM][A-Z0-9]{38,40}$/)) {
    return c.json({ error: 'Invalid Stacks address format' }, 400);
  }

  const { hash } = await fetchBitcoinFace(address);
  const metadata = generateMetadata(address, hash);

  return c.json(metadata);
});

// Mint Bitcoin Face NFT (x402 PAID)
app.post('/mint', async (c) => {
  const paymentTxid = c.req.header('X-Payment');

  if (!paymentTxid) {
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    return c.json({
      error: 'Payment Required',
      code: 'PAYMENT_REQUIRED',
      resource: '/mint',
      payment: {
        contract: `${CONTRACT.address}.${CONTRACT.name}`,
        function: 'call-with-stx',
        price: MINT_PRICE,
        token: 'STX',
        recipient: CONTRACT.address,
        network: 'mainnet',
      },
      instructions: [
        '1. Call the contract function with STX payment',
        '2. Wait for transaction confirmation',
        '3. Retry request with X-Payment header containing txid',
      ],
      nonce,
      expiresAt,
      description: 'Mint a unique Bitcoin Face NFT based on your address',
    }, 402);
  }

  // Verify payment
  const verification = await verifyPayment(paymentTxid);
  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      details: verification.error,
    }, 403);
  }

  const senderAddress = verification.sender!;

  // Fetch the Bitcoin Face
  const { svg, hash } = await fetchBitcoinFace(senderAddress);
  const metadata = generateMetadata(senderAddress, hash);

  // Check if minting is enabled
  if (!c.env.MINTER_PRIVATE_KEY) {
    // Return preview mode - NFT contract not deployed yet
    return c.json({
      status: 'preview',
      message: 'NFT contract deployment pending. Your Bitcoin Face has been generated.',
      payment_verified: true,
      sender: senderAddress,
      bitcoin_face: {
        image_url: `https://bitcoinfaces.xyz/api/get-image?name=${senderAddress}`,
        preview_url: `https://bitcoin-faces.pbtc21.dev/preview/${senderAddress}`,
        metadata_url: `https://bitcoin-faces.pbtc21.dev/metadata/${senderAddress}`,
      },
      metadata,
      note: 'Once the NFT contract is deployed, your Bitcoin Face will be minted automatically.',
    });
  }

  // Mint the NFT (when contract is deployed)
  try {
    const txOptions = {
      contractAddress: NFT_CONTRACT.address,
      contractName: NFT_CONTRACT.name,
      functionName: 'mint-with-uri',
      functionArgs: [
        principalCV(senderAddress),
        stringAsciiCV(`https://bitcoin-faces.pbtc21.dev/metadata/${senderAddress}`),
      ],
      senderKey: c.env.MINTER_PRIVATE_KEY,
      network: 'mainnet' as const,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
    };

    const tx = await makeContractCall(txOptions as any);
    const broadcastResult = await broadcastTransaction({ transaction: tx, network: 'mainnet' });

    if ('error' in broadcastResult) {
      return c.json({
        error: 'Mint failed',
        details: broadcastResult.error,
        payment_received: true,
        payment_txid: paymentTxid,
      }, 500);
    }

    return c.json({
      status: 'minted',
      message: 'Your Bitcoin Face NFT has been minted!',
      mint_txid: broadcastResult.txid,
      payment_txid: paymentTxid,
      recipient: senderAddress,
      bitcoin_face: {
        image_url: `https://bitcoinfaces.xyz/api/get-image?name=${senderAddress}`,
        preview_url: `https://bitcoin-faces.pbtc21.dev/preview/${senderAddress}`,
        metadata_url: `https://bitcoin-faces.pbtc21.dev/metadata/${senderAddress}`,
      },
      metadata,
      explorer: `https://explorer.hiro.so/txid/${broadcastResult.txid}?chain=mainnet`,
    });
  } catch (error: any) {
    return c.json({
      error: 'Mint transaction failed',
      details: error.message,
      payment_received: true,
      payment_txid: paymentTxid,
    }, 500);
  }
});

export default app;
