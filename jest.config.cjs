/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  watchman: false,
  resolver: "<rootDir>/jest-resolver.cjs",
  testMatch: ["**/tests/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "babel-jest",
  },
};
