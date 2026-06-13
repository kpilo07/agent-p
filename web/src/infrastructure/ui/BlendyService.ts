// Servicio de animaciones de modales (FLIP con Blendy). Patrón: Singleton
import { createBlendy, type Blendy } from 'blendy';

class BlendyService {
  private static instance: BlendyService | null = null;
  private blendy: Blendy | null = null;

  private constructor() {}

  static getInstance(): BlendyService {
    if (!BlendyService.instance) {
      BlendyService.instance = new BlendyService();
    }
    return BlendyService.instance;
  }

  getBlendy(): Blendy {
    if (!this.blendy) {
      this.blendy = createBlendy({ animation: 'dynamic' });
    }
    return this.blendy;
  }
}

export const blendyService = BlendyService.getInstance();
