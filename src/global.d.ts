// src/global.d.ts
interface Window {
  electronAPI?: {
    printReceipt: (htmlContent: string) => Promise<{ success: boolean; error?: string }>;
    getPrinters: () => Promise<any[]>;
  };
}