import { WebSocket } from 'ws';

type JupiterTokenStats = {
  priceChange?: number;
  liquidityChange?: number;
  buyVolume?: number;
  sellVolume?: number;
  numBuys?: number;
  numSells?: number;
  numTraders?: number;
  numNetBuyers?: number;
};

export type JupiterTokenRecord = {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  twitter?: string;
  website?: string;
  dev?: string;
  circSupply?: number;
  totalSupply?: number;
  tokenProgram?: string;
  launchpad?: string;
  metaLaunchpad?: string;
  partnerConfig?: string;
  firstPool?: {
    id: string;
    createdAt: string;
  };
  graduatedPool?: string;
  graduatedAt?: string;
  holderCount?: number;
  audit?: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    topHoldersPercentage?: number;
    devMigrations?: number;
  };
  organicScore?: number;
  organicScoreLabel?: string;
  tags?: string[];
  fdv?: number;
  mcap?: number;
  usdPrice?: number;
  priceBlockId?: number;
  liquidity?: number;
  stats1h?: JupiterTokenStats;
  stats6h?: JupiterTokenStats;
  stats24h?: JupiterTokenStats;
  bondingCurve?: number;
  updatedAt?: string;
};

export type TokenCacheStatus = 'idle' | 'ready' | 'error';

export type TokenCacheSnapshot = {
  mint: string;
  source: string;
  status: TokenCacheStatus;
  data: JupiterTokenRecord[];
  lastUpdated: string | null;
  error?: string;
};

const THREE_SECONDS = 3000;

const mintAddress = process.env.JUP_TOKEN_MINT?.trim();

if (!mintAddress) {
  throw new Error('JUP_TOKEN_MINT environment variable is not set.');
}

class TokenCache {
  private readonly sourceUrl: string;
  private readonly pollIntervalMs: number;
  private state: TokenCacheSnapshot;
  private interval: NodeJS.Timeout | null = null;
  private isFetching = false;
  private readonly sockets = new Set<WebSocket>();

  constructor(mint: string, pollIntervalMs = THREE_SECONDS) {
    this.sourceUrl = `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`;
    this.pollIntervalMs = pollIntervalMs;
    this.state = {
      mint,
      source: this.sourceUrl,
      status: 'idle',
      data: [],
      lastUpdated: null,
    };
    this.start();
  }

  private start() {
    void this.refresh();
    this.interval = setInterval(() => {
      void this.refresh();
    }, this.pollIntervalMs);
    this.interval.unref?.();
  }

  private async refresh() {
    if (this.isFetching) {
      return;
    }
    this.isFetching = true;

    try {
      const response = await fetch(this.sourceUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Jupiter API responded with status ${response.status}`);
      }

      const payload = (await response.json()) as unknown;

      if (!Array.isArray(payload)) {
        throw new Error('Unexpected Jupiter API payload shape');
      }

      const tokenRecords = payload as JupiterTokenRecord[];

      console.log('[tokenCache] Jupiter response', {
        mint: this.state.mint,
        receivedAt: new Date().toISOString(),
        payload: tokenRecords,
      });

      this.state = {
        mint: this.state.mint,
        source: this.state.source,
        status: 'ready',
        data: tokenRecords,
        lastUpdated: new Date().toISOString(),
      };

      this.broadcast();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while fetching Jupiter token data';

      console.error('[tokenCache] Jupiter fetch failed', {
        mint: this.state.mint,
        occurredAt: new Date().toISOString(),
        error: message,
      });

      this.state = {
        ...this.state,
        status: 'error',
        error: message,
      };

      this.broadcast();
    } finally {
      this.isFetching = false;
    }
  }

  private broadcast() {
    if (this.sockets.size === 0) {
      return;
    }
    const payload = JSON.stringify(this.state);

    for (const socket of Array.from(this.sockets)) {
      if (socket.readyState === socket.OPEN) {
        try {
          socket.send(payload);
        } catch (error) {
          console.warn('[tokenCache] Failed to send payload to socket', error);
          this.sockets.delete(socket);
          socket.terminate?.();
        }
      } else {
        this.sockets.delete(socket);
      }
    }
  }

  public snapshot(): TokenCacheSnapshot {
    return this.state;
  }

  public register(socket: WebSocket) {
    this.sockets.add(socket);

    const payload = JSON.stringify(this.state);
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }

    socket.on('close', () => {
      this.sockets.delete(socket);
    });

    socket.on('error', (err) => {
      console.warn('[tokenCache] Socket error', err);
      this.sockets.delete(socket);
      socket.terminate?.();
    });
  }
}

const tokenCache = new TokenCache(mintAddress);

export default tokenCache;
