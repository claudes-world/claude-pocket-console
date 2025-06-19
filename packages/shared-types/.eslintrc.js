const config = require('@cpc/config/eslint-preset');

module.exports = {
  ...config,
  parserOptions: {
    ...config.parserOptions,
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
};