// Loaded explicitly by integration tests; never loaded by npm start/dev.
const RealDate = globalThis.Date;
const fixed = RealDate.parse(process.env.EA_TEST_NOW || '');
if (!Number.isFinite(fixed)) throw new Error('EA_TEST_NOW is required by the test clock.');
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixed])); }
  static now() { return fixed; }
};
