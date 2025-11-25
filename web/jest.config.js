module.exports = {
  testEnvironment: 'node',
  testTimeout: 10000,
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: ['src/**/*.js'],
  coverageDirectory: 'coverage'
};
