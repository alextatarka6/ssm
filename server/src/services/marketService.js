const { Market } = require("../engine/Market");
const createMarketStore = require("../storage/marketStore");

class MarketService {
  constructor() {
    this.market = new Market();
    this.store = createMarketStore();
    this.mutationQueue = Promise.resolve();
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
    const runMutation = async () => {
      const result = mutator(this.market);
      await this.store.saveSnapshot(this.market.toSnapshot());
      return result;
    };

    const resultPromise = this.mutationQueue.then(runMutation);
    this.mutationQueue = resultPromise.then(
      () => undefined,
      () => undefined,
    );

    return resultPromise;
  }
}

module.exports = new MarketService();
