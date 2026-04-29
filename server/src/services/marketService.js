const { Market } = require("../engine/Market");
const createMarketStore = require("../storage/marketStore");

const SAVE_DEBOUNCE_MS = 10_000;

class MarketService {
  constructor() {
    this.market = new Market();
    this.store = createMarketStore();
    this.mutationQueue = Promise.resolve();
    this._saveTimer = null;
  }

  async initialize() {
    await this.store.initialize();
    const snapshot = await this.store.loadSnapshot();
    this.market = Market.fromSnapshot(snapshot);
  }

  getMarket() {
    return this.market;
  }

  async ping() {
    return this.store.ping();
  }

  async mutate(mutator) {
    const runMutation = () => {
      const result = mutator(this.market);
      this._scheduleSave();
      return result;
    };

    const resultPromise = this.mutationQueue.then(runMutation);
    this.mutationQueue = resultPromise.then(
      () => undefined,
      () => undefined,
    );

    return resultPromise;
  }

  // Force an immediate save — call this on graceful shutdown.
  async persist() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    await this.store.saveSnapshot(this.market.toSnapshot()).catch((err) => {
      console.error("[market] shutdown save failed:", err.message);
    });
  }

  _scheduleSave() {
    if (this._saveTimer !== null) return;
    this._saveTimer = setTimeout(async () => {
      this._saveTimer = null;
      await this.store.saveSnapshot(this.market.toSnapshot()).catch((err) => {
        console.error("[market] snapshot save failed:", err.message);
      });
    }, SAVE_DEBOUNCE_MS);
  }
}

module.exports = new MarketService();
