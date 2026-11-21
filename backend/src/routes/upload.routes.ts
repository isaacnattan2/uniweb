import express, { Request, Response } from 'express';
import { upload, UploadService } from '../services/UploadService';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

router.post('/images', authMiddleware, upload.array('images', 5), (req: Request, res: Response) => {
  try {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
      return res.status(400).json({ error: 'Nenhuma imagem foi enviada' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const urls = (req.files as Express.Multer.File[]).map((file) =>
      `${baseUrl}${UploadService.getImageUrl(file.filename)}`
    );

    res.json({ urls });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
