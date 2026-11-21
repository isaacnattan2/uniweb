import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { resolveAssetUrl, uploadImages } from '../services/api';
import '../styles/dropzone.css';

interface ImageDropzoneProps {
  onImagesAdded: (urls: string[]) => void;
  existingImages?: string[];
  onRemoveImage?: (index: number) => void;
  maxFiles?: number;
}

export function ImageDropzone({
  onImagesAdded,
  existingImages = [],
  onRemoveImage,
  maxFiles = 5,
}: ImageDropzoneProps) {
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState('');
  const [uploadSuccess, setUploadSuccess] = React.useState('');

  React.useEffect(() => {
    if (uploadError) {
      const timer = setTimeout(() => setUploadError(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [uploadError]);

  React.useEffect(() => {
    if (uploadSuccess) {
      const timer = setTimeout(() => setUploadSuccess(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [uploadSuccess]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      setUploading(true);
      setUploadError('');

      try {
        const remaining = maxFiles - existingImages.length;
        const filesToUpload = acceptedFiles.slice(0, remaining);

        if (filesToUpload.length === 0) {
          setUploadError(`Limite de ${maxFiles} imagens atingido`);
          setUploading(false);
          return;
        }

        const result = await uploadImages(filesToUpload);
        if (result?.urls && result.urls.length > 0) {
          onImagesAdded(result.urls);
          setUploadSuccess(`${result.urls.length} imagem(ns) enviada(s) com sucesso!`);
          setUploadError('');
        } else {
          setUploadError('Nenhuma imagem foi enviada com sucesso');
        }
      } catch (err: any) {
        console.error('Upload error:', err);
        const errorMessage =
          err?.response?.data?.error ||
          err?.message ||
          'Erro ao fazer upload das imagens';
        setUploadError(errorMessage);
      } finally {
        setUploading(false);
      }
    },
    [onImagesAdded, existingImages.length, maxFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.gif'],
    },
    disabled: uploading || existingImages.length >= maxFiles,
  });

  return (
    <div className="dropzone-container">
      <div
        {...getRootProps()}
        className={`dropzone ${isDragActive ? 'active' : ''} ${
          uploading ? 'uploading' : ''
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="dropzone-content">
            <p>Enviando imagens...</p>
          </div>
        ) : isDragActive ? (
          <div className="dropzone-content">
            <p>Solte as imagens aqui!</p>
          </div>
        ) : (
          <div className="dropzone-content">
            <svg
              className="dropzone-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            <p className="dropzone-title">Arraste imagens aqui ou clique para selecionar</p>
            <p className="dropzone-subtitle">
              Máximo {maxFiles} imagens • JPEG, PNG, WebP ou GIF • até 5MB cada
            </p>
            <p className="dropzone-remaining">
              {existingImages.length}/{maxFiles} imagens adicionadas
            </p>
          </div>
        )}
      </div>

      {uploadError && <div className="error-message">{uploadError}</div>}
      {uploadSuccess && <div className="success-message">{uploadSuccess}</div>}

      {existingImages.length > 0 && (
        <div className="image-gallery">
          {existingImages.map((img, index) => (
            <div key={index} className="image-item">
              <img src={resolveAssetUrl(img)} alt={`Produto ${index + 1}`} />
              {onRemoveImage && (
                <button
                  type="button"
                  onClick={() => onRemoveImage(index)}
                  className="btn-remove"
                  title="Remover imagem"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
