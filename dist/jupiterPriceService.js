const JUPITER_API_URL = "https://lite-api.jup.ag/tokens/v2/search";
const JUPITER_TOKEN_ID = "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P";
const JUPITER_SYMBOL = "xaut0";
const logPrefix = "[jupiter-price]";
const REFRESH_INTERVAL_MS = 3_000;
let intervalId = null;
const defaultSnapshot = {
    symbol: JUPITER_SYMBOL,
    address: JUPITER_TOKEN_ID,
    source: JUPITER_API_URL,
    price: null,
    lastUpdated: null,
    lastAttempt: null,
    raw: null,
    error: "Price not fetched yet",
};
let snapshot = { ...defaultSnapshot };
const parsePrice = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
};
const refreshPrice = async () => {
    const attemptTime = new Date().toISOString();
    snapshot = { ...snapshot, lastAttempt: attemptTime };
    try {
        const url = `${JUPITER_API_URL}?query=${encodeURIComponent(JUPITER_TOKEN_ID)}`;
        const response = await fetch(url, { method: "GET" });
        if (!response.ok) {
            throw new Error(`Unexpected response status ${response.status}`);
        }
        const data = (await response.json());
        const tokens = Array.isArray(data)
            ? data
            : Array.isArray(data?.value)
                ? data.value
                : [];
        if (tokens.length === 0) {
            console.warn(logPrefix, "empty-result", JSON.stringify(data));
            throw new Error("Token data missing in Jupiter response");
        }
        const tokenData = tokens.find((token) => token.id === JUPITER_TOKEN_ID) ?? tokens[0];
        if (tokenData.id !== JUPITER_TOKEN_ID) {
            console.warn(logPrefix, "fallback-token", JSON.stringify({ expected: JUPITER_TOKEN_ID, received: tokenData.id }));
        }
        const price = parsePrice(tokenData.usdPrice);
        snapshot = {
            symbol: tokenData.symbol?.toLowerCase() ?? JUPITER_SYMBOL,
            address: JUPITER_TOKEN_ID,
            source: JUPITER_API_URL,
            price,
            lastUpdated: price !== null ? attemptTime : snapshot.lastUpdated,
            lastAttempt: attemptTime,
            raw: {
                token: tokenData,
                payload: tokens,
            },
            error: price === null ? "Price value unavailable" : null,
        };
        console.log(logPrefix, "success", JSON.stringify({
            price,
            symbol: snapshot.symbol,
            lastUpdated: snapshot.lastUpdated,
            fields: Object.keys(tokenData ?? {}),
        }, null, 2));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch Jupiter price";
        snapshot = {
            ...snapshot,
            lastAttempt: attemptTime,
            error: message,
        };
        console.error(logPrefix, "error", message);
    }
};
export const initializeJupiterPriceService = () => {
    if (intervalId) {
        return;
    }
    void refreshPrice();
    intervalId = setInterval(() => {
        void refreshPrice();
    }, REFRESH_INTERVAL_MS);
};
export const getJupiterPriceSnapshot = () => snapshot;
export const shutdownJupiterPriceService = () => {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
};
