import '@testing-library/jest-dom';

// Clear localStorage before each test to prevent state leakage
beforeEach(() => {
  localStorage.clear();
});
