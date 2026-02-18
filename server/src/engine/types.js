export const TREASURY_USER = "TREASURY";

export const Side = Object.freeze ({
    BUY: "BUY",
    SELL: "SELL"
});

export const OrderStatus = Object.freeze ({
    OPEN: "OPEN",
    FILLED: "FILLED",
    PARTIALLY_FILLED : "PARTIALLY_FILLED",
    CANCELED : "CANCELED",
    REJECTED : "REJECTED",
});

export const EventType = Object.freeze ({
    ASSET_CREATED : "ASSET_CREATED",
    ORDER_PLACED : "ORDER_PLACED",
    ORDER_CANCELED : "ORDER_CANCELED",
    TRADE_EXECUTED : "TRADE_EXECUTED",
    CASH_MOVED : "CASH_MOVED",
    SHARES_MOVED : "SHARES_MOVED",
});

export class InsufficientFunds extends Error {}
export class InsufficientShares extends Error {}
export class UnknownOrder extends Error {}
export class UnknownUser extends Error {}
export class UnknownAsset extends Error {}