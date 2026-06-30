import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@jimo/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
    // The codebase uses NodeNext-style `.js` relative imports; ts-jest transpiles
    // in-memory (no emitted .js), so map them back to the .ts source.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

export default config;
