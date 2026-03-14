import { storage } from '../firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

export const uploadImageToStorage = async (base64Data: string, userId: string): Promise<string | null> => {
  try {
    const storageRef = ref(storage, `scans/${userId}/${Date.now()}.jpg`);
    await uploadString(storageRef, base64Data, 'base64', {
      contentType: 'image/jpeg',
    });
    const url = await getDownloadURL(storageRef);
    return url;
  } catch (error) {
    console.error("Error uploading image to storage:", error);
    return null;
  }
};
