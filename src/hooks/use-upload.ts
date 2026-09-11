import { useState, useCallback } from 'react';
import { API_URL, getAuthToken } from '@/lib/api';

interface UploadResult {
  success: boolean;
  file: {
    filename: string;
    originalName: string;
    mimetype: string;
    size: number;
    url: string;
  };
}

export function useUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Same as uploadFile, but also returns the mimetype the backend actually stored
  // the file as. Needed for audio: recorded voice notes are uploaded as webm/opus
  // and converted server-side to ogg/opus for WhatsApp/iOS compatibility, so the
  // mimetype attached to the message must reflect the converted file, not the
  // original blob's type - otherwise iPhone recipients get a "unavailable audio" error.
  const uploadFileMeta = useCallback(async (file: File): Promise<{ url: string; mimetype: string } | null> => {
    const MAX_SIZE = 200 * 1024 * 1024; // 200MB
    if (file.size > MAX_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(`Arquivo muito grande (${sizeMB}MB). Máximo permitido: 200MB.`);
    }

    setIsUploading(true);
    setProgress(0);

    console.log('[useUpload] Starting upload:', { 
      name: file.name, 
      type: file.type, 
      size: file.size,
      apiUrl: API_URL 
    });

    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      const token = getAuthToken();
      console.log('[useUpload] Auth token present:', !!token);
      
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          setProgress(percentComplete);
          console.log('[useUpload] Progress:', percentComplete + '%');
        }
      });

      xhr.addEventListener('load', () => {
        setIsUploading(false);
        console.log('[useUpload] Response status:', xhr.status, 'body:', xhr.responseText.substring(0, 500));
        
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result: UploadResult = JSON.parse(xhr.responseText);
            setProgress(100);
            console.log('[useUpload] Success, URL:', result.file.url);
            resolve({ url: result.file.url, mimetype: result.file.mimetype });
          } catch (e) {
            console.error('[useUpload] Parse error:', e);
            reject(new Error('Erro ao processar resposta'));
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            console.error('[useUpload] Server error:', error);
            reject(new Error(error.error || 'Erro ao fazer upload'));
          } catch {
            console.error('[useUpload] Non-JSON error response');
            reject(new Error(`Erro ao fazer upload (${xhr.status})`));
          }
        }
      });

      xhr.addEventListener('error', (e) => {
        setIsUploading(false);
        setProgress(0);
        console.error('[useUpload] Network error:', e);
        reject(new Error('Erro de conexão'));
      });

      xhr.addEventListener('abort', () => {
        setIsUploading(false);
        setProgress(0);
        console.log('[useUpload] Upload aborted');
        reject(new Error('Upload cancelado'));
      });

      const uploadUrl = `${API_URL}/api/uploads`;
      console.log('[useUpload] POST to:', uploadUrl);
      xhr.open('POST', uploadUrl);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<string | null> => {
    const result = await uploadFileMeta(file);
    return result?.url ?? null;
  }, [uploadFileMeta]);

  const resetProgress = useCallback(() => {
    setProgress(0);
  }, []);

  return {
    uploadFile,
    uploadFileMeta,
    isUploading,
    progress,
    resetProgress,
  };
}
