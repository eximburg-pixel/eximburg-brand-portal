/*
  Checks the staff forms before anything is sent, with the exact sentences the staff see.
  The server repeats the same checks (it never trusts the browser); these just give an instant answer.
*/
const DOC_FIELDS_REQUIRED = ["invoice_no", "invoice_date", "eway_no", "eway_valid_till"];

export function checkDocs(x) {
  for (const key of DOC_FIELDS_REQUIRED) {
    if (!String((x && x[key]) || "").trim()) {
      throw new Error("Fill invoice number, invoice date, e-way bill number and e-way bill valid-till date.");
    }
  }
  if (!/^\d{12}$/.test(String(x.eway_no).replace(/\s/g, ""))) throw new Error("E-way bill number must be 12 digits.");
  if (!x.invoiceFile && !x.invoice_path) throw new Error("Attach the tax invoice (PDF or photo).");
  if (!x.ewayFile && !x.eway_path) throw new Error("Attach the e-way bill (PDF or photo).");
}

export function checkDispatch(x) {
  const has = (key) => String((x && x[key]) || "").trim();
  if (!has("transporter") || !has("vehicle_no") || !has("lr_no")) {
    throw new Error("Fill transporter, vehicle number and LR / docket number.");
  }
}

export const FILE_TYPES = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/* Type and size checks that need no canvas. Returns true if a photo should be shrunk first. */
export function checkFile(file, missingMessage = "Attach the payment slip (photo or PDF).") {
  if (!file) throw new Error(missingMessage);
  if (!FILE_TYPES.test(file.type)) throw new Error("Use a JPG, PNG, WEBP photo or a PDF.");
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF must be under 5 MB.");
    return false;
  }
  return file.size >= 900 * 1024;
}
