const THREE_SECONDS = 3000;
const mintAddress = process.env.JUP_TOKEN_MINT?.trim();
if (!mintAddress) {
    throw new Error('JUP_TOKEN_MINT environment variable is not set.');
}
class TokenCache {
    constructor(mint, pollIntervalMs = THREE_SECONDS) {
        this.interval = null;
        this.isFetching = false;
        this.sockets = new Set();
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
    start() {
        void this.refresh();
        this.interval = setInterval(() => {
            void this.refresh();
        }, this.pollIntervalMs);
        this.interval.unref?.();
    }
    async refresh() {
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
            const payload = (await response.json());
            if (!Array.isArray(payload)) {
                throw new Error('Unexpected Jupiter API payload shape');
            }
            const tokenRecords = payload;
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error while fetching Jupiter token data';
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
        }
        finally {
            this.isFetching = false;
        }
    }
    broadcast() {
        if (this.sockets.size === 0) {
            return;
        }
        const payload = JSON.stringify(this.state);
        for (const socket of Array.from(this.sockets)) {
            if (socket.readyState === socket.OPEN) {
                try {
                    socket.send(payload);
                }
                catch (error) {
                    console.warn('[tokenCache] Failed to send payload to socket', error);
                    this.sockets.delete(socket);
                    socket.terminate?.();
                }
            }
            else {
                this.sockets.delete(socket);
            }
        }
    }
    snapshot() {
        return this.state;
    }
    register(socket) {
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
