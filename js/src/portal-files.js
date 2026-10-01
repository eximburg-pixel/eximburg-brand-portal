/*
  Prepares a file before upload: checks type and size, and shrinks large photos so they upload fast
  while staying readable. PDFs are sent as they are.
*/
import { checkFile } from "../../shared/portal-validate.js";

export async function prepFile(file, missingMessage) {
  const shrink = checkFile(file, missingMessage);
  if (!shrink) return file;
  const image = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not read this photo. Try another file."));
    el.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(image.src);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Could not read this photo. Try another file.");
  return new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}
