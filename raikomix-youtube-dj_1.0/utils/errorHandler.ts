export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const handleError = (error: any, showToast?: (msg: string, type: 'success' | 'error' | 'info') => void) => {
  console.error('[RaikoMix Error]:', error);
  
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  
  if (showToast) {
    showToast(message, 'error');
  }

  // Potential for remote logging here
  // Fix: Safely check for window.gtag existence before invocation to avoid runtime and TypeScript errors
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'exception', {
      'description': message,
      'fatal': error instanceof AppError ? !error.recoverable : false
    });
  }
};