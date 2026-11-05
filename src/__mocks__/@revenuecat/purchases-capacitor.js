// Jest mock for @revenuecat/purchases-capacitor (ESM-only native plugin)
// revenueCat.js imports { LOG_LEVEL, Purchases } from this package.
// All Purchases methods return resolved promises to prevent test hangs.

export const LOG_LEVEL = { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };

export const Purchases = {
    configure: jest.fn().mockResolvedValue(undefined),
    setLogLevel: jest.fn().mockResolvedValue(undefined),
    logIn: jest.fn().mockResolvedValue({ customerInfo: null }),
    logOut: jest.fn().mockResolvedValue(undefined),
    setAttributes: jest.fn().mockResolvedValue(undefined),
    setEmail: jest.fn().mockResolvedValue(undefined),
    addCustomerInfoUpdateListener: jest.fn().mockResolvedValue('listener-id'),
    removeCustomerInfoUpdateListener: jest.fn().mockResolvedValue(undefined),
    getCustomerInfo: jest.fn().mockResolvedValue({ customerInfo: null }),
    getOfferings: jest.fn().mockResolvedValue({ current: null, all: {} }),
    purchasePackage: jest.fn().mockResolvedValue({ customerInfo: null }),
    restorePurchases: jest.fn().mockResolvedValue({ customerInfo: null }),
};
