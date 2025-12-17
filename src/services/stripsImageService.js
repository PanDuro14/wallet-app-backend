const sharp = require('sharp');

class StripsImageService {
  async generateStripsImage({
    collected = 0,
    total = 8, 
    stripImageOn,
    stripImageOff,
    cardWidth = 450,
  }) {
    try {
      // ===== Manejo de imágenes ON / OFF =====
      let imageOnBuffer = null;
      let imageOffBuffer = null;

      if (stripImageOn) {
        imageOnBuffer = Buffer.isBuffer(stripImageOn)
          ? stripImageOn
          : Buffer.from(stripImageOn.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      }
      if (stripImageOff) {
        imageOffBuffer = Buffer.isBuffer(stripImageOff)
          ? stripImageOff
          : Buffer.from(stripImageOff.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      }

      if (!imageOnBuffer) {
        imageOnBuffer = await this.createDefaultImage('✅', '#4CAF50');
      }
      if (!imageOffBuffer) {
        imageOffBuffer = await this.createDefaultImage('⭕', '#CCCCCC');
      }

      // ===== Tamaño externo (Wallet) =====
      const outerWidth = cardWidth;
      const outerHeight = 120;

      // ===== Área útil con MARGEN DE SEGURIDAD =====
      const innerWidth = 310;  // reducido de 330 a 310 (más margen lateral)
      const padding = 8;       // aumentado de 7 a 8

      // ===== Distribución según cantidad de strips =====
      let numRows, stripsPerRow, innerHeight, stripWidth, stripHeight;

      if (total <= 5) {
        // 1 fila
        numRows = 1;
        stripsPerRow = total;
        innerHeight = 72;  // reducido de 75 a 72
        stripWidth = Math.floor(innerWidth / total);
        stripHeight = 72;
      } else {
        // 2 filas
        numRows = 2;
        stripsPerRow = Math.ceil(total / 2);
        innerHeight = 96;  // reducido de 100 a 96
        stripWidth = Math.floor(innerWidth / stripsPerRow);
        stripHeight = Math.floor(innerHeight / 2); // ~48px por fila
      }

      // ===== Canvas interno =====
      const innerCanvas = sharp({
        create: {
          width: innerWidth,
          height: innerHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      });

      // ===== Redimensionar con MÁXIMA calidad =====
      const resizedOn = await sharp(imageOnBuffer)
        .resize(stripWidth - padding, stripHeight - padding, {
          fit: 'inside',
          kernel: 'lanczos3',
          withoutEnlargement: false,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .sharpen()
        .png({ 
          quality: 100,
          compressionLevel: 6
        })
        .toBuffer();

      const resizedOff = await sharp(imageOffBuffer)
        .resize(stripWidth - padding, stripHeight - padding, {
          fit: 'inside',
          kernel: 'lanczos3',
          withoutEnlargement: false,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .sharpen()
        .png({ 
          quality: 100,
          compressionLevel: 6
        })
        .toBuffer();

      // ===== Obtener dimensiones reales =====
      const onMetadata = await sharp(resizedOn).metadata();
      const offMetadata = await sharp(resizedOff).metadata();

      // ===== Pegar strips centrados en cada celda =====
      const compositeInner = [];
      for (let i = 0; i < total; i++) {
        const isCollected = i < collected;
        const row = Math.floor(i / stripsPerRow);
        const col = i % stripsPerRow;

        // Centrar strip dentro de su celda
        const metadata = isCollected ? onMetadata : offMetadata;
        const xOffset = Math.floor((stripWidth - metadata.width) / 2);
        const yOffset = Math.floor((stripHeight - metadata.height) / 2);

        compositeInner.push({
          input: isCollected ? resizedOn : resizedOff,
          left: col * stripWidth + xOffset,
          top: row * stripHeight + yOffset
        });
      }

      const innerImage = await innerCanvas
        .composite(compositeInner)
        .png({ quality: 100 })
        .toBuffer();

      // ===== Canvas externo con centrado =====
      const offsetX = Math.floor((outerWidth - innerWidth) / 2);
      const offsetY = Math.floor((outerHeight - innerHeight) / 2);

      const outerCanvas = sharp({
        create: {
          width: outerWidth,
          height: outerHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      });

      // Output final con máxima calidad
      return await outerCanvas
        .composite([{ input: innerImage, left: offsetX, top: offsetY }])
        .png({ 
          quality: 100,
          compressionLevel: 6
        })
        .toBuffer();

    } catch (error) {
      throw error;
    }
  }

  async createDefaultImage(text, color) {
    // SVG con margen de seguridad
    const svg = `
      <svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
        <circle cx="64" cy="64" r="54" fill="${color}" stroke="#FFFFFF" stroke-width="3"/>
        <text x="64" y="79" font-size="31" font-weight="bold" text-anchor="middle" fill="white">${text}</text>
      </svg>
    `;
    return await sharp(Buffer.from(svg))
      .png({ quality: 100 })
      .toBuffer();
  }
}

module.exports = new StripsImageService();