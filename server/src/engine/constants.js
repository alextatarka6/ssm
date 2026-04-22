const TREASURY_USER = "TREASURY";

const Side = Object.freeze({
  BUY: "BUY",
  SELL: "SELL",
});

const OrderStatus = Object.freeze({
  OPEN: "OPEN",
  FILLED: "FILLED",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  CANCELED: "CANCELED",
  REJECTED: "REJECTED",
});

const EventType = Object.freeze({
  ASSET_CREATED: "ASSET_CREATED",
  USER_CREATED: "USER_CREATED",
  ORDER_PLACED: "ORDER_PLACED",
  ORDER_CANCELED: "ORDER_CANCELED",
  TRADE_EXECUTED: "TRADE_EXECUTED",
  CASH_MOVED: "CASH_MOVED",
  SHARES_MOVED: "SHARES_MOVED",
});

module.exports = {
  TREASURY_USER,
  Side,
  OrderStatus,
  EventType,
};
