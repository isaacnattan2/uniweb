import express, { Response, NextFunction } from 'express';
import { upload, UploadService } from '../services/UploadService';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = express.Router();

function requireSeller(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userType !== 'business' && req.userType !== 'admin') {
    return res.status(403).json({ error: 'Apenas lojistas e administradores podem enviar imagens' });
  }
  next();
}

router.post('/images', authMiddleware, requireSeller, upload.array('images', 5), async (req: AuthRequest, res: Response) => {
  try {
    if (!Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({ error: 'Nenhuma imagem foi enviada' });
    }

    const urls = await UploadService.uploadImages(req.files);
    res.json({ urls });
  } catch (error) {
    console.error('Erro ao enviar imagens ao armazenamento:', error);
    res.status(503).json({ error: 'Não foi possível enviar as imagens. Tente novamente.' });
  }
});

export default router;
