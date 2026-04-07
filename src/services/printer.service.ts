import { Capacitor } from '@capacitor/core';

export interface PrintOptions {
  name?: string;
  printerId?: string;
  duplex?: boolean;
  landscape?: boolean;
  grayscale?: boolean;
}

class PrinterService {
  private isAvailable(): boolean {
    return Capacitor.isNativePlatform() && (window as any).cordova?.plugins?.printer;
  }

  /**
   * Vérifie si le service d'impression est disponible sur l'appareil
   */
  public async checkAvailability(): Promise<boolean> {
    if (!this.isAvailable()) {
      console.warn('Printer plugin not available (must be on a native device)');
      return false;
    }

    return new Promise((resolve) => {
      (window as any).cordova.plugins.printer.canPrint((can: boolean) => {
        resolve(can);
      });
    });
  }

  /**
   * Imprime un contenu HTML ou une URL
   * @param content Chaîne HTML ou URL à imprimer
   * @param options Options d'impression
   */
  public async print(content: string, options: PrintOptions = {}): Promise<void> {
    if (!this.isAvailable()) {
      console.error('Printer plugin not available');
      return;
    }

    return new Promise((resolve, reject) => {
      (window as any).cordova.plugins.printer.print(content, options, (res: any) => {
        if (res) {
          resolve();
        } else {
          reject(new Error('Printing failed or cancelled'));
        }
      });
    });
  }

  /**
   * Affiche la liste des imprimantes disponibles (si supporté par la plateforme)
   */
  public async pickPrinter(): Promise<any> {
    if (!this.isAvailable()) return null;

    return new Promise((resolve) => {
      (window as any).cordova.plugins.printer.pick((printer: any) => {
        resolve(printer);
      });
    });
  }
}

export const printerService = new PrinterService();
