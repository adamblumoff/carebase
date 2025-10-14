module.exports = {
  preset: 'jest-expo/ios',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|@react-navigation|@react-native-async-storage|expo(nent)?|@expo|expo-modules-core)/)'
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^socket.io-client/dist/socket.io.esm.min.js$': '<rootDir>/src/__mocks__/socket.io-client.ts',
    '^@react-native-community/datetimepicker$': '<rootDir>/src/__mocks__/datetimepicker.ts',
    '^expo(/.*)?$': '<rootDir>/src/__mocks__/expo.ts',
  },
};
